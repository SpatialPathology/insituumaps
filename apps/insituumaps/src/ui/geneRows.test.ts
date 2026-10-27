import { describe, expect, it } from "vitest";

import { buildGeneRows } from "./geneRows";

const genes = ["EPCAM", "cd3e", "ACTA2", "CD4"];
const controls = ["NegControlProbe_2", "BLANK_0001"];

const names = (rows: ReturnType<typeof buildGeneRows>) =>
  rows.map((r) => (r.kind === "gene" ? r.name : `[group ${r.count}]`));

describe("buildGeneRows", () => {
  it("lists every gene A-Z and a collapsed control group when browsing", () => {
    const rows = buildGeneRows(genes, controls, "", false);
    expect(names(rows)).toEqual(["ACTA2", "cd3e", "CD4", "EPCAM", "[group 2]"]);
  });

  it("lists the control probes after the group once expanded", () => {
    const rows = buildGeneRows(genes, controls, "", true);
    expect(names(rows).slice(-3)).toEqual([
      "[group 2]",
      "BLANK_0001",
      "NegControlProbe_2",
    ]);
    expect(rows.at(-1)).toMatchObject({ kind: "gene", control: true });
  });

  it("is not limited to a few entries", () => {
    const many = Array.from({ length: 5000 }, (_, i) => `G${i}`);
    expect(buildGeneRows(many, [], "", false)).toHaveLength(5000);
    expect(buildGeneRows(many, [], "G1", false)).toHaveLength(1111);
  });

  it("puts gene matches before control matches when searching", () => {
    const rows = buildGeneRows(
      ["NEGR1", "ANEG"],
      ["NegControlProbe_2"],
      "neg",
      false,
    );
    expect(names(rows)).toEqual(["NEGR1", "ANEG", "NegControlProbe_2"]);
  });

  it("has no group row without control probes", () => {
    expect(names(buildGeneRows(genes, [], "", false))).not.toContain(
      "[group 0]",
    );
  });
});
