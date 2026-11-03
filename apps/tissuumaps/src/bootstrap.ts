import { ProjectUtils } from "@tissuumaps/core";

import { startDataCaches } from "./data/cache";
import { loadDatasetFromSource } from "./data/io/dataset";
import {
  datasetURLParam,
  loadProjectFromURL,
  projectURLParam,
} from "./data/io/project";
import { enableBuiltInDataProviders } from "./data/providers";
import { notifyTissUUmapsLoaded } from "./events";
import { enableBuiltInPlugins, startPluginRegistry } from "./plugins";
import { appStore } from "./stores/app";
import { projectStore } from "./stores/project";

/** The project loaded on startup when the URL does not name one */
const fallbackProjectUrl = "project.tm4";

/**
 * Starts up the parts of the application that live outside of React
 *
 * Registers the built-in data providers, starts the data caches and the plugin
 * registry, registers the built-in plugins, marks the project open once it has
 * a source or data, collapses the expanded objects whenever another project is
 * loaded or the project is closed,
 * starts loading the initial project, and finally announces that the
 * application has loaded.
 * The project is only loading, not loaded, by the time this returns.
 *
 * @returns A callback that cancels the initial project loading, stops
 * collapsing the expanded objects and marking the project open, and stops the
 * plugin registry and the data caches, invoked on hot module replacement
 */
export function bootstrap(): () => void {
  enableBuiltInDataProviders();
  const stopDataCaches = startDataCaches();
  const stopPluginRegistry = startPluginRegistry();
  enableBuiltInPlugins();
  const stopMarkingProjectOpen = startMarkingProjectOpen();
  const stopCollapsingOnProjectSwitch = startCollapsingOnProjectSwitch();
  const cancelInitialProjectLoading = loadInitialProject();
  notifyTissUUmapsLoaded();
  return () => {
    cancelInitialProjectLoading();
    stopCollapsingOnProjectSwitch();
    stopMarkingProjectOpen();
    stopPluginRegistry();
    stopDataCaches();
  };
}

/**
 * Marks the project open as soon as it has a source or data, however it got
 * them
 *
 * @returns A callback that stops watching the project
 */
function startMarkingProjectOpen(): () => void {
  return projectStore.subscribe((projectState) => {
    if (
      !appStore.getState().projectOpen &&
      (projectState.source !== null || ProjectUtils.hasData(projectState))
    ) {
      appStore.getState().setProjectOpen(true);
    }
  });
}

/**
 * Collapses the expanded objects of every panel whenever another project is
 * loaded or the project is closed, i.e. whenever the project's instance ID
 * changes
 *
 * Object IDs are only unique within a project, so the expanded IDs of the
 * previous project would otherwise expand objects of the new one.
 *
 * @returns A callback that stops watching the project
 */
function startCollapsingOnProjectSwitch(): () => void {
  return projectStore.subscribe((projectState, prevProjectState) => {
    if (projectState.instanceId !== prevProjectState.instanceId) {
      appStore.setState({
        expandedImageIds: [],
        expandedLabelsIds: [],
        expandedPointsIds: [],
        expandedShapesIds: [],
        expandedTableIds: [],
      });
    }
  });
}

/**
 * Starts loading the project named by the {@link projectURLParam} GET
 * parameter or, without one, the dataset named by the {@link datasetURLParam}
 * GET parameter (see {@link openInitialDataset}), falling back to
 * {@link fallbackProjectUrl} if both are absent or empty
 *
 * Failures are logged, unless loading was cancelled.
 *
 * @returns A callback that cancels the loading
 */
function loadInitialProject(): () => void {
  const params = new URLSearchParams(window.location.search);
  const datasetSource = params.get(datasetURLParam);
  if (!params.get(projectURLParam) && datasetSource) {
    return openInitialDataset(datasetSource);
  }
  const abortController = new AbortController();
  const projectUrl = params.get(projectURLParam) || fallbackProjectUrl;
  loadProjectFromURL(projectUrl, { signal: abortController.signal }).catch(
    (error) => {
      if (!abortController.signal.aborted) {
        console.error(`Failed to load project from ${projectUrl}:`, error);
      }
    },
  );
  return () => abortController.abort();
}

/**
 * Opens the dataset named in the URL through a project importer, retrying
 * whenever another importer is registered until one supports it
 *
 * Importers are registered by plugins, which may be loaded after startup, e.g.
 * from the plugins menu. Retrying ends once the dataset is open, once opening
 * it failed, or once another project is loaded or the project is cleared.
 * Failures are logged, unless opening was cancelled.
 *
 * @param source - The source of the dataset
 * @returns A callback that cancels opening the dataset and stops retrying
 */
function openInitialDataset(source: string): () => void {
  const abortController = new AbortController();
  let opening = false;
  let retry = false;
  let stopRetrying = () => {};
  const stop = () => {
    stopRetrying();
    abortController.abort();
  };
  const tryOpening = () => {
    if (opening) {
      retry = true; // an importer was registered while asking the others
      return;
    }
    opening = true;
    retry = false;
    loadDatasetFromSource(source, { signal: abortController.signal })
      .then((opened) => {
        opening = false;
        if (opened) {
          stopRetrying();
        } else if (retry) {
          tryOpening();
        }
      })
      .catch((error: unknown) => {
        opening = false;
        if (!abortController.signal.aborted) {
          stopRetrying();
          console.error(`Failed to open dataset from ${source}:`, error);
        }
      });
  };
  const unsubscribeImporters = appStore.subscribe((appState, prevAppState) => {
    if (appState.projectImporters !== prevAppState.projectImporters) {
      tryOpening();
    }
  });
  const unsubscribeProject = projectStore.subscribe(
    (projectState, prevProjectState) => {
      // the user opened something else in the meantime
      if (!opening && projectState.instanceId !== prevProjectState.instanceId) {
        stop();
      }
    },
  );
  stopRetrying = () => {
    unsubscribeImporters();
    unsubscribeProject();
  };
  tryOpening();
  return stop;
}
