/**
 * Copies the fork store's model into the TissUUmaps app's project store, so
 * that the app's viewer draws what the plugin's sidebar selects
 *
 * The fork store rebuilds its whole model on every change of the selection.
 * Another sample replaces the app's project with a fresh instance ID, so that
 * the viewer fits the view to it, and marks it as built by the InSituPy
 * importer, so that the app selects the InSituPy lens for it (as it
 * does for a dataset opened through the importer itself); any other change
 * only rewrites the objects
 * the plugin owns (see `mergeOwned`), so that objects the user added in the
 * generic panels stay.
 */
import { type PluginStores, createProject } from "@tissuumaps/core";

import type { InSituProject } from "@/insitupy";
import { type AppState, useAppStore as insitupyStore } from "@/state/store";
import type { RegionUm } from "@/transcripts/indexFormat";

import { insitupyImporterId } from "./importer";
import { mergeOwned } from "./mergeOwned";

/**
 * Returns the name of the open sample, for the app's project name
 *
 * @param state - The fork store's state, with a project
 * @returns The sample name of an experiment's sample, or else the sample ID
 */
function sampleName(state: AppState): string {
  const sample = state.experiment?.samples.find(
    (s) => s.index === state.sampleIndex,
  );
  return sample?.name ?? state.project?.sampleId ?? "InSituPy sample";
}

/** The extent used when no image of a sample knows its size, in µm */
const fallbackExtentUm = 100_000;

/**
 * Returns the extent of a sample in µm, from the largest of its images
 *
 * Transcripts are loaded for the region the fork store believes to be in
 * view, which the standalone app takes from its viewer. A plugin cannot read
 * the app's viewport, so the plugin reports the whole sample as in view: the
 * transcripts of a gene are loaded for the whole sample once.
 *
 * @param project - The open sample
 * @returns The region from the world origin to the far corner of the largest
 * image, or a large square if no image knows its size
 */
export function sampleExtent(project: InSituProject): RegionUm {
  let width = 0;
  let height = 0;
  for (const image of project.images) {
    if (image.size !== undefined) {
      width = Math.max(width, image.size.width * image.pixelSize);
      height = Math.max(height, image.size.height * image.pixelSize);
    }
  }
  return width > 0 && height > 0
    ? { x: 0, y: 0, width, height }
    : { x: 0, y: 0, width: fallbackExtentUm, height: fallbackExtentUm };
}

/**
 * Starts copying the fork store's model into the app's project store
 *
 * Also hands a picked folder to the app as its workspace, since the data
 * sources of a folder are workspace paths, reports the whole sample as in
 * view (see {@link sampleExtent}), and closes the plugin's source
 * when the app's project is replaced by something else, such as a project the
 * user opened in the Project panel. A project the app loaded through the
 * plugin's importer is not something else: the bridge adopts it.
 *
 * @param stores - The stores the app hands to the plugin
 * @returns A callback that stops copying
 */
export function startProjectBridge({
  appStore,
  projectStore,
}: PluginStores): () => void {
  /** The fork store's project instance shown in the app, if any */
  let shownInstanceId: string | null = null;
  /** The app project instance the bridge wrote, if any */
  let writtenInstanceId: string | null = null;
  let writeScheduled = false;

  const write = () => {
    writeScheduled = false;
    const state = insitupyStore.getState();
    if (state.project === null) {
      if (
        writtenInstanceId !== null &&
        projectStore.getState().instanceId === writtenInstanceId
      ) {
        // the plugin closed its sample, so the app's project goes too
        writtenInstanceId = null;
        shownInstanceId = null;
        projectStore.getState().clear();
        appStore.getState().setProjectOpen(false);
      }
      return;
    }
    const workspace = state.source?.workspace ?? null;
    if (workspace !== null && appStore.getState().workspace !== workspace) {
      appStore.getState().setWorkspace(workspace);
    }
    if (state.projectInstanceId !== shownInstanceId) {
      shownInstanceId = state.projectInstanceId;
      writtenInstanceId = crypto.randomUUID();
      projectStore.setState({
        ...createProject({ name: sampleName(state), ...state.model }),
        source: null,
        instanceId: writtenInstanceId,
        // the plugin builds the project the way its importer would, also for
        // a dataset opened from its start screen, so that the app selects the
        // InSituPy lens however the dataset was opened
        importerId: insitupyImporterId,
      });
      // the whole sample counts as in view (see sampleExtent)
      state.setViewport(sampleExtent(state.project), 0);
    } else if (projectStore.getState().instanceId === writtenInstanceId) {
      projectStore.setState(mergeOwned(projectStore.getState(), state.model));
    }
  };

  // the fork store sets its project and then rebuilds its model in the same
  // task: writing once afterwards never shows a new sample with an old model
  const scheduleWrite = () => {
    if (!writeScheduled) {
      writeScheduled = true;
      queueMicrotask(write);
    }
  };

  const unsubscribeFork = insitupyStore.subscribe((state, prevState) => {
    if (
      state.model !== prevState.model ||
      state.project !== prevState.project ||
      state.projectInstanceId !== prevState.projectInstanceId
    ) {
      scheduleWrite();
    }
  });

  const unsubscribeProject = projectStore.subscribe((state, prevState) => {
    if (
      state.instanceId === prevState.instanceId ||
      state.instanceId === writtenInstanceId
    ) {
      return;
    }
    if (
      state.importerId === insitupyImporterId &&
      insitupyStore.getState().source !== null
    ) {
      // the app loaded the project our importer returned: it is the plugin's
      writtenInstanceId = state.instanceId;
      return;
    }
    if (writtenInstanceId !== null) {
      writtenInstanceId = null;
      shownInstanceId = null;
      if (insitupyStore.getState().source !== null) {
        insitupyStore.getState().closeSource();
      }
    }
  });

  scheduleWrite();
  return () => {
    unsubscribeFork();
    unsubscribeProject();
  };
}
