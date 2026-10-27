/**
 * Transcripts without an index: the Parquet file is scanned once per gene
 * list and kept in memory, which is slow and heavy for large samples. The
 * viewer warns about it and suggests running the converter.
 */
import {
  type AsyncBuffer,
  asyncBufferFromUrl,
  parquetMetadataAsync,
  parquetRead,
} from "hyparquet";
import { compressors } from "hyparquet-compressors";

import type { InSituSource } from "@/insitupy";

import type { RegionUm } from "./indexFormat";
import type { GenePoints } from "./indexReader";

/** Rows above which the fallback refuses to scan the file */
export const parquetFallbackMaxRows = 20_000_000;

const xColumn = "x_location";
const yColumn = "y_location";
const geneColumn = "feature_name";

export class ParquetTranscripts {
  private readonly _source: InSituSource;
  private readonly _path: string;
  private _buffer: Promise<AsyncBuffer> | undefined;
  private _scan:
    Promise<Map<string, { xs: Float32Array; ys: Float32Array }>> | undefined;
  /** Number of rows, known after the metadata was read */
  numRows: number | undefined;

  constructor(source: InSituSource, parquetPath: string) {
    this._source = source;
    this._path = parquetPath;
  }

  private _openBuffer(): Promise<AsyncBuffer> {
    this._buffer ??= (async () => {
      if (this._source.kind === "url") {
        return await asyncBufferFromUrl({
          url: this._source.resolve(this._path),
        });
      }
      const bytes = await this._source.readBytes(this._path);
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      return {
        byteLength: buffer.byteLength,
        slice: (start: number, end?: number) => buffer.slice(start, end),
      };
    })();
    return this._buffer;
  }

  /** Reads the row count from the file metadata */
  async readNumRows(): Promise<number> {
    const buffer = await this._openBuffer();
    const metadata = await parquetMetadataAsync(buffer);
    this.numRows = Number(metadata.num_rows);
    return this.numRows;
  }

  /**
   * Scans the whole file once into per-gene coordinate arrays
   *
   * @throws Error if the file is too large for the fallback
   */
  private _scanAll(
    onProgress?: (fraction: number) => void,
  ): Promise<Map<string, { xs: Float32Array; ys: Float32Array }>> {
    this._scan ??= (async () => {
      const buffer = await this._openBuffer();
      const metadata = await parquetMetadataAsync(buffer);
      const numRows = Number(metadata.num_rows);
      this.numRows = numRows;
      if (numRows > parquetFallbackMaxRows) {
        throw new Error(
          `The transcript file has ${numRows.toLocaleString()} rows, too many to load without an index. Run the InSitUUmaps converter to write transcripts/insituumaps.`,
        );
      }
      const genes = new Map<string, { xs: number[]; ys: number[] }>();
      let bytesRead = 0;
      await parquetRead({
        file: {
          byteLength: buffer.byteLength,
          async slice(start, end) {
            const chunk = await buffer.slice(start, end);
            bytesRead += chunk.byteLength;
            onProgress?.(Math.min(1, bytesRead / buffer.byteLength));
            return chunk;
          },
        },
        metadata,
        compressors,
        columns: [geneColumn, xColumn, yColumn],
        rowFormat: "array",
        onComplete: (rows) => {
          for (const row of rows as [string, number, number][]) {
            const gene = String(row[0]);
            let entry = genes.get(gene);
            if (entry === undefined) {
              entry = { xs: [], ys: [] };
              genes.set(gene, entry);
            }
            entry.xs.push(row[1]);
            entry.ys.push(row[2]);
          }
        },
      });
      const result = new Map<string, { xs: Float32Array; ys: Float32Array }>();
      for (const [gene, { xs, ys }] of genes) {
        result.set(gene, {
          xs: Float32Array.from(xs),
          ys: Float32Array.from(ys),
        });
      }
      return result;
    })();
    this._scan.catch(() => (this._scan = undefined));
    return this._scan;
  }

  /** Gene names found in the file (after the scan) */
  async genes(): Promise<string[]> {
    return [...(await this._scanAll()).keys()].toSorted();
  }

  async loadGenePoints(
    gene: string,
    region: RegionUm,
    options?: { signal?: AbortSignal; onProgress?: (fraction: number) => void },
  ): Promise<GenePoints> {
    const all = await this._scanAll(options?.onProgress);
    options?.signal?.throwIfAborted();
    const points = all.get(gene);
    if (points === undefined) {
      return {
        xs: new Float32Array(0),
        ys: new Float32Array(0),
        total: 0,
        subsampled: false,
      };
    }
    const x1 = region.x + region.width;
    const y1 = region.y + region.height;
    let n = 0;
    for (let i = 0; i < points.xs.length; i++) {
      const x = points.xs[i]!;
      const y = points.ys[i]!;
      if (x >= region.x && x < x1 && y >= region.y && y < y1) {
        n++;
      }
    }
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    let k = 0;
    for (let i = 0; i < points.xs.length; i++) {
      const x = points.xs[i]!;
      const y = points.ys[i]!;
      if (x >= region.x && x < x1 && y >= region.y && y < y1) {
        xs[k] = x;
        ys[k] = y;
        k++;
      }
    }
    return { xs, ys, total: n, subsampled: false };
  }
}
