// @vitest-environment jsdom
// OpenSeadragon touches the DOM when imported
import type OpenSeadragon from "openseadragon";
import { describe, expect, it } from "vitest";

import { type Labels, type LabelsData, createLabels } from "@tissuumaps/core";

import type { DataTransfer } from "./OpenSeadragonContext";
import { OpenSeadragonLabelsRenderer } from "./OpenSeadragonLabelsRenderer";

type TileData = { values: Uint32Array; width: number; height: number };

function createTransfer(labels: Labels, tiles: Map<string, TileData>) {
  const data = {
    getTileData: (event: { tile: { cacheKey: string } }) =>
      Promise.resolve(tiles.get(event.tile.cacheKey)!),
  } as unknown as LabelsData;
  return (
    OpenSeadragonLabelsRenderer as unknown as {
      _createDataTransfer: (
        labels: Labels,
        data: LabelsData,
        labelPixelValues: Map<number, number>,
      ) => DataTransfer;
    }
  )._createDataTransfer(labels, data, new Map());
}

function tileEvent(cacheKey: string) {
  return {
    tile: { cacheKey },
  } as unknown as OpenSeadragon.TileInvalidatedEvent;
}

describe("OpenSeadragonLabelsRenderer data transfer", () => {
  it("draws outlines with the size of the tile being transferred", async () => {
    const labels = createLabels({
      id: "mask",
      name: "Mask",
      layer: "layer",
      dataSource: { type: "test", source: "test" },
      labelColor: { constant: { value: { r: 255, g: 0, b: 0 } } },
      labelRenderMode: "outline",
    });
    // a 4x3 tile filled with one label and a smaller 2x3 edge tile: fetched in
    // this order, the edge tile must not lend its size to the first (which
    // used to skip the outline step and draw the first tile filled)
    const first = { values: new Uint32Array(12).fill(1), width: 4, height: 3 };
    const edge = { values: new Uint32Array(6).fill(2), width: 2, height: 3 };
    const transfer = createTransfer(
      labels,
      new Map([
        ["first", first],
        ["edge", edge],
      ]),
    );
    const { values, width, height } = await transfer.getTileData(
      tileEvent("first"),
    );
    await transfer.getTileData(tileEvent("edge"));
    const pixelBuffer = new Uint32Array(values.length);
    transfer.transferValues(values, pixelBuffer, width, height);
    // a single label touching only the tile edges has no outline inside the tile
    expect(Array.from(pixelBuffer)).toEqual(new Array(12).fill(0));
  });

  it("keeps the boundary pixels between two labels", async () => {
    const labels = createLabels({
      id: "mask",
      name: "Mask",
      layer: "layer",
      dataSource: { type: "test", source: "test" },
      labelColor: { constant: { value: { r: 255, g: 0, b: 0 } } },
      labelRenderMode: "outline",
    });
    // 4x2 tile: left half label 1, right half label 2
    const tile = {
      values: Uint32Array.from([1, 1, 2, 2, 1, 1, 2, 2]),
      width: 4,
      height: 2,
    };
    const transfer = createTransfer(labels, new Map([["tile", tile]]));
    const { values, width, height } = await transfer.getTileData(
      tileEvent("tile"),
    );
    const pixelBuffer = new Uint32Array(values.length);
    transfer.transferValues(values, pixelBuffer, width, height);
    const drawn = Array.from(pixelBuffer, (p) => (p === 0 ? 0 : 1));
    expect(drawn).toEqual([0, 1, 1, 0, 0, 1, 1, 0]);
  });
});
