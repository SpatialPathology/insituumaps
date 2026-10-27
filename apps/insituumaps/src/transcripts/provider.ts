/**
 * A TissUUmaps points provider that serves the transcripts of one gene within
 * a region, from the transcript index or, without one, from the Parquet file
 */
import type {
  AnnotatedDataProviderLoadOptions,
  IDArray,
  PointsData,
  PointsDataProvider,
  PointsDataSource,
  PointsGeometry,
} from "@tissuumaps/core";

import type { InSituProject } from "@/insitupy";

import type { RegionUm } from "./indexFormat";
import { type GenePoints, TranscriptIndexReader } from "./indexReader";
import { ParquetTranscripts } from "./parquetFallback";

export const transcriptPointsDataSourceType = "insituumaps-transcripts";

export interface TranscriptPointsDataSource extends PointsDataSource<
  typeof transcriptPointsDataSourceType
> {
  source: string;
  gene: string;
  /** The region the points are loaded for, see {@link transcriptRegionKey} */
  region: string;
}

/** Encodes a region so that it is part of the data source (and its cache key) */
export function transcriptRegionKey(region: RegionUm): string {
  return [region.x, region.y, region.width, region.height]
    .map((v) => Math.round(v * 100) / 100)
    .join(",");
}

export function parseTranscriptRegionKey(key: string): RegionUm {
  const [x = 0, y = 0, width = 0, height = 0] = key.split(",").map(Number);
  return { x, y, width, height };
}

/** Points of one gene within one region */
export class TranscriptPointsData implements PointsData {
  readonly gene: string;
  readonly points: GenePoints;
  private readonly _ids: Uint32Array;

  constructor(gene: string, points: GenePoints) {
    this.gene = gene;
    this.points = points;
    this._ids = Uint32Array.from({ length: points.xs.length }, (_, i) => i);
  }

  getIds(): IDArray {
    return this._ids;
  }

  getSize(): number {
    return this._ids.length;
  }

  loadGeometry(): Promise<PointsGeometry> {
    return Promise.resolve({ xs: this.points.xs, ys: this.points.ys });
  }

  close(): void {}
}

/** What loading transcripts of a gene produced, for the UI */
export type TranscriptLoadInfo = {
  gene: string;
  loaded: number;
  total: number;
  subsampled: boolean;
};

/**
 * The transcript source of one project: the index if present, else the
 * Parquet fallback
 */
export class TranscriptSource {
  private readonly _project: InSituProject;
  private _reader: Promise<TranscriptIndexReader> | undefined;
  private _fallback: ParquetTranscripts | undefined;
  /** Max points per gene and view before subsampling */
  maxPointsPerGene = 2_000_000;

  constructor(project: InSituProject) {
    this._project = project;
  }

  get hasIndex(): boolean {
    return this._project.transcripts?.index !== null;
  }

  /** Opens the index (once); rejects if the project has none */
  openIndex(options?: {
    signal?: AbortSignal;
  }): Promise<TranscriptIndexReader> {
    const index = this._project.transcripts?.index;
    if (index === null || index === undefined) {
      return Promise.reject(new Error("The project has no transcript index."));
    }
    this._reader ??= TranscriptIndexReader.open(index.source, options);
    this._reader.catch(() => (this._reader = undefined));
    return this._reader;
  }

  /** The Parquet fallback (only without an index) */
  fallback(): ParquetTranscripts {
    const transcripts = this._project.transcripts;
    if (transcripts === null) {
      throw new Error("The project has no transcripts.");
    }
    this._fallback ??= new ParquetTranscripts(
      this._project.source,
      transcripts.parquetPath,
    );
    return this._fallback;
  }

  async loadGenePoints(
    gene: string,
    region: RegionUm,
    options?: { signal?: AbortSignal; onProgress?: (fraction: number) => void },
  ): Promise<GenePoints> {
    if (this.hasIndex) {
      const reader = await this.openIndex(options);
      return await reader.loadGenePoints(gene, region, {
        signal: options?.signal,
        maxPoints: this.maxPointsPerGene,
      });
    }
    return await this.fallback().loadGenePoints(gene, region, options);
  }
}

export class TranscriptPointsDataProvider implements PointsDataProvider<
  TranscriptPointsDataSource,
  TranscriptPointsData
> {
  readonly name = "InSitUUmaps transcripts";
  readonly schema = {
    type: "object",
    properties: {
      source: { type: "string" },
      gene: { type: "string" },
      region: { type: "string" },
    },
    required: ["source", "gene", "region"],
  };
  readonly uischema = { type: "VerticalLayout", elements: [] };
  private readonly _source: TranscriptSource;
  private readonly _onLoaded: ((info: TranscriptLoadInfo) => void) | undefined;

  constructor(
    source: TranscriptSource,
    onLoaded?: (info: TranscriptLoadInfo) => void,
  ) {
    this._source = source;
    this._onLoaded = onLoaded;
  }

  normalize(
    dataSource: TranscriptPointsDataSource,
  ): TranscriptPointsDataSource {
    return dataSource;
  }

  async load(
    dataSource: TranscriptPointsDataSource,
    options?: AnnotatedDataProviderLoadOptions,
  ): Promise<TranscriptPointsData> {
    const { signal } = options ?? {};
    const region = parseTranscriptRegionKey(dataSource.region);
    const points = await this._source.loadGenePoints(dataSource.gene, region, {
      signal,
    });
    this._onLoaded?.({
      gene: dataSource.gene,
      loaded: points.xs.length,
      total: points.total,
      subsampled: points.subsampled,
    });
    return new TranscriptPointsData(dataSource.gene, points);
  }
}
