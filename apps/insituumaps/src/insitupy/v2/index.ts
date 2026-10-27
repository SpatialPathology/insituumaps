/**
 * Entry point of the format v2 implementation: tells projects from experiments
 */
import { type InSituSource, NotFoundError } from "../source";
import type { OpenedSource } from "../types";
import { readExperimentV2 } from "./experiment";
import { readProjectV2 } from "./project";

export { readExperimentV2, sampleFolderName } from "./experiment";
export { readProjectV2 } from "./project";
export { openCellLayerV2, labelIdColumn } from "./cellLayer";

/**
 * Opens a folder as a project (it has `.ispy`) or an experiment (it has a
 * metadata table)
 *
 * @throws Error with a user-readable message if it is neither
 */
export async function openSourceV2(
  source: InSituSource,
  options?: { signal?: AbortSignal },
): Promise<OpenedSource> {
  const { signal } = options ?? {};
  try {
    const project = await readProjectV2(source, { signal });
    return { kind: "project", project };
  } catch (error) {
    signal?.throwIfAborted();
    if (!(error instanceof NotFoundError)) {
      throw error;
    }
  }
  try {
    const experiment = await readExperimentV2(source, { signal });
    return { kind: "experiment", experiment };
  } catch (error) {
    signal?.throwIfAborted();
    if (!(error instanceof NotFoundError)) {
      throw error;
    }
  }
  throw new Error(
    `${source.label} is neither an InSituPy project (no .ispy file) nor an experiment (no metadata.parquet or metadata.csv). ` +
      (source.kind === "url"
        ? "Check the URL and that the server allows cross-origin requests."
        : "Pick the project or experiment folder itself."),
  );
}
