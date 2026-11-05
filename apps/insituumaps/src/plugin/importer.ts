/**
 * The InSituPy project importer, which lets the TissUUmaps app open InSituPy
 * projects and experiments by URL (`?source=`, "Open dataset from URL…")
 *
 * Opening goes through the fork store, as from the plugin's start screen, so
 * that the plugin's sidebar shows the opened dataset; the importer returns the
 * project the fork store built.
 */
import type { ProjectImporter, RawProject } from "@tissuumaps/core";

import { URLSource } from "@/insitupy";
import { useAppStore as insitupyStore } from "@/state/store";

/** The ID of the InSituPy importer, which the plugin's lens applies to */
export const insitupyImporterId = "insitupy";

/**
 * Returns whether a normalized source is a URL, as opposed to a
 * workspace-relative path
 *
 * Folders on the user's computer are opened from the plugin's start screen
 * instead, which hands the folder to the app as its workspace.
 */
function isURL(normalizedSource: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(normalizedSource);
}

/** The InSituPy importer */
export const insitupyImporter: ProjectImporter = {
  id: insitupyImporterId,
  name: "InSituPy",
  supports: async (normalizedSource, _workspace, options) => {
    if (!isURL(normalizedSource)) {
      return false;
    }
    // the markers openSource looks for: a project's .ispy, an experiment's
    // metadata table
    const source = new URLSource(normalizedSource);
    for (const marker of [".ispy", "metadata.parquet", "metadata.csv"]) {
      if (await source.exists(marker, options)) {
        return true;
      }
    }
    return false;
  },
  open: async (normalizedSource): Promise<RawProject> => {
    await insitupyStore.getState().openUrl(normalizedSource);
    const state = insitupyStore.getState();
    if (state.openStatus.phase === "error") {
      throw new Error(state.openStatus.message);
    }
    if (state.projectStatus.phase === "error") {
      throw new Error(state.projectStatus.message);
    }
    // an experiment without a chosen sample has an empty model; its sample
    // browser opens in the plugin's panel
    const sample = state.experiment?.samples.find(
      (s) => s.index === state.sampleIndex,
    );
    return {
      name:
        sample?.name ??
        state.project?.sampleId ??
        state.experiment?.name ??
        "InSituPy",
      ...state.model,
    };
  },
};
