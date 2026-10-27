/**
 * Reads an InSituExperiment folder: `metadata.parquet` (or `metadata.csv`),
 * `colors.json`, and the `data-NNN` project folders.
 */
import { parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";

import { type InSituSource, NotFoundError } from "../source";
import type {
  DataIssue,
  InSituExperiment,
  InSituProject,
  MetadataTable,
  SampleEntry,
} from "../types";
import { type IspyMetadata, readProjectV2 } from "./project";

type MetadataValue = string | number | boolean | null;

/** Folder name of the i-th dataset of an experiment */
export function sampleFolderName(index: number): string {
  return `data-${String(index).padStart(3, "0")}`;
}

export class InSituExperimentV2 implements InSituExperiment {
  readonly source: InSituSource;
  readonly name: string;
  readonly samples: SampleEntry[];
  readonly metadata: MetadataTable;
  readonly colors: Record<string, Record<string, string>>;
  readonly issues: DataIssue[];
  private readonly _projects = new Map<number, Promise<InSituProject>>();
  private _sampleInfo: Promise<void> | undefined;

  constructor(options: {
    source: InSituSource;
    samples: SampleEntry[];
    metadata: MetadataTable;
    colors: Record<string, Record<string, string>>;
    issues: DataIssue[];
  }) {
    this.source = options.source;
    this.name =
      options.source.label.replace(/\/+$/, "").split("/").at(-1) ?? "";
    this.samples = options.samples;
    this.metadata = options.metadata;
    this.colors = options.colors;
    this.issues = options.issues;
  }

  openSample(
    index: number,
    options?: { signal?: AbortSignal },
  ): Promise<InSituProject> {
    const sample = this.samples.find((s) => s.index === index);
    if (sample === undefined) {
      return Promise.reject(new Error(`Unknown sample index: ${index}`));
    }
    let promise = this._projects.get(index);
    if (promise === undefined) {
      // read without the caller's signal: the promise is shared between callers
      promise = readProjectV2(this.source.child(sample.path)).then(
        (project) => {
          const uid = sample.metadata["uid"];
          if (
            project.uid !== null &&
            typeof uid === "string" &&
            uid !== "" &&
            uid !== project.uid
          ) {
            project.issues.push({
              severity: "warning",
              subject: "Experiment",
              message: `The metadata row of ${sample.path} has uid ${uid}, but the project's .ispy has uid ${project.uid}. The folders and the metadata table may be out of sync.`,
            });
          }
          if (project.sampleId !== "") {
            sample.name = project.sampleId;
          }
          return project;
        },
      );
      promise.catch(() => this._projects.delete(index));
      this._projects.set(index, promise);
    }
    return raceSignal(promise, options?.signal);
  }

  loadSampleInfo(options?: { signal?: AbortSignal }): Promise<void> {
    this._sampleInfo ??= (async () => {
      const pending = this.samples.filter((s) => s.sampleId === undefined);
      const concurrency = 6;
      let next = 0;
      const worker = async () => {
        while (next < pending.length) {
          const sample = pending[next++]!;
          try {
            const ispy = await this.source
              .child(sample.path)
              .readJSON<IspyMetadata>(".ispy");
            sample.sampleId = ispy.sample_id ?? "";
            sample.slideId = ispy.slide_id ?? "";
            if (sample.name === sample.path && sample.sampleId !== "") {
              sample.name = sample.sampleId;
            }
          } catch {
            // left for openSample to report
          }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, worker));
    })();
    this._sampleInfo.catch(() => (this._sampleInfo = undefined));
    return raceSignal(this._sampleInfo, options?.signal);
  }
}

function raceSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason as Error);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason as Error);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

/**
 * Reads an experiment folder
 *
 * @throws NotFoundError if the folder has neither `metadata.parquet` nor `metadata.csv`
 */
export async function readExperimentV2(
  source: InSituSource,
  options?: { signal?: AbortSignal },
): Promise<InSituExperimentV2> {
  const { signal } = options ?? {};
  const issues: DataIssue[] = [];
  let metadata: MetadataTable;
  try {
    metadata = await readMetadataParquet(source, { signal });
  } catch (error) {
    signal?.throwIfAborted();
    if (!(error instanceof NotFoundError)) {
      issues.push({
        severity: "warning",
        subject: "Experiment",
        message: `Could not read metadata.parquet (${String(error)}); trying metadata.csv.`,
      });
    }
    metadata = await readMetadataCSV(source, { signal });
  }
  let colors: Record<string, Record<string, string>> = {};
  try {
    const raw = await source.readJSON<unknown>("colors.json", { signal });
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      colors = raw as Record<string, Record<string, string>>;
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (!(error instanceof NotFoundError)) {
      issues.push({
        severity: "info",
        subject: "Experiment",
        message: `colors.json could not be read: ${String(error)}`,
      });
    }
  }
  const samples: SampleEntry[] = metadata.rows.map((row, index) => {
    const path = sampleFolderName(index);
    const nameValue = row["sample_id"] ?? row["name"];
    return {
      index,
      path,
      name:
        typeof nameValue === "string" && nameValue !== "" ? nameValue : path,
      metadata: row,
    };
  });
  if (samples.length === 0) {
    issues.push({
      severity: "warning",
      subject: "Experiment",
      message: "The metadata table lists no samples.",
    });
  }
  return new InSituExperimentV2({ source, samples, metadata, colors, issues });
}

async function readMetadataParquet(
  source: InSituSource,
  options?: { signal?: AbortSignal },
): Promise<MetadataTable> {
  const { signal } = options ?? {};
  const bytes = await source.readBytes("metadata.parquet", { signal });
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const rows = (await parquetReadObjects({
    file: buffer,
    compressors,
  })) as Record<string, unknown>[];
  const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
  return {
    columns: columns.filter((c) => !isIndexColumn(c)),
    rows: rows.map((row) => {
      const clean: Record<string, MetadataValue> = {};
      for (const [key, value] of Object.entries(row)) {
        if (isIndexColumn(key)) {
          continue;
        }
        clean[key] = toMetadataValue(value);
      }
      return clean;
    }),
  };
}

async function readMetadataCSV(
  source: InSituSource,
  options?: { signal?: AbortSignal },
): Promise<MetadataTable> {
  const text = await source.readText("metadata.csv", options);
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !line.startsWith("#"));
  if (lines.length === 0) {
    return { columns: [], rows: [] };
  }
  const header = parseCSVLine(lines[0]!);
  const rows = lines.slice(1).map((line) => {
    const cells = parseCSVLine(line);
    const row: Record<string, MetadataValue> = {};
    header.forEach((column, i) => {
      if (isIndexColumn(column)) {
        return;
      }
      const cell = cells[i] ?? "";
      const asNumber = Number(cell);
      row[column] =
        cell === ""
          ? null
          : cell.trim() !== "" && !Number.isNaN(asNumber)
            ? asNumber
            : cell;
    });
    return row;
  });
  return { columns: header.filter((c) => !isIndexColumn(c)), rows };
}

/** The unnamed pandas index column of a CSV/Parquet export */
function isIndexColumn(name: string): boolean {
  return name === "" || name === "__index_level_0__" || name === "Unnamed: 0";
}

function toMetadataValue(value: unknown): MetadataValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return JSON.stringify(value);
}

/** Parses one CSV line with double-quote escaping */
export function parseCSVLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}
