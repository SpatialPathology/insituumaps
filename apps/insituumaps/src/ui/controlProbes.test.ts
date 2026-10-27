import { describe, expect, it } from "vitest";

import { isControlProbeName, splitControlProbes } from "./controlProbes";

describe("control probes", () => {
  it("recognises Xenium control names by prefix", () => {
    for (const name of [
      "NegControlProbe_00042",
      "NegControlCodeword_0500",
      "UnassignedCodeword_0007",
      "DeprecatedCodeword_0101",
      "BLANK_0006",
    ]) {
      expect(isControlProbeName(name)).toBe(true);
    }
    expect(isControlProbeName("EPCAM")).toBe(false);
    expect(isControlProbeName("NEGR1")).toBe(false);
  });

  it("splits by prefix and, if known, by the cell table's genes", () => {
    const names = ["EPCAM", "BLANK_0001", "CD3E", "Unlisted"];
    expect(splitControlProbes(names)).toEqual({
      genes: ["EPCAM", "CD3E", "Unlisted"],
      controls: ["BLANK_0001"],
    });
    expect(splitControlProbes(names, ["CD3E", "EPCAM"])).toEqual({
      genes: ["EPCAM", "CD3E"],
      controls: ["BLANK_0001", "Unlisted"],
    });
  });
});
