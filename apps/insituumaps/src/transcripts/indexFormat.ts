/**
 * The InSitUUmaps transcript index: a spatially tiled, gene-sorted copy of
 * the transcript coordinates that can be read by gene and by view with HTTP
 * range requests. Written by `scripts/convert_project.py` next to the
 * Parquet file (`transcripts/insituumaps/`), see `docs/insitupy-changes.md`.
 *
 * Files:
 * - `index.json`: this metadata (see {@link TranscriptIndex})
 * - `points.bin`: for every gene (in `genes` order), its points sorted by tile
 *   index (row-major over the grid) and shuffled within each tile, as
 *   little-endian float32 pairs `x, y` in µm
 * - `tiles.bin`: for every gene, one entry per non-empty tile as three
 *   little-endian uint32 values: tile index, offset of the tile's first point
 *   within the gene's points, number of points
 */
export type TranscriptIndexGene = {
  /** Gene (feature) name */
  name: string;
  /** Offset of the gene's first point in `points.bin`, in points */
  points_offset: number;
  /** Number of points of the gene */
  points_count: number;
  /** Offset of the gene's first tile entry in `tiles.bin`, in entries */
  tiles_offset: number;
  /** Number of non-empty tiles of the gene */
  tiles_count: number;
};

export type TranscriptIndex = {
  format: "insituumaps-transcripts";
  version: 1;
  /** Relative path of the Parquet file the index was built from */
  source?: string;
  /** Coordinate unit of the points (always µm) */
  units?: string;
  /** Edge length of a tile in µm */
  tile_size: number;
  /** Lower-left corner of tile (0, 0) in µm */
  origin: [number, number];
  /** Number of tiles along x and y */
  grid: [number, number];
  /** Total number of points */
  num_points: number;
  points_file: string;
  tiles_file: string;
  genes: TranscriptIndexGene[];
};

export const transcriptIndexFormat = "insituumaps-transcripts";

/** Bytes per point in `points.bin` */
export const pointBytes = 8;

/** Bytes per tile entry in `tiles.bin` */
export const tileEntryBytes = 12;

/**
 * Validates a parsed `index.json`
 *
 * @throws Error with a readable message if the index is not usable
 */
export function validateTranscriptIndex(raw: unknown): TranscriptIndex {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("The transcript index is not a JSON object.");
  }
  const index = raw as Partial<TranscriptIndex>;
  if (index.format !== transcriptIndexFormat) {
    throw new Error(
      `The transcript index has format "${String(index.format)}", expected "${transcriptIndexFormat}".`,
    );
  }
  if (index.version !== 1) {
    throw new Error(
      `The transcript index has version ${String(index.version)}; this viewer reads version 1.`,
    );
  }
  if (
    typeof index.tile_size !== "number" ||
    !(index.tile_size > 0) ||
    !Array.isArray(index.origin) ||
    index.origin.length !== 2 ||
    !Array.isArray(index.grid) ||
    index.grid.length !== 2 ||
    !Array.isArray(index.genes)
  ) {
    throw new Error(
      "The transcript index is missing tile_size, origin, grid or genes.",
    );
  }
  for (const gene of index.genes) {
    if (
      typeof gene.name !== "string" ||
      !Number.isInteger(gene.points_offset) ||
      !Number.isInteger(gene.points_count) ||
      !Number.isInteger(gene.tiles_offset) ||
      !Number.isInteger(gene.tiles_count)
    ) {
      throw new Error("The transcript index has a malformed gene entry.");
    }
  }
  return {
    format: transcriptIndexFormat,
    version: 1,
    source: index.source,
    units: index.units,
    tile_size: index.tile_size,
    origin: [index.origin[0], index.origin[1]],
    grid: [index.grid[0], index.grid[1]],
    num_points: index.num_points ?? 0,
    points_file: index.points_file ?? "points.bin",
    tiles_file: index.tiles_file ?? "tiles.bin",
    genes: index.genes,
  };
}

/** A rectangle in µm */
export type RegionUm = { x: number; y: number; width: number; height: number };

/**
 * The tile index range covered by a region, clamped to the grid
 *
 * @returns Inclusive tile ranges, or null if the region misses the grid
 */
export function tilesInRegion(
  index: Pick<TranscriptIndex, "tile_size" | "origin" | "grid">,
  region: RegionUm,
): { x0: number; x1: number; y0: number; y1: number } | null {
  const [ox, oy] = index.origin;
  const [nx, ny] = index.grid;
  const x0 = Math.max(0, Math.floor((region.x - ox) / index.tile_size));
  const y0 = Math.max(0, Math.floor((region.y - oy) / index.tile_size));
  const x1 = Math.min(
    nx - 1,
    Math.floor((region.x + region.width - ox) / index.tile_size),
  );
  const y1 = Math.min(
    ny - 1,
    Math.floor((region.y + region.height - oy) / index.tile_size),
  );
  if (x1 < x0 || y1 < y0) {
    return null;
  }
  return { x0, x1, y0, y1 };
}
