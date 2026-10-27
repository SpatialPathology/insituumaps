/**
 * Reads gene points for a view from the transcript index with range requests
 */
import type { InSituSource } from "@/insitupy";

import {
  type RegionUm,
  type TranscriptIndex,
  type TranscriptIndexGene,
  pointBytes,
  tileEntryBytes,
  tilesInRegion,
  validateTranscriptIndex,
} from "./indexFormat";

/** Points of one gene within a view */
export type GenePoints = {
  xs: Float32Array;
  ys: Float32Array;
  /** Number of points the view holds in total (before any subsampling) */
  total: number;
  /** Whether only a subsample of the view's points was loaded */
  subsampled: boolean;
};

/** A tile entry of a gene */
type TileEntry = { tile: number; offset: number; count: number };

/**
 * Reads the index of one project; caches the per-gene tile tables and the
 * tile points it has fetched (bounded by `cacheBytes`)
 */
export class TranscriptIndexReader {
  readonly index: TranscriptIndex;
  private readonly _source: InSituSource;
  private readonly _genes = new Map<string, TranscriptIndexGene>();
  private readonly _tileTables = new Map<string, Promise<TileEntry[]>>();
  private readonly _tileCache = new Map<
    string,
    { xs: Float32Array; ys: Float32Array; bytes: number }
  >();
  private _cachedBytes = 0;
  private readonly _cacheBytes: number;

  private constructor(
    source: InSituSource,
    index: TranscriptIndex,
    cacheBytes: number,
  ) {
    this._source = source;
    this.index = index;
    this._cacheBytes = cacheBytes;
    for (const gene of index.genes) {
      this._genes.set(gene.name, gene);
    }
  }

  /**
   * Opens the index in a folder
   *
   * @param source - The index folder (`transcripts/insituumaps`)
   * @param options - Optional abort signal and cache size in bytes
   */
  static async open(
    source: InSituSource,
    options?: { signal?: AbortSignal; cacheBytes?: number },
  ): Promise<TranscriptIndexReader> {
    const { signal, cacheBytes = 256 * 1024 * 1024 } = options ?? {};
    const raw = await source.readJSON("index.json", { signal });
    const index = validateTranscriptIndex(raw);
    return new TranscriptIndexReader(source, index, cacheBytes);
  }

  /** Gene names in the index */
  get genes(): string[] {
    return this.index.genes.map((g) => g.name);
  }

  hasGene(gene: string): boolean {
    return this._genes.has(gene);
  }

  /** Total number of points of a gene, or 0 if unknown */
  geneCount(gene: string): number {
    return this._genes.get(gene)?.points_count ?? 0;
  }

  /**
   * Loads the points of a gene that fall into the tiles covering a region
   *
   * @param gene - The gene name
   * @param region - The region in µm
   * @param options - `maxPoints` caps the number of points (a spatially fair
   * subsample: the same fraction of every tile, as points are shuffled within
   * tiles); an optional abort signal
   */
  async loadGenePoints(
    gene: string,
    region: RegionUm,
    options?: { signal?: AbortSignal; maxPoints?: number },
  ): Promise<GenePoints> {
    const { signal, maxPoints = 3_000_000 } = options ?? {};
    const entry = this._genes.get(gene);
    const range = tilesInRegion(this.index, region);
    if (entry === undefined || range === null) {
      return {
        xs: new Float32Array(0),
        ys: new Float32Array(0),
        total: 0,
        subsampled: false,
      };
    }
    const tiles = await this._loadTileTable(entry, { signal });
    const [nx] = this.index.grid;
    const visible: TileEntry[] = [];
    let total = 0;
    for (const tile of tiles) {
      const tx = tile.tile % nx;
      const ty = Math.floor(tile.tile / nx);
      if (
        tx >= range.x0 &&
        tx <= range.x1 &&
        ty >= range.y0 &&
        ty <= range.y1
      ) {
        visible.push(tile);
        total += tile.count;
      }
    }
    const fraction = total > maxPoints ? maxPoints / total : 1;
    const loaded = await Promise.all(
      visible.map((tile) =>
        this._loadTile(entry, tile, Math.ceil(tile.count * fraction), {
          signal,
        }),
      ),
    );
    let n = 0;
    for (const points of loaded) {
      n += points.xs.length;
    }
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    let k = 0;
    for (const points of loaded) {
      xs.set(points.xs, k);
      ys.set(points.ys, k);
      k += points.xs.length;
    }
    return { xs, ys, total, subsampled: fraction < 1 };
  }

  private _loadTileTable(
    entry: TranscriptIndexGene,
    options?: { signal?: AbortSignal },
  ): Promise<TileEntry[]> {
    let promise = this._tileTables.get(entry.name);
    if (promise === undefined) {
      promise = this._source
        .readBytes(this.index.tiles_file, {
          signal: options?.signal,
          range: [
            entry.tiles_offset * tileEntryBytes,
            (entry.tiles_offset + entry.tiles_count) * tileEntryBytes,
          ],
        })
        .then((bytes) => {
          const view = new DataView(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength,
          );
          const tiles: TileEntry[] = [];
          for (
            let i = 0;
            i + tileEntryBytes <= bytes.byteLength;
            i += tileEntryBytes
          ) {
            tiles.push({
              tile: view.getUint32(i, true),
              offset: view.getUint32(i + 4, true),
              count: view.getUint32(i + 8, true),
            });
          }
          return tiles;
        });
      promise.catch(() => this._tileTables.delete(entry.name));
      this._tileTables.set(entry.name, promise);
    }
    return promise;
  }

  private async _loadTile(
    entry: TranscriptIndexGene,
    tile: TileEntry,
    count: number,
    options?: { signal?: AbortSignal },
  ): Promise<{ xs: Float32Array; ys: Float32Array }> {
    const key = `${entry.name}/${tile.tile}/${count}`;
    const cached = this._tileCache.get(key);
    if (cached !== undefined) {
      // refresh LRU order
      this._tileCache.delete(key);
      this._tileCache.set(key, cached);
      return cached;
    }
    const start = (entry.points_offset + tile.offset) * pointBytes;
    const bytes = await this._source.readBytes(this.index.points_file, {
      signal: options?.signal,
      range: [start, start + count * pointBytes],
    });
    const n = Math.floor(bytes.byteLength / pointBytes);
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < n; i++) {
      xs[i] = view.getFloat32(i * pointBytes, true);
      ys[i] = view.getFloat32(i * pointBytes + 4, true);
    }
    const result = { xs, ys, bytes: bytes.byteLength };
    this._tileCache.set(key, result);
    this._cachedBytes += result.bytes;
    while (this._cachedBytes > this._cacheBytes && this._tileCache.size > 1) {
      const oldestKey = this._tileCache.keys().next().value!;
      const oldest = this._tileCache.get(oldestKey)!;
      this._tileCache.delete(oldestKey);
      this._cachedBytes -= oldest.bytes;
    }
    return result;
  }
}
