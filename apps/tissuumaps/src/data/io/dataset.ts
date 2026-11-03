import {
  type ProjectImporter,
  SourceUtils,
  createProject,
} from "@tissuumaps/core";

import { appStore } from "@/stores/app";

import { datasetURLParam, loadProject, projectURLParam } from "./project";

/**
 * Finds the first project importer that supports a source
 *
 * All importers are asked at once; a rejection counts as not supported. Of
 * those that support the source, the one registered first wins.
 *
 * @param importers - The importers to ask, in registration order
 * @param normalizedSource - The normalized source of the dataset
 * @param workspace - The directory handle of the open workspace, if any
 * @param options - Optional abort signal
 * @returns The importer to open the source with, if any supports it
 */
export async function findProjectImporter(
  importers: readonly ProjectImporter[],
  normalizedSource: string,
  workspace: FileSystemDirectoryHandle | null,
  options?: { signal?: AbortSignal },
): Promise<ProjectImporter | undefined> {
  const support = await Promise.all(
    importers.map(async (importer) => {
      try {
        return await importer.supports(normalizedSource, workspace, options);
      } catch {
        return false; // treated as unsupported
      }
    }),
  );
  options?.signal?.throwIfAborted();
  return importers.find((_, index) => support[index]);
}

/**
 * Opens a dataset through the first registered project importer that supports
 * it, and loads the project it builds into the project store
 *
 * The project is loaded with the normalized source as its project source and
 * with the importer's ID.
 *
 * @param source - The source of the dataset, e.g. the URL of its folder
 * @param options - Optional abort signal
 * @returns Whether an importer supported the source; if none did, nothing was
 * loaded
 * @throws Error if the importer fails to open the dataset
 */
export async function loadDatasetFromSource(
  source: string,
  options?: { signal?: AbortSignal },
): Promise<boolean> {
  const { projectImporters, workspace } = appStore.getState();
  const normalizedSource = SourceUtils.normalizeSource(source, workspace, null);
  const importer = await findProjectImporter(
    [...projectImporters.values()],
    normalizedSource,
    workspace,
    options,
  );
  if (importer === undefined) {
    return false;
  }
  const rawProject = await importer.open(normalizedSource, workspace, options);
  options?.signal?.throwIfAborted();
  loadProject(createProject(rawProject), normalizedSource, importer.id);
  return true;
}

/**
 * Records the dataset source in the address bar, so that reloading the page
 * opens the same dataset
 *
 * @param source - The source the dataset was opened from
 */
export function setDatasetURLParam(source: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(datasetURLParam, source);
  url.searchParams.delete(projectURLParam);
  window.history.replaceState({}, "", url);
}
