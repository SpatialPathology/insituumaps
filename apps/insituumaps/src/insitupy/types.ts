/**
 * The InSituPy-shaped data model that the UI talks to.
 *
 * Nothing in this file knows how data is stored. `./v2` implements it for the
 * format v2 on-disk layout; a SpatialData-backed implementation would
 * implement the same interfaces. The "source descriptors" below are
 * TissUUmaps data sources (`{ type, source, ... }`), which the viewer hands
 * to the existing TissUUmaps storage providers; an implementation is free to
 * return descriptors of any registered provider type.
 */
import type {
  ImageDataSource,
  LabelsDataSource,
  ShapesDataSource,
  TableDataSource,
} from "@tissuumaps/core";

import type { InSituSource } from "./source";

/** A problem found while reading data; shown to the user, never swallowed */
export type DataIssue = {
  severity: "error" | "warning" | "info";
  /** What is affected, e.g. "Cell layer main" */
  subject: string;
  message: string;
};

/** One sample of an experiment */
export type SampleEntry = {
  /** Position in the experiment (the `data-NNN` index) */
  index: number;
  /** Relative path of the project folder within the experiment */
  path: string;
  /** Display name: sample_id, or the folder name */
  name: string;
  /** From the project's `.ispy`, once read (see {@link InSituExperiment.loadSampleInfo}) */
  sampleId?: string;
  slideId?: string;
  /** The row of the metadata table, by column name */
  metadata: Record<string, string | number | boolean | null>;
};

/** The experiment-level metadata table */
export type MetadataTable = {
  columns: string[];
  rows: Record<string, string | number | boolean | null>[];
};

/** An InSituExperiment: a folder of projects plus a metadata table */
export interface InSituExperiment {
  readonly source: InSituSource;
  readonly name: string;
  readonly samples: SampleEntry[];
  readonly metadata: MetadataTable;
  /** Color schemes from `colors.json`, if any (column -> value -> hex) */
  readonly colors: Record<string, Record<string, string>>;
  readonly issues: DataIssue[];
  openSample(
    index: number,
    options?: { signal?: AbortSignal },
  ): Promise<InSituProject>;
  /**
   * Reads the sample and slide ids of every sample (one small request each)
   * into {@link SampleEntry.sampleId} and {@link SampleEntry.slideId}; samples
   * that cannot be read are left as they are
   */
  loadSampleInfo(options?: { signal?: AbortSignal }): Promise<void>;
}

/** A raster image of a project (H&E, DAPI, ...) */
export type ImageEntry = {
  /** Image name as in `.ispy` (e.g. "HE", "nuclei") */
  name: string;
  /** Pixel size in µm/pixel */
  pixelSize: number;
  /** Whether the image is RGB (channel-first on disk) or single-channel */
  rgb: boolean;
  /** Size in pixels of the full-resolution level, if known */
  size?: { width: number; height: number };
  /** Contrast window (start, end) written in the omero metadata, grayscale images */
  window?: [number, number];
  /** Largest value the pixel type can hold (255, 65535), if integer */
  dtypeMax?: number;
  /** Data source of the image for the viewer */
  dataSource: ImageDataSource;
};

/** A vector overlay (annotations or regions), one GeoJSON file */
export type GeometryEntry = {
  kind: "annotation" | "region";
  /** Key (the class or region set name) */
  key: string;
  dataSource: ShapesDataSource;
};

/** Transcripts of a project */
export type TranscriptsEntry = {
  /** Relative path of the Parquet file */
  parquetPath: string;
  /** Data source of the Parquet file for the viewer (plain layout) */
  parquetSource: string;
  /**
   * The InSitUUmaps transcript index next to it, if the converter wrote one
   * (see `../transcripts`)
   */
  index: { source: InSituSource } | null;
};

/** An expression source within a cell layer's AnnData: `.X` or a layer */
export type ExpressionSource = {
  /** Display name: "X" or the layer name */
  name: string;
  /** Column query prefix for the TissUUmaps table, e.g. "X" or "layers/counts" */
  matrixPath: string;
};

/** A column of `obs` */
export type ObsColumn = {
  name: string;
  kind: "numeric" | "categorical" | "boolean";
  /** Categories in order, for categorical columns (and booleans) */
  categories?: string[];
};

/** Which label mask a mask entry is, and how its labels map to table rows */
export type MaskEntry = {
  kind: "cells" | "nuclei";
  pixelSize: number;
  size: { width: number; height: number };
  /** Number of pyramid levels */
  levels: number;
  /** Data source for the viewer */
  dataSource: LabelsDataSource;
  /**
   * Reads the raster label at a position in µm (0 for background or outside
   * the mask), straight from the store; used to inspect a cell
   */
  readLabel(
    x: number,
    y: number,
    options?: { signal?: AbortSignal },
  ): Promise<number>;
  /**
   * How raster labels relate to table rows:
   * - `direct`: label value == `obs/_label_id`
   * - `mapped`: label value - offset indexes `labelToRow`
   */
  labelMapping:
    | { kind: "direct" }
    | {
        kind: "mapped";
        offset: number;
        /** For every raster label (as index after subtracting `offset`), the table row, or -1 */
        labelToRow: Int32Array;
      };
};

/** The cell table of a cell layer: AnnData with cells as rows */
export interface CellTable {
  /** Number of cells */
  readonly numCells: number;
  /** Gene names (`var` index), in matrix column order */
  readonly genes: string[];
  /** Expression sources, `.X` first */
  readonly expressionSources: ExpressionSource[];
  /** Columns of `obs` the user can colour by (internal columns excluded) */
  readonly obsColumns: ObsColumn[];
  /** Whether cell centroids (`obsm/spatial`) are available */
  readonly hasCentroids: boolean;
  /** TissUUmaps table data source (rows keyed by `obs/_label_id`) */
  readonly dataSource: TableDataSource;
  /** Cell names (`obs` index); loaded lazily */
  loadCellNames(options?: { signal?: AbortSignal }): Promise<string[]>;
  /** Raster labels of the cells (`obs/_label_id`), 0 if a cell has no mask */
  loadLabelIds(options?: { signal?: AbortSignal }): Promise<Uint32Array>;
  /** Column query of a gene in an expression source, for the TissUUmaps table */
  geneColumnQuery(source: ExpressionSource, gene: string): string;
  /** Column query of an obs column, for the TissUUmaps table */
  obsColumnQuery(column: string): string;
}

/** A cell layer (segmentation), e.g. "main" or "proseg" */
export interface CellLayer {
  readonly key: string;
  readonly table: CellTable;
  readonly masks: { cells?: MaskEntry; nuclei?: MaskEntry };
  readonly issues: DataIssue[];
}

/** An InSituData project (one sample) */
export interface InSituProject {
  readonly source: InSituSource;
  /** Short unique id (`.ispy` uid), if present */
  readonly uid: string | null;
  readonly sampleId: string;
  readonly slideId: string;
  readonly method: string | null;
  /** Pixel size in µm/pixel from `method_params`, if present */
  readonly pixelSize: number | null;
  readonly images: ImageEntry[];
  /** Cell layer keys, main layer first */
  readonly cellLayers: string[];
  readonly mainCellLayer: string | null;
  readonly transcripts: TranscriptsEntry | null;
  readonly annotations: GeometryEntry[];
  readonly regions: GeometryEntry[];
  readonly issues: DataIssue[];
  openCellLayer(
    key: string,
    options?: { signal?: AbortSignal },
  ): Promise<CellLayer>;
}

/** What a source turned out to be */
export type OpenedSource =
  | { kind: "project"; project: InSituProject }
  | { kind: "experiment"; experiment: InSituExperiment };
