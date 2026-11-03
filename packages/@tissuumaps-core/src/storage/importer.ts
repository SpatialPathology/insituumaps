import type { RawProject } from "../model/project";

/**
 * Opens a dataset that is not a TissUUmaps project file, such as a SpatialData
 * store or an InSituPy project, by building a project from it
 *
 * Importers are registered with the application (see the app store's
 * `registerProjectImporter`). When the user opens a dataset, the application
 * asks every registered importer whether it supports the dataset's source and
 * opens it with the first that does.
 */
export interface ProjectImporter {
  /** The unique ID of the importer */
  readonly id: string;

  /** The human-readable name of the importer, e.g. of the dataset format */
  readonly name: string;

  /**
   * Returns whether this importer can likely open a source
   *
   * Should be cheap, e.g. by reading a single metadata file of the dataset.
   * Callers treat a rejection as `false`.
   *
   * @param normalizedSource - The source, normalized with
   * `SourceUtils.normalizeSource`: an absolute URL, or a workspace-relative path
   * @param workspace - The directory handle of the open workspace, if any
   * @param options - Optional abort signal
   * @returns A promise that resolves to whether the source is supported
   */
  supports(
    normalizedSource: string,
    workspace: FileSystemDirectoryHandle | null,
    options?: { signal?: AbortSignal },
  ): Promise<boolean>;

  /**
   * Builds the project that a source describes
   *
   * The application loads the returned project with the source as its project
   * source, so relative data sources are resolved against it.
   *
   * @param normalizedSource - The source, normalized as for {@link supports}
   * @param workspace - The directory handle of the open workspace, if any
   * @param options - Optional abort signal
   * @returns A promise that resolves to the project
   */
  open(
    normalizedSource: string,
    workspace: FileSystemDirectoryHandle | null,
    options?: { signal?: AbortSignal },
  ): Promise<RawProject>;
}
