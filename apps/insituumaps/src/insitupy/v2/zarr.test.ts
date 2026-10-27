import { describe, expect, it } from "vitest";

import { ZarrV2Tree, getMultiscale, getXYScale, isSharded } from "./zarr";

describe("ZarrV2Tree", () => {
  const tree = new ZarrV2Tree({
    metadata: {
      ".zattrs": { "encoding-type": "anndata" },
      ".zgroup": { zarr_format: 2 },
      "X/.zattrs": { "encoding-type": "csc_matrix", shape: [3, 2] },
      "X/data/.zarray": { shape: [4], dtype: "<f4", chunks: [4] },
      "obs/.zattrs": { "column-order": ["a"], _index: "_index" },
      "obs/a/.zarray": { shape: [3], dtype: "<i8", chunks: [3] },
      "obs/_index/.zarray": { shape: [3], dtype: "|O", chunks: [3] },
      "layers/.zattrs": { "encoding-type": "dict" },
      "layers/counts/.zattrs": { "encoding-type": "csc_matrix" },
      "layers/counts/data/.zarray": { shape: [4], dtype: "<f4", chunks: [4] },
    },
  });

  it("reads attributes, arrays and children", () => {
    expect(tree.encodingType("")).toBe("anndata");
    expect(tree.encodingType("X")).toBe("csc_matrix");
    expect(tree.array("obs/a")?.dtype).toBe("<i8");
    expect(tree.array("obs")).toBeUndefined();
    expect(tree.has("layers/counts")).toBe(true);
    expect(tree.has("layers/nothing")).toBe(false);
    expect(tree.children("layers")).toEqual(["counts"]);
    expect(tree.children("obs")).toEqual(["_index", "a"]);
    expect(tree.children("")).toEqual(["X", "layers", "obs"]);
  });
});

describe("multiscales helpers", () => {
  const attrs = {
    ome: {
      multiscales: [
        {
          axes: [{ name: "c" }, { name: "y" }, { name: "x" }],
          datasets: [
            {
              path: "0",
              coordinateTransformations: [
                { type: "scale", scale: [1, 0.2125, 0.2125] },
              ],
            },
          ],
        },
      ],
    },
  };

  it("finds the multiscale and its x/y scale", () => {
    const multiscale = getMultiscale(attrs);
    expect(multiscale).toBeDefined();
    expect(getXYScale(multiscale!)).toEqual({ x: 0.2125, y: 0.2125 });
    expect(getMultiscale({})).toBeUndefined();
  });

  it("detects sharding", () => {
    expect(
      isSharded({
        zarr_format: 3,
        node_type: "array",
        codecs: [{ name: "sharding_indexed" }],
      }),
    ).toBe(true);
    expect(
      isSharded({
        zarr_format: 3,
        node_type: "array",
        codecs: [{ name: "bytes" }],
      }),
    ).toBe(false);
  });
});
