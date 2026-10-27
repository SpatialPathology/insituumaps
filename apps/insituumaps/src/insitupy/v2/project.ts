/**
 * Reads an InSituData project from the format v2 layout (`.ispy` and the
 * stores it points to) into the {@link InSituProject} interface.
 */
import type { ImageDataSource, ShapesDataSource } from "@tissuumaps/core";

import { type InSituSource, NotFoundError } from "../source";
import type {
  CellLayer,
  DataIssue,
  GeometryEntry,
  ImageEntry,
  InSituProject,
  TranscriptsEntry,
} from "../types";
import { openCellLayerV2 } from "./cellLayer";
import {
  getMultiscale,
  getXYScale,
  isSharded,
  readZarrV3Metadata,
} from "./zarr";

/** The parts of `.ispy` the viewer reads */
export type IspyMetadata = {
  uid?: string;
  sample_id?: string;
  slide_id?: string;
  method?: string | null;
  method_params?: { pixel_size?: number } & Record<string, unknown>;
  data?: {
    images?: Record<string, string>;
    cells?: string;
    transcripts?: string;
    annotations?: string;
    regions?: string;
    units?: string;
  };
  version?: string;
};

/** `.multicelldata` */
export type MultiCellDataMetadata = {
  key_main?: string;
  all_keys?: string[];
};

/** Name of the manifest the converter writes next to GeoJSON files */
export const geometriesManifestName = "manifest.json";

/** Relative path of the InSitUUmaps transcript index folder within a project */
export const transcriptIndexDir = "transcripts/insituumaps";

export class InSituProjectV2 implements InSituProject {
  readonly source: InSituSource;
  readonly uid: string | null;
  readonly sampleId: string;
  readonly slideId: string;
  readonly method: string | null;
  readonly pixelSize: number | null;
  readonly images: ImageEntry[];
  readonly cellLayers: string[];
  readonly mainCellLayer: string | null;
  readonly transcripts: TranscriptsEntry | null;
  readonly annotations: GeometryEntry[];
  readonly regions: GeometryEntry[];
  readonly issues: DataIssue[];
  /** Path of the committed cells save (`data.cells`), if any */
  readonly cellsPath: string | null;
  private readonly _cellLayers = new Map<string, Promise<CellLayer>>();

  constructor(options: {
    source: InSituSource;
    ispy: IspyMetadata;
    images: ImageEntry[];
    cellsPath: string | null;
    cellLayers: string[];
    mainCellLayer: string | null;
    transcripts: TranscriptsEntry | null;
    annotations: GeometryEntry[];
    regions: GeometryEntry[];
    issues: DataIssue[];
  }) {
    this.source = options.source;
    this.uid = options.ispy.uid ?? null;
    this.sampleId = options.ispy.sample_id ?? "";
    this.slideId = options.ispy.slide_id ?? "";
    this.method = options.ispy.method ?? null;
    this.pixelSize = options.ispy.method_params?.pixel_size ?? null;
    this.images = options.images;
    this.cellsPath = options.cellsPath;
    this.cellLayers = options.cellLayers;
    this.mainCellLayer = options.mainCellLayer;
    this.transcripts = options.transcripts;
    this.annotations = options.annotations;
    this.regions = options.regions;
    this.issues = options.issues;
  }

  openCellLayer(
    key: string,
    options?: { signal?: AbortSignal },
  ): Promise<CellLayer> {
    if (!this.cellLayers.includes(key) || this.cellsPath === null) {
      return Promise.reject(new Error(`Unknown cell layer: ${key}`));
    }
    let promise = this._cellLayers.get(key);
    if (promise === undefined) {
      // read without the caller's signal: the promise is shared between callers
      promise = openCellLayerV2(this.source, `${this.cellsPath}/${key}`, key);
      promise.catch(() => this._cellLayers.delete(key));
      this._cellLayers.set(key, promise);
    }
    const { signal } = options ?? {};
    if (signal === undefined) {
      return promise;
    }
    if (signal.aborted) {
      return Promise.reject(signal.reason as Error);
    }
    return new Promise<CellLayer>((resolve, reject) => {
      const onAbort = () => reject(signal.reason as Error);
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(resolve, reject).finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
    });
  }
}

/**
 * Reads a project folder
 *
 * @param source - The project folder
 * @param options - Optional abort signal
 * @returns The project
 * @throws NotFoundError if the folder has no `.ispy`
 */
export async function readProjectV2(
  source: InSituSource,
  options?: { signal?: AbortSignal },
): Promise<InSituProjectV2> {
  const { signal } = options ?? {};
  const ispy = await source.readJSON<IspyMetadata>(".ispy", { signal });
  const issues: DataIssue[] = [];
  const data = ispy.data ?? {};

  const images = await readImages(source, data.images ?? {}, issues, {
    signal,
  });

  let cellsPath: string | null = data.cells ?? null;
  let cellLayers: string[] = [];
  let mainCellLayer: string | null = null;
  if (cellsPath !== null) {
    cellsPath = cellsPath.replace(/\/+$/, "");
    try {
      const multi = await source.readJSON<MultiCellDataMetadata>(
        `${cellsPath}/.multicelldata`,
        { signal },
      );
      cellLayers = [...(multi.all_keys ?? [])];
      mainCellLayer =
        multi.key_main !== undefined && cellLayers.includes(multi.key_main)
          ? multi.key_main
          : (cellLayers[0] ?? null);
      if (mainCellLayer !== null) {
        cellLayers = [
          mainCellLayer,
          ...cellLayers.filter((k) => k !== mainCellLayer),
        ];
      }
      if (cellLayers.length === 0) {
        issues.push({
          severity: "warning",
          subject: "Cells",
          message: `${cellsPath}/.multicelldata lists no cell layers.`,
        });
      }
    } catch (error) {
      signal?.throwIfAborted();
      issues.push({
        severity: "error",
        subject: "Cells",
        message:
          error instanceof NotFoundError
            ? `The cells folder ${cellsPath} has no .multicelldata file.`
            : `Could not read ${cellsPath}/.multicelldata: ${String(error)}`,
      });
      cellsPath = null;
    }
  } else {
    issues.push({
      severity: "info",
      subject: "Cells",
      message: "This project has no cells (segmentation) data.",
    });
  }

  let transcripts: TranscriptsEntry | null = null;
  if (data.transcripts !== undefined) {
    const parquetPath = data.transcripts;
    let index: TranscriptsEntry["index"] = null;
    try {
      if (await source.exists(`${transcriptIndexDir}/index.json`, { signal })) {
        index = { source: source.child(transcriptIndexDir) };
      }
    } catch {
      signal?.throwIfAborted();
    }
    transcripts = {
      parquetPath,
      parquetSource: source.resolve(parquetPath),
      index,
    };
    if (index === null) {
      issues.push({
        severity: "info",
        subject: "Transcripts",
        message:
          "No InSitUUmaps transcript index was found; transcripts are loaded from the Parquet file, which is slow for large samples.",
      });
    }
  }

  const annotations = await readGeometries(
    source,
    data.annotations,
    "annotation",
    issues,
    { signal },
  );
  const regions = await readGeometries(source, data.regions, "region", issues, {
    signal,
  });

  return new InSituProjectV2({
    source,
    ispy,
    images,
    cellsPath,
    cellLayers,
    mainCellLayer,
    transcripts,
    annotations,
    regions,
    issues,
  });
}

async function readImages(
  source: InSituSource,
  imagePaths: Record<string, string>,
  issues: DataIssue[],
  options?: { signal?: AbortSignal },
): Promise<ImageEntry[]> {
  const { signal } = options ?? {};
  const entries = await Promise.all(
    Object.entries(imagePaths).map(async ([name, path]) => {
      const cleanPath = path.replace(/\/+$/, "");
      if (cleanPath.toLowerCase().endsWith(".zip")) {
        issues.push({
          severity: "warning",
          subject: `Image ${name}`,
          message: `${cleanPath} is a zipped store, which the viewer cannot read with range requests. Save the image as a plain .zarr folder.`,
        });
        return null;
      }
      try {
        const metadata = await readZarrV3Metadata(source, cleanPath, {
          signal,
        });
        const attrs = metadata.attributes ?? {};
        const multiscale = getMultiscale(attrs);
        if (multiscale === undefined) {
          issues.push({
            severity: "warning",
            subject: `Image ${name}`,
            message: `${cleanPath} has no OME-NGFF multiscales metadata (saved with save_pyramid=False?). It is skipped.`,
          });
          return null;
        }
        const scale = getXYScale(multiscale);
        const pixelSize =
          typeof attrs.pixel_size === "number"
            ? attrs.pixel_size
            : (scale?.x ?? 1);
        const shape = Array.isArray(attrs.shape)
          ? (attrs.shape as number[])
          : undefined;
        const rgb =
          attrs.rgb === true ||
          multiscale.axes.some((a) => a.name === "c") ||
          (shape !== undefined && shape.length === 3);
        let size: ImageEntry["size"];
        if (shape !== undefined) {
          const yi = multiscale.axes.findIndex((a) => a.name === "y");
          const xi = multiscale.axes.findIndex((a) => a.name === "x");
          if (yi >= 0 && xi >= 0) {
            size = { width: shape[xi]!, height: shape[yi]! };
          }
        }
        let window: ImageEntry["window"];
        const omero = (attrs.ome as { omero?: unknown } | undefined)?.omero;
        const channel0 = (
          omero as
            | { channels?: { window?: { start?: number; end?: number } }[] }
            | undefined
        )?.channels?.[0];
        if (
          typeof channel0?.window?.start === "number" &&
          typeof channel0.window.end === "number"
        ) {
          window = [channel0.window.start, channel0.window.end];
        }
        let dtypeMax: number | undefined;
        try {
          const level0 = await readZarrV3Metadata(
            source,
            `${cleanPath}/${multiscale.datasets[0]?.path ?? "0"}`,
            { signal },
          );
          const dtype =
            typeof level0.data_type === "string" ? level0.data_type : "";
          const bits = /^uint(8|16|32)$/.exec(dtype)?.[1];
          if (bits !== undefined) {
            dtypeMax = 2 ** Number(bits) - 1;
          }
          if (!isSharded(level0)) {
            const chunk = level0.chunk_grid?.configuration.chunk_shape;
            const tile = chunk?.at(-1) ?? 0;
            if (tile > 1024) {
              issues.push({
                severity: "warning",
                subject: `Image ${name}`,
                message: `The image uses ${tile} px chunks without sharding; tiles this large load slowly over the network. Re-save the image with the sharded layout.`,
              });
            }
          }
        } catch {
          signal?.throwIfAborted();
        }
        const dataSource: ImageDataSource = {
          type: "ome-zarr",
          source: source.resolve(cleanPath),
        };
        const entry: ImageEntry = {
          name,
          pixelSize,
          rgb,
          size,
          window,
          dtypeMax,
          dataSource,
        };
        return entry;
      } catch (error) {
        signal?.throwIfAborted();
        issues.push({
          severity: "error",
          subject: `Image ${name}`,
          message:
            error instanceof NotFoundError
              ? `${cleanPath} was not found.`
              : `Could not read ${cleanPath}: ${String(error)}`,
        });
        return null;
      }
    }),
  );
  // RGB images (H&E) first, then grayscale, each in .ispy order
  const images = entries.filter((e) => e !== null);
  return [...images.filter((i) => i.rgb), ...images.filter((i) => !i.rgb)];
}

async function readGeometries(
  source: InSituSource,
  dirPath: string | undefined,
  kind: GeometryEntry["kind"],
  issues: DataIssue[],
  options?: { signal?: AbortSignal },
): Promise<GeometryEntry[]> {
  const { signal } = options ?? {};
  if (dirPath === undefined) {
    return [];
  }
  const dir = dirPath.replace(/\/+$/, "");
  const subject = kind === "annotation" ? "Annotations" : "Regions";
  let files: string[] | null = null;
  try {
    const manifest = await source.readJSON<{
      keys?: Record<string, string>;
      files?: string[];
    }>(`${dir}/${geometriesManifestName}`, { signal });
    files =
      manifest.files ??
      (manifest.keys !== undefined ? Object.values(manifest.keys) : []);
  } catch (error) {
    signal?.throwIfAborted();
    if (!(error instanceof NotFoundError)) {
      issues.push({
        severity: "warning",
        subject,
        message: `Could not read ${dir}/${geometriesManifestName}: ${String(error)}`,
      });
    }
  }
  if (files === null) {
    try {
      const listing = await source.list(dir, { signal });
      if (listing !== null) {
        files = listing
          .filter(
            (e) =>
              e.kind === "file" && e.name.toLowerCase().endsWith(".geojson"),
          )
          .map((e) => e.name);
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof NotFoundError) {
        issues.push({
          severity: "warning",
          subject,
          message: `The folder ${dir} listed in .ispy does not exist.`,
        });
        return [];
      }
      throw error;
    }
  }
  if (files === null) {
    issues.push({
      severity: "info",
      subject,
      message: `${subject} exist in ${dir}, but the files cannot be listed over HTTP. Run the InSitUUmaps converter to write ${dir}/${geometriesManifestName}.`,
    });
    return [];
  }
  return files.map((file) => {
    const key = file.replace(/\.geojson$/i, "");
    const dataSource: ShapesDataSource = {
      type: "geojson",
      source: source.resolve(`${dir}/${file}`),
    };
    return { kind, key, dataSource };
  });
}
