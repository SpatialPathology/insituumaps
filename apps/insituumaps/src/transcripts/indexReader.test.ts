import { describe, expect, it } from "vitest";

import { type InSituSource, NotFoundError } from "@/insitupy";

import { TranscriptIndexReader } from "./indexReader";

/**
 * An in-memory source holding a tiny index: 2 genes on a 2 x 2 grid of 10 µm
 * tiles. Gene A has 3 points in tile 0 and 2 in tile 3; gene B has 1 point in
 * tile 1.
 */
function makeSource(): InSituSource {
  const points: [number, number][] = [
    // gene A, tile 0 (x 0-10, y 0-10)
    [1, 1],
    [2, 2],
    [3, 3],
    // gene A, tile 3 (x 10-20, y 10-20)
    [15, 15],
    [16, 16],
    // gene B, tile 1 (x 10-20, y 0-10)
    [12, 2],
  ];
  const pointsBin = new Float32Array(points.flat());
  const tiles = new Uint32Array([
    // gene A
    0, 0, 3, 3, 3, 2,
    // gene B
    1, 0, 1,
  ]);
  const files = new Map<string, Uint8Array>([
    ["points.bin", new Uint8Array(pointsBin.buffer)],
    ["tiles.bin", new Uint8Array(tiles.buffer)],
  ]);
  const index = {
    format: "insituumaps-transcripts",
    version: 1,
    tile_size: 10,
    origin: [0, 0],
    grid: [2, 2],
    num_points: 6,
    genes: [
      {
        name: "A",
        points_offset: 0,
        points_count: 5,
        tiles_offset: 0,
        tiles_count: 2,
      },
      {
        name: "B",
        points_offset: 5,
        points_count: 1,
        tiles_offset: 2,
        tiles_count: 1,
      },
    ],
  };
  const requests: string[] = [];
  const source: InSituSource & { requests: string[] } = {
    kind: "url",
    label: "memory://",
    workspace: null,
    requests,
    resolve: (p) => `memory://${p}`,
    child: () => source,
    readText: () => Promise.reject(new Error("not used")),
    readJSON: <T>(p: string) =>
      p === "index.json"
        ? Promise.resolve(index as T)
        : Promise.reject(new NotFoundError(p)),
    readBytes: (p, options) => {
      const file = files.get(p);
      if (file === undefined) {
        return Promise.reject(new NotFoundError(p));
      }
      requests.push(`${p}:${options?.range?.join("-") ?? "all"}`);
      const range = options?.range;
      return Promise.resolve(
        range !== undefined ? file.slice(range[0], range[1]) : file,
      );
    },
    exists: (p) => Promise.resolve(files.has(p) || p === "index.json"),
    list: () => Promise.resolve(null),
  };
  return source;
}

describe("TranscriptIndexReader", () => {
  it("loads only the tiles of the requested gene that intersect the region", async () => {
    const source = makeSource();
    const reader = await TranscriptIndexReader.open(source);
    expect(reader.genes).toEqual(["A", "B"]);
    const points = await reader.loadGenePoints("A", {
      x: 0,
      y: 0,
      width: 5,
      height: 5,
    });
    expect(Array.from(points.xs)).toEqual([1, 2, 3]);
    expect(Array.from(points.ys)).toEqual([1, 2, 3]);
    expect(points.total).toBe(3);
    expect(points.subsampled).toBe(false);
    const requests = (source as unknown as { requests: string[] }).requests;
    // the tile table of A and the bytes of tile 0 only (3 points * 8 bytes)
    expect(requests).toEqual(["tiles.bin:0-24", "points.bin:0-24"]);
  });

  it("concatenates several tiles and subsamples above the limit", async () => {
    const source = makeSource();
    const reader = await TranscriptIndexReader.open(source);
    const all = await reader.loadGenePoints("A", {
      x: 0,
      y: 0,
      width: 20,
      height: 20,
    });
    expect(all.xs.length).toBe(5);
    expect(all.total).toBe(5);
    const sampled = await reader.loadGenePoints(
      "A",
      { x: 0, y: 0, width: 20, height: 20 },
      { maxPoints: 2 },
    );
    expect(sampled.subsampled).toBe(true);
    expect(sampled.total).toBe(5);
    // the same fraction of every tile, rounded up: 2 of 3 and 1 of 2
    expect(sampled.xs.length).toBe(3);
  });

  it("returns nothing for unknown genes or regions off the grid", async () => {
    const reader = await TranscriptIndexReader.open(makeSource());
    expect(
      (await reader.loadGenePoints("Z", { x: 0, y: 0, width: 5, height: 5 })).xs
        .length,
    ).toBe(0);
    expect(
      (
        await reader.loadGenePoints("A", {
          x: 100,
          y: 100,
          width: 5,
          height: 5,
        })
      ).xs.length,
    ).toBe(0);
  });
});
