/**
 * Reads one cell layer of the format v2 layout: the viewer table
 * (`X_csc.zarr`, AnnData zarr v2) and the label masks (`boundaries.zarr`,
 * Zarr v3).
 */
import * as zarr from "zarrita";

import type { LabelsDataSource, TableDataSource } from "@tissuumaps/core";

import { type InSituSource, NotFoundError } from "../source";
import type {
  CellLayer,
  CellTable,
  DataIssue,
  ExpressionSource,
  MaskEntry,
  ObsColumn,
} from "../types";
import {
  InSituSourceStore,
  type ZarrV2Tree,
  getMultiscale,
  getXYScale,
  readZarrV2Array,
  readZarrV2Tree,
  readZarrV3Array1D,
  readZarrV3Metadata,
} from "./zarr";

/** `.celldata` */
export type CellDataMetadata = {
  table?: string;
  boundaries?: string;
  x_csc?: string;
  version?: string;
};

/** The `labels` attribute of a mask group */
type MaskLabelsAttr = { array: string; offset: number };

/** Column of the viewer table holding the raster label of each cell */
export const labelIdColumn = "obs/_label_id";

/** obs columns that are internal to the viewer table and never offered */
const hiddenObsColumns = new Set(["_label_id", "_index"]);

export class CellTableV2 implements CellTable {
  readonly numCells: number;
  readonly genes: string[];
  readonly expressionSources: ExpressionSource[];
  readonly obsColumns: ObsColumn[];
  readonly hasCentroids: boolean;
  readonly dataSource: TableDataSource;
  private readonly _source: InSituSource;
  private readonly _storePath: string;
  private readonly _obsIndexPath: string;
  private _cellNames: Promise<string[]> | undefined;
  private _labelIds: Promise<Uint32Array> | undefined;

  constructor(options: {
    source: InSituSource;
    storePath: string;
    numCells: number;
    genes: string[];
    expressionSources: ExpressionSource[];
    obsColumns: ObsColumn[];
    hasCentroids: boolean;
    obsIndexPath: string;
  }) {
    this._source = options.source;
    this._storePath = options.storePath;
    this.numCells = options.numCells;
    this.genes = options.genes;
    this.expressionSources = options.expressionSources;
    this.obsColumns = options.obsColumns;
    this.hasCentroids = options.hasCentroids;
    this._obsIndexPath = options.obsIndexPath;
    this.dataSource = {
      type: "zarr",
      source: options.source.resolve(options.storePath),
      idColumn: labelIdColumn,
    } as TableDataSource;
  }

  loadCellNames(options?: { signal?: AbortSignal }): Promise<string[]> {
    this._cellNames ??= readZarrV2Array(
      this._source,
      this._storePath,
      this._obsIndexPath,
      options,
    ).then((values) => Array.from(values as ArrayLike<unknown>, String));
    this._cellNames.catch(() => (this._cellNames = undefined));
    return this._cellNames;
  }

  loadLabelIds(options?: { signal?: AbortSignal }): Promise<Uint32Array> {
    this._labelIds ??= readZarrV2Array(
      this._source,
      this._storePath,
      labelIdColumn,
      options,
    ).then((values) => Uint32Array.from(values as ArrayLike<number>));
    this._labelIds.catch(() => (this._labelIds = undefined));
    return this._labelIds;
  }

  geneColumnQuery(source: ExpressionSource, gene: string): string {
    const index = this.genes.indexOf(gene);
    // by index: gene names may contain characters the query syntax reserves
    return `${source.matrixPath}[${index >= 0 ? index : gene}]`;
  }

  obsColumnQuery(column: string): string {
    return `obs/${column}`;
  }
}

/**
 * Opens a cell layer
 *
 * @param source - The project folder
 * @param layerPath - Path of the layer folder (`cells/<uid>/<key>`)
 * @param key - The layer key
 */
export async function openCellLayerV2(
  source: InSituSource,
  layerPath: string,
  key: string,
  options?: { signal?: AbortSignal },
): Promise<CellLayer> {
  const { signal } = options ?? {};
  const issues: DataIssue[] = [];
  const subject = `Cell layer ${key}`;
  let celldata: CellDataMetadata;
  try {
    celldata = await source.readJSON<CellDataMetadata>(
      `${layerPath}/.celldata`,
      { signal },
    );
  } catch (error) {
    throw new Error(
      error instanceof NotFoundError
        ? `Cell layer "${key}" has no .celldata file (${layerPath}).`
        : `Could not read ${layerPath}/.celldata: ${String(error)}`,
      { cause: error },
    );
  }
  const storePath = `${layerPath}/${celldata.x_csc ?? "X_csc.zarr"}`;
  let tree: ZarrV2Tree;
  try {
    tree = await readZarrV2Tree(source, storePath, { signal });
  } catch (error) {
    throw new Error(
      error instanceof NotFoundError
        ? `Cell layer "${key}" has no viewer table (${storePath}). Save the project with InSituPy >= 0.12 to write it.`
        : `Could not read the viewer table ${storePath}: ${String(error)}`,
      { cause: error },
    );
  }
  const table = await readTable(source, storePath, tree, issues, subject, {
    signal,
  });
  const masks = await readMasks(
    source,
    `${layerPath}/${celldata.boundaries ?? "boundaries.zarr"}`,
    table,
    issues,
    subject,
    { signal },
  );
  return { key, table, masks, issues };
}

async function readTable(
  source: InSituSource,
  storePath: string,
  tree: ZarrV2Tree,
  issues: DataIssue[],
  subject: string,
  options?: { signal?: AbortSignal },
): Promise<CellTableV2> {
  const { signal } = options ?? {};
  if (tree.encodingType("") !== "anndata") {
    issues.push({
      severity: "warning",
      subject,
      message: `${storePath} is not marked as an AnnData store; reading it anyway.`,
    });
  }
  const obsIndexName = tree.attrs("obs")["_index"];
  const obsIndexPath = `obs/${typeof obsIndexName === "string" ? obsIndexName : "_index"}`;
  const obsIndex = tree.array(obsIndexPath);
  if (obsIndex === undefined) {
    throw new Error(`The viewer table ${storePath} has no obs index.`);
  }
  const numCells = obsIndex.shape[0]!;
  if (tree.array(labelIdColumn) === undefined) {
    throw new Error(
      `The viewer table ${storePath} has no ${labelIdColumn} column, so cells cannot be joined to the masks.`,
    );
  }

  // genes
  const varIndexName = tree.attrs("var")["_index"];
  const varIndexPath = `var/${typeof varIndexName === "string" ? varIndexName : "_index"}`;
  let genes: string[] = [];
  if (tree.array(varIndexPath) !== undefined) {
    const values = await readZarrV2Array(source, storePath, varIndexPath, {
      signal,
    });
    genes = Array.from(values as ArrayLike<unknown>, String);
  } else {
    issues.push({
      severity: "warning",
      subject,
      message: "The viewer table has no var index; genes cannot be listed.",
    });
  }

  // expression sources: X and layers/<name>, CSC only
  const expressionSources: ExpressionSource[] = [];
  const checkMatrix = (path: string, name: string) => {
    const encoding = tree.encodingType(path);
    if (encoding === "csc_matrix") {
      expressionSources.push({ name, matrixPath: path });
    } else if (encoding === "csr_matrix") {
      issues.push({
        severity: "warning",
        subject,
        message: `${name} is stored as CSR in the viewer table; only CSC matrices can be read per gene. It is not offered.`,
      });
    } else if (tree.array(path) !== undefined) {
      // dense 2-D array: readable per column through the TissUUmaps reader
      expressionSources.push({ name, matrixPath: path });
    }
  };
  if (tree.has("X")) {
    checkMatrix("X", "X");
  } else {
    issues.push({
      severity: "warning",
      subject,
      message: "The viewer table has no X matrix.",
    });
  }
  for (const layer of tree.children("layers")) {
    checkMatrix(`layers/${layer}`, layer);
  }

  // obs columns
  const columnOrder = tree.attrs("obs")["column-order"];
  const obsNames = Array.isArray(columnOrder)
    ? (columnOrder as string[])
    : tree.children("obs");
  const obsColumns: ObsColumn[] = [];
  for (const name of obsNames) {
    if (hiddenObsColumns.has(name) || `obs/${name}` === obsIndexPath) {
      continue;
    }
    const path = `obs/${name}`;
    const encoding = tree.encodingType(path);
    const array = tree.array(path);
    if (encoding === "categorical") {
      let categories: string[] = [];
      try {
        const values = await readZarrV2Array(
          source,
          storePath,
          `${path}/categories`,
          { signal },
        );
        categories = Array.from(values as ArrayLike<unknown>, String);
      } catch {
        signal?.throwIfAborted();
      }
      obsColumns.push({ name, kind: "categorical", categories });
    } else if (array !== undefined) {
      const dtype = array.dtype;
      if (dtype.includes("b1")) {
        obsColumns.push({
          name,
          kind: "boolean",
          categories: ["false", "true"],
        });
      } else if (/[iuf]\d/.test(dtype)) {
        obsColumns.push({ name, kind: "numeric" });
      } else {
        // strings: categories are the unique values, listed when loaded
        obsColumns.push({ name, kind: "categorical" });
      }
    } else if (
      encoding === "nullable-integer" ||
      encoding === "nullable-boolean"
    ) {
      obsColumns.push(
        encoding === "nullable-boolean"
          ? { name, kind: "boolean", categories: ["false", "true"] }
          : { name, kind: "numeric" },
      );
    } else if (encoding === "nullable-string-array") {
      obsColumns.push({ name, kind: "categorical" });
    }
  }

  return new CellTableV2({
    source,
    storePath,
    numCells,
    genes,
    expressionSources,
    obsColumns,
    hasCentroids: tree.array("obsm/spatial") !== undefined,
    obsIndexPath,
  });
}

async function readMasks(
  source: InSituSource,
  boundariesPath: string,
  table: CellTableV2,
  issues: DataIssue[],
  subject: string,
  options?: { signal?: AbortSignal },
): Promise<CellLayer["masks"]> {
  const { signal } = options ?? {};
  const masks: CellLayer["masks"] = {};
  try {
    await readZarrV3Metadata(source, boundariesPath, { signal });
  } catch (error) {
    signal?.throwIfAborted();
    issues.push({
      severity: "warning",
      subject,
      message:
        error instanceof NotFoundError
          ? `No boundaries store at ${boundariesPath}; cell outlines are not available.`
          : `Could not read ${boundariesPath}: ${String(error)}`,
    });
    return masks;
  }
  for (const kind of ["cells", "nuclei"] as const) {
    const maskPath = `${boundariesPath}/masks/${kind}`;
    try {
      const entry = await readMask(
        source,
        boundariesPath,
        maskPath,
        kind,
        table,
        {
          signal,
        },
      );
      if (entry !== null) {
        masks[kind] = entry;
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof NotFoundError) {
        continue; // no such mask
      }
      issues.push({
        severity: "warning",
        subject,
        message: `Could not read the ${kind} mask: ${String(error)}`,
      });
    }
  }
  if (masks.cells === undefined && masks.nuclei === undefined) {
    issues.push({
      severity: "warning",
      subject,
      message: `${boundariesPath} holds no masks/cells or masks/nuclei; values cannot be drawn on outlines.`,
    });
  }
  return masks;
}

async function readMask(
  source: InSituSource,
  boundariesPath: string,
  maskPath: string,
  kind: "cells" | "nuclei",
  table: CellTableV2,
  options?: { signal?: AbortSignal },
): Promise<MaskEntry | null> {
  const { signal } = options ?? {};
  const group = await readZarrV3Metadata(source, maskPath, { signal });
  const attrs = group.attributes ?? {};
  const multiscale = getMultiscale(attrs);
  if (multiscale === undefined) {
    throw new Error(`${maskPath} has no multiscales metadata.`);
  }
  const level0 = await readZarrV3Metadata(
    source,
    `${maskPath}/${multiscale.datasets[0]?.path ?? "0"}`,
    { signal },
  );
  const shape = level0.shape ?? [];
  if (shape.length !== 2) {
    throw new Error(`${maskPath} is not a 2-D mask.`);
  }
  const pixelSize =
    typeof attrs.pixel_size === "number"
      ? attrs.pixel_size
      : (getXYScale(multiscale)?.x ?? 1);
  const dataSource: LabelsDataSource = {
    type: "ome-zarr",
    source: source.resolve(maskPath),
  };
  const labelsAttr = attrs.labels as MaskLabelsAttr | undefined;
  let labelMapping: MaskEntry["labelMapping"];
  if (
    labelsAttr === undefined ||
    (labelsAttr.array === "seg_mask_value" && (labelsAttr.offset ?? 0) === 0)
  ) {
    // cell masks, and v1.x nuclei: the raster label is seg_mask_value, which
    // is what obs/_label_id holds
    labelMapping = { kind: "direct" };
  } else {
    labelMapping = await buildLabelMapping(
      source,
      boundariesPath,
      labelsAttr,
      table,
      { signal },
    );
  }
  const size = { width: shape[1]!, height: shape[0]! };
  const level0Path = `/${multiscale.datasets[0]?.path ?? "0"}`;
  let level0Array:
    Promise<zarr.Array<zarr.DataType, zarr.Readable>> | undefined;
  const readLabel = async (
    x: number,
    y: number,
    options?: { signal?: AbortSignal },
  ): Promise<number> => {
    const px = Math.floor(x / pixelSize);
    const py = Math.floor(y / pixelSize);
    if (px < 0 || py < 0 || px >= size.width || py >= size.height) {
      return 0;
    }
    level0Array ??= zarr.open.v3(
      zarr.root(new InSituSourceStore(source, maskPath)).resolve(level0Path),
      { kind: "array" },
    ) as Promise<zarr.Array<zarr.DataType, zarr.Readable>>;
    level0Array.catch(() => (level0Array = undefined));
    const array = await level0Array;
    // one inner chunk of the sharded level; the shard index is read once per shard
    const chunk = await zarr.get(
      array,
      [zarr.slice(py, py + 1), zarr.slice(px, px + 1)],
      { signal: options?.signal },
    );
    const value = (chunk.data as ArrayLike<number | bigint>)[0];
    return Number(value ?? 0);
  };
  return {
    kind,
    pixelSize,
    size,
    levels: multiscale.datasets.length,
    dataSource,
    readLabel,
    labelMapping,
  };
}

/**
 * Builds the raster-label-to-table-row mapping of a mask whose labels are not
 * `seg_mask_value`, e.g. nuclei labelled by `nucleus_to_cell_map/nucleus_index`
 * plus 1. The companion names array (`cell_name` next to the labels array, or
 * `cell_names` at the root) names the cell of every entry.
 */
async function buildLabelMapping(
  source: InSituSource,
  boundariesPath: string,
  labelsAttr: MaskLabelsAttr,
  table: CellTableV2,
  options?: { signal?: AbortSignal },
): Promise<MaskEntry["labelMapping"]> {
  const { signal } = options ?? {};
  const offset = labelsAttr.offset ?? 0;
  const slash = labelsAttr.array.lastIndexOf("/");
  const groupPath = slash >= 0 ? labelsAttr.array.slice(0, slash) : "";
  const namesPath = groupPath !== "" ? `${groupPath}/cell_name` : "cell_names";
  const [values, names, cellNames, labelIds] = await Promise.all([
    readZarrV3Array1D(source, boundariesPath, labelsAttr.array, { signal }),
    readZarrV3Array1D(source, boundariesPath, namesPath, { signal }),
    table.loadCellNames({ signal }),
    table.loadLabelIds({ signal }),
  ]);
  if (values.length !== names.length) {
    throw new Error(
      `${labelsAttr.array} and ${namesPath} differ in length (${values.length} vs ${names.length}).`,
    );
  }
  const rowByName = new Map<string, number>();
  for (let row = 0; row < cellNames.length; row++) {
    rowByName.set(cellNames[row]!, row);
  }
  let maxLabel = 0;
  const numericValues = values as ArrayLike<number>;
  for (let i = 0; i < numericValues.length; i++) {
    const label = Number(numericValues[i]) + offset;
    if (label > maxLabel) {
      maxLabel = label;
    }
  }
  const labelToRow = new Int32Array(maxLabel + 1).fill(-1);
  let identity = true;
  for (let i = 0; i < numericValues.length; i++) {
    const label = Number(numericValues[i]) + offset;
    const row = rowByName.get(String((names as unknown[])[i]));
    if (row !== undefined) {
      labelToRow[label] = row;
      if (labelIds[row] !== label) {
        identity = false;
      }
    } else {
      identity = false;
    }
  }
  if (identity) {
    return { kind: "direct" };
  }
  return { kind: "mapped", offset, labelToRow };
}
