// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { computeRanges } from "./store";
import { readStateFromUrl, writeStateToUrl } from "./url";

describe("computeRanges", () => {
  it("uses the full range for obs values and a percentile for genes", () => {
    const values = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    expect(computeRanges(values, 1)).toEqual({
      fullRange: [0, 100],
      autoRange: [0, 100],
    });
    const { fullRange, autoRange } = computeRanges(values, 0.9);
    expect(fullRange).toEqual([0, 100]);
    expect(autoRange[0]).toBe(0);
    expect(autoRange[1]).toBeLessThan(100);
  });

  it("handles constant and empty columns", () => {
    expect(computeRanges(Float32Array.from([2, 2, 2]), 0.99)).toEqual({
      fullRange: [2, 2],
      autoRange: [2, 3],
    });
    expect(computeRanges(Float32Array.from([NaN]), 0.99)).toEqual({
      fullRange: [0, 1],
      autoRange: [0, 1],
    });
  });
});

describe("url state", () => {
  it("round-trips the shareable state", () => {
    writeStateToUrl({
      source: { kind: "url", label: "https://example.org/exp/" },
      sampleIndex: 3,
      selection: {
        cellLayer: "proseg",
        colorBy: { kind: "gene", gene: "EPCAM", source: "counts" },
        mask: "nuclei",
      },
    });
    expect(readStateFromUrl()).toEqual({
      source: "https://example.org/exp/",
      sample: 3,
      cellLayer: "proseg",
      colorBy: { kind: "gene", gene: "EPCAM", source: "counts" },
      mask: "nuclei",
    });
    writeStateToUrl({
      source: { kind: "url", label: "https://example.org/p/" },
      sampleIndex: null,
      selection: {
        cellLayer: null,
        colorBy: { kind: "obs", column: "leiden" },
        mask: "cells",
      },
    });
    expect(readStateFromUrl().colorBy).toEqual({
      kind: "obs",
      column: "leiden",
    });
    expect(readStateFromUrl().sample).toBeUndefined();
  });

  it("does not write directory sources", () => {
    writeStateToUrl({
      source: { kind: "directory", label: "folder" },
      sampleIndex: 0,
      selection: {
        cellLayer: "main",
        colorBy: { kind: "none" },
        mask: "cells",
      },
    });
    expect(readStateFromUrl().source).toBeUndefined();
  });
});
