import { describe, expect, it } from "vitest";

import { createLabels, createLayer, createTable } from "@tissuumaps/core";

import { type OwnedCollections, isOwnedId, mergeOwned } from "./mergeOwned";

function collections(
  overrides: Partial<OwnedCollections> = {},
): OwnedCollections {
  return {
    layers: [],
    images: [],
    labels: [],
    points: [],
    shapes: [],
    tables: [],
    colorMaps: [],
    visibilityMaps: [],
    ...overrides,
  };
}

const labels = (id: string, opacity = 1) =>
  createLabels({
    id,
    name: id,
    layer: "sample",
    dataSource: { type: "ome-zarr", source: id },
    opacity,
  });

describe("isOwnedId", () => {
  it("matches the IDs model.ts assigns", () => {
    for (const id of [
      "sample",
      "cells",
      "nuclei",
      "mask",
      "mask-outlines:cells",
      "image:HE",
      "transcripts:EPCAM",
      "overlay:annotation:tumor",
      "categories",
      "category-visibility",
    ]) {
      expect(isOwnedId(id)).toBe(true);
    }
  });

  it("does not match other IDs", () => {
    for (const id of ["my-labels", "masks", "image", "cells-2", "layer-1"]) {
      expect(isOwnedId(id)).toBe(false);
    }
  });
});

describe("mergeOwned", () => {
  it("replaces owned objects and keeps the user's after them", () => {
    const current = collections({
      labels: [
        labels("mask", 0.2),
        labels("mine"),
        labels("mask-outlines:cells"),
      ],
    });
    const next = collections({
      labels: [labels("mask", 0.8), labels("mask-outlines:nuclei")],
    });
    const merged = mergeOwned(current, next);
    expect(merged.labels.map((l) => l.id)).toEqual([
      "mask",
      "mask-outlines:nuclei",
      "mine",
    ]);
    expect(merged.labels[0]!.opacity).toBe(0.8);
    expect(merged.labels[2]).toBe(current.labels[1]);
  });

  it("drops owned objects the next model no longer has", () => {
    const current = collections({
      tables: [
        createTable({
          id: "cells",
          name: "Cells",
          dataSource: { type: "zarr" },
        }),
        createTable({
          id: "nuclei",
          name: "Nuclei",
          dataSource: { type: "x" },
        }),
      ],
    });
    const next = collections({ tables: [current.tables[0]!] });
    expect(mergeOwned(current, next).tables.map((t) => t.id)).toEqual([
      "cells",
    ]);
  });

  it("brings back owned objects the user deleted", () => {
    const next = collections({
      layers: [createLayer({ id: "sample", name: "Sample" })],
    });
    expect(mergeOwned(collections(), next).layers.map((l) => l.id)).toEqual([
      "sample",
    ]);
  });

  it("uses the given ownership", () => {
    const current = collections({ labels: [labels("a"), labels("b")] });
    const next = collections({ labels: [labels("c")] });
    const merged = mergeOwned(current, next, (id) => id !== "b");
    expect(merged.labels.map((l) => l.id)).toEqual(["c", "b"]);
  });
});
