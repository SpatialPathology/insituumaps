/**
 * Small Zarr helpers for the format v2 layout: a zarrita store over an
 * {@link InSituSource}, consolidated-metadata parsing for the AnnData zarr v2
 * viewer table, and a reader for the few 1-D arrays of `boundaries.zarr`
 * (Zarr v3) that zarrita 0.7 cannot decode (fixed-length UTF-32 strings).
 */
import * as zarr from "zarrita";

import { type InSituSource, NotFoundError } from "../source";

type ZarritaRangeQuery =
  { offset: number; length: number } | { suffixLength: number };

/** A zarrita store reading through an {@link InSituSource} */
export class InSituSourceStore implements zarr.AsyncReadable {
  private readonly _source: InSituSource;
  private readonly _prefix: string;

  constructor(source: InSituSource, prefix: string) {
    this._source = source;
    this._prefix = prefix.replace(/\/+$/, "");
  }

  async get(
    key: `/${string}`,
    options?: { signal?: AbortSignal },
  ): Promise<Uint8Array | undefined> {
    try {
      return await this._source.readBytes(this._prefix + key, options);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return undefined;
      }
      throw error;
    }
  }

  async getRange(
    key: `/${string}`,
    range: ZarritaRangeQuery,
    options?: { signal?: AbortSignal },
  ): Promise<Uint8Array | undefined> {
    try {
      if ("suffixLength" in range) {
        // the shard index sits at the end of the shard
        return await this._source.readBytes(this._prefix + key, {
          ...options,
          suffixLength: range.suffixLength,
        });
      }
      return await this._source.readBytes(this._prefix + key, {
        ...options,
        range: [range.offset, range.offset + range.length],
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return undefined;
      }
      throw error;
    }
  }
}

/** Zarr v3 group or array metadata (`zarr.json`) */
export type ZarrV3Metadata = {
  zarr_format: 3;
  node_type: "group" | "array";
  attributes?: Record<string, unknown>;
  shape?: number[];
  data_type?:
    string | { name: string; configuration?: Record<string, unknown> };
  chunk_grid?: { name: string; configuration: { chunk_shape: number[] } };
  codecs?: { name: string; configuration?: Record<string, unknown> }[];
  fill_value?: unknown;
};

/** Reads `zarr.json` of a v3 node; rejects with NotFoundError if absent */
export async function readZarrV3Metadata(
  source: InSituSource,
  path: string,
  options?: { signal?: AbortSignal },
): Promise<ZarrV3Metadata> {
  const metadata = await source.readJSON<ZarrV3Metadata>(
    `${path.replace(/\/+$/, "")}/zarr.json`,
    options,
  );
  if (metadata.zarr_format !== 3) {
    throw new Error(`${path} is not a Zarr v3 node`);
  }
  return metadata;
}

/** NGFF multiscales metadata as written by InSituPy (`ome` attribute) */
export type NgffMultiscale = {
  name?: string;
  axes: { name: string; type?: string; unit?: string }[];
  datasets: {
    path: string;
    coordinateTransformations?: (
      | { type: "scale"; scale: number[] }
      | { type: "translation"; translation: number[] }
    )[];
  }[];
};

/** Returns the first multiscale of an `ome` attribute, if any */
export function getMultiscale(
  attributes: Record<string, unknown> | undefined,
): NgffMultiscale | undefined {
  const ome = attributes?.ome;
  const multiscales =
    typeof ome === "object" && ome !== null
      ? (ome as { multiscales?: unknown }).multiscales
      : attributes?.multiscales;
  if (Array.isArray(multiscales) && multiscales.length > 0) {
    return multiscales[0] as NgffMultiscale;
  }
  return undefined;
}

/** The scale (µm per pixel) of the x and y axes of a multiscale's first dataset */
export function getXYScale(
  multiscale: NgffMultiscale,
): { x: number; y: number } | undefined {
  const dataset = multiscale.datasets[0];
  const scale = dataset?.coordinateTransformations?.find(
    (t) => t.type === "scale",
  );
  if (scale === undefined || scale.type !== "scale") {
    return undefined;
  }
  const xi = multiscale.axes.findIndex((a) => a.name === "x");
  const yi = multiscale.axes.findIndex((a) => a.name === "y");
  if (xi < 0 || yi < 0) {
    return undefined;
  }
  const x = scale.scale[xi];
  const y = scale.scale[yi];
  return x !== undefined && y !== undefined ? { x, y } : undefined;
}

/** Whether the array at `path` is stored with the sharding codec */
export function isSharded(metadata: ZarrV3Metadata): boolean {
  return metadata.codecs?.some((c) => c.name === "sharding_indexed") ?? false;
}

/** Consolidated metadata of a Zarr v2 store (`.zmetadata`) */
export type ZarrV2Consolidated = {
  metadata: Record<string, Record<string, unknown>>;
};

/** A parsed view on consolidated Zarr v2 metadata */
export class ZarrV2Tree {
  readonly metadata: Record<string, Record<string, unknown>>;

  constructor(consolidated: ZarrV2Consolidated) {
    this.metadata = consolidated.metadata;
  }

  /** Attributes of a node (`.zattrs`), or an empty object */
  attrs(path: string): Record<string, unknown> {
    return this.metadata[path === "" ? ".zattrs" : `${path}/.zattrs`] ?? {};
  }

  /** Array metadata (`.zarray`) of a node, if it is an array */
  array(
    path: string,
  ): { shape: number[]; dtype: string; chunks: number[] } | undefined {
    const zarray = this.metadata[`${path}/.zarray`];
    if (zarray === undefined) {
      return undefined;
    }
    return zarray as { shape: number[]; dtype: string; chunks: number[] };
  }

  /** Whether a node exists (array or group) */
  has(path: string): boolean {
    return (
      `${path}/.zarray` in this.metadata ||
      `${path}/.zgroup` in this.metadata ||
      `${path}/.zattrs` in this.metadata
    );
  }

  /** Names of the direct children of a group */
  children(path: string): string[] {
    const prefix = path === "" ? "" : `${path}/`;
    const names = new Set<string>();
    for (const key of Object.keys(this.metadata)) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash > 0) {
        names.add(rest.slice(0, slash));
      }
    }
    return [...names].toSorted();
  }

  /** The AnnData encoding type of a node, if any */
  encodingType(path: string): string | undefined {
    const value = this.attrs(path)["encoding-type"];
    return typeof value === "string" ? value : undefined;
  }
}

/** Reads and parses `.zmetadata` of a consolidated Zarr v2 store */
export async function readZarrV2Tree(
  source: InSituSource,
  path: string,
  options?: { signal?: AbortSignal },
): Promise<ZarrV2Tree> {
  const consolidated = await source.readJSON<ZarrV2Consolidated>(
    `${path.replace(/\/+$/, "")}/.zmetadata`,
    options,
  );
  if (typeof consolidated.metadata !== "object") {
    throw new Error(`${path}/.zmetadata holds no metadata`);
  }
  return new ZarrV2Tree(consolidated);
}

/** Converts a zarrita chunk's data to numbers, strings or booleans */
export function chunkToArray(data: unknown): unknown[] | ArrayLike<number> {
  if (data instanceof BigInt64Array || data instanceof BigUint64Array) {
    return Array.from(data, (v) => Number(v));
  }
  if (data instanceof zarr.BoolArray) {
    return Array.from(data, (v) => v);
  }
  if (Array.isArray(data) || ArrayBuffer.isView(data)) {
    return data as unknown[] | ArrayLike<number>;
  }
  return Array.from(data as Iterable<unknown>);
}

/** Reads a whole 1-D (or small 2-D) Zarr v2 array through zarrita */
export async function readZarrV2Array(
  source: InSituSource,
  storePath: string,
  arrayPath: string,
  options?: { signal?: AbortSignal },
): Promise<unknown[] | ArrayLike<number>> {
  const { signal } = options ?? {};
  const store = new InSituSourceStore(source, storePath);
  const array = await zarr.open.v2(zarr.root(store).resolve(`/${arrayPath}`), {
    kind: "array",
    attrs: false,
    signal,
  });
  const chunk = await zarr.get(array, null, { signal });
  return chunkToArray(chunk.data);
}

/**
 * Reads a whole 1-D Zarr v3 array, including fixed-length UTF-32 strings,
 * which zarrita 0.7 cannot decode. Numeric arrays go through zarrita.
 */
export async function readZarrV3Array1D(
  source: InSituSource,
  storePath: string,
  arrayPath: string,
  options?: { signal?: AbortSignal },
): Promise<unknown[] | ArrayLike<number>> {
  const { signal } = options ?? {};
  const prefix = storePath.replace(/\/+$/, "");
  const metadata = await readZarrV3Metadata(
    source,
    `${prefix}/${arrayPath}`,
    options,
  );
  if (metadata.node_type !== "array" || metadata.shape === undefined) {
    throw new Error(`${arrayPath} is not an array`);
  }
  const dataType = metadata.data_type;
  if (typeof dataType === "object" && dataType.name === "fixed_length_utf32") {
    return await readUtf32Array(source, prefix, arrayPath, metadata, {
      signal,
    });
  }
  const store = new InSituSourceStore(source, prefix);
  const array = await zarr.open.v3(zarr.root(store).resolve(`/${arrayPath}`), {
    kind: "array",
    signal,
  });
  const chunk = await zarr.get(array, null, { signal });
  return chunkToArray(chunk.data);
}

async function readUtf32Array(
  source: InSituSource,
  prefix: string,
  arrayPath: string,
  metadata: ZarrV3Metadata,
  options?: { signal?: AbortSignal },
): Promise<string[]> {
  const { signal } = options ?? {};
  const shape = metadata.shape!;
  const lengthBytes = Number(
    (metadata.data_type as { configuration?: { length_bytes?: number } })
      .configuration?.length_bytes ?? 0,
  );
  if (shape.length !== 1 || lengthBytes <= 0 || lengthBytes % 4 !== 0) {
    throw new Error(`Unsupported UTF-32 array layout in ${arrayPath}`);
  }
  const chunkShape = metadata.chunk_grid?.configuration.chunk_shape ?? shape;
  const chunkLength = chunkShape[0] ?? shape[0]!;
  const numChunks = Math.ceil(shape[0]! / chunkLength);
  const codecs = metadata.codecs ?? [];
  if (codecs.some((c) => c.name === "sharding_indexed")) {
    throw new Error(`Sharded UTF-32 arrays are not supported (${arrayPath})`);
  }
  const result: string[] = [];
  const codePointsPerItem = lengthBytes / 4;
  for (let c = 0; c < numChunks; c++) {
    let bytes = await source.readBytes(`${prefix}/${arrayPath}/c/${c}`, {
      signal,
    });
    // decode the byte-to-byte codecs in reverse order; "bytes" is the
    // array-to-bytes codec and needs no work beyond endianness (little)
    for (const codec of codecs.toReversed()) {
      if (codec.name === "bytes") {
        continue;
      }
      const loader = zarr.registry.get(codec.name);
      if (loader === undefined) {
        throw new Error(`Unknown codec ${codec.name} in ${arrayPath}`);
      }
      const Codec = (await loader()) as unknown as {
        fromConfig: (config: Record<string, unknown>) => {
          decode: (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;
        };
      };
      bytes = await Codec.fromConfig(codec.configuration ?? {}).decode(bytes);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const numItems = Math.min(chunkLength, shape[0]! - c * chunkLength);
    for (let i = 0; i < numItems; i++) {
      let text = "";
      for (let j = 0; j < codePointsPerItem; j++) {
        const offset = (i * codePointsPerItem + j) * 4;
        if (offset + 4 > bytes.byteLength) {
          break;
        }
        const codePoint = view.getUint32(offset, true);
        if (codePoint === 0) {
          break;
        }
        text += String.fromCodePoint(codePoint);
      }
      result.push(text);
    }
  }
  return result;
}
