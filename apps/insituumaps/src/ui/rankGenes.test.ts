import { describe, expect, it } from "vitest";

import { rankGenes } from "./rankGenes";

describe("rankGenes", () => {
  const genes = ["ACTA2", "CD3E", "EPCAM", "epcam2", "PECAM1", "KRT5"];

  it("ranks exact, prefix and substring matches, case-insensitively", () => {
    expect(rankGenes(genes, "epcam", 10)).toEqual(["EPCAM", "epcam2"]);
    expect(rankGenes(genes, "cam", 10)).toEqual(["EPCAM", "epcam2", "PECAM1"]);
    expect(rankGenes(genes, "CD", 10)).toEqual(["CD3E"]);
    expect(rankGenes(genes, "", 2)).toEqual(["ACTA2", "CD3E"]);
    expect(rankGenes(genes, "zzz", 10)).toEqual([]);
  });
});
