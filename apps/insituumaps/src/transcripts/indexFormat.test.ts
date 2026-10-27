import { describe, expect, it } from "vitest";

import { tilesInRegion, validateTranscriptIndex } from "./indexFormat";

const grid = {
  tile_size: 500,
  origin: [0, 3] as [number, number],
  grid: [3, 3] as [number, number],
};

describe("tilesInRegion", () => {
  it("covers the tiles a region touches, clamped to the grid", () => {
    expect(
      tilesInRegion(grid, { x: -1000, y: -1000, width: 3000, height: 3000 }),
    ).toEqual({
      x0: 0,
      x1: 2,
      y0: 0,
      y1: 2,
    });
    expect(
      tilesInRegion(grid, { x: 600, y: 600, width: 100, height: 100 }),
    ).toEqual({
      x0: 1,
      x1: 1,
      y0: 1,
      y1: 1,
    });
  });

  it("returns null for a region outside the grid", () => {
    expect(
      tilesInRegion(grid, { x: 5000, y: 5000, width: 10, height: 10 }),
    ).toBeNull();
    expect(
      tilesInRegion(grid, { x: -500, y: -500, width: 100, height: 100 }),
    ).toBeNull();
  });
});

describe("validateTranscriptIndex", () => {
  const valid = {
    format: "insituumaps-transcripts",
    version: 1,
    tile_size: 500,
    origin: [0, 0],
    grid: [2, 2],
    num_points: 3,
    genes: [
      {
        name: "A",
        points_offset: 0,
        points_count: 3,
        tiles_offset: 0,
        tiles_count: 1,
      },
    ],
  };

  it("accepts a valid index and fills defaults", () => {
    const index = validateTranscriptIndex(valid);
    expect(index.points_file).toBe("points.bin");
    expect(index.tiles_file).toBe("tiles.bin");
    expect(index.genes[0]!.name).toBe("A");
  });

  it("rejects other formats and versions", () => {
    expect(() =>
      validateTranscriptIndex({ ...valid, format: "other" }),
    ).toThrow(/format/);
    expect(() => validateTranscriptIndex({ ...valid, version: 2 })).toThrow(
      /version/,
    );
    expect(() =>
      validateTranscriptIndex({ ...valid, genes: [{ name: 1 }] }),
    ).toThrow(/malformed/);
    expect(() => validateTranscriptIndex(null)).toThrow();
  });
});
