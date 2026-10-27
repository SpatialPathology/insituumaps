import { describe, expect, it } from "vitest";

import type { TableData } from "@tissuumaps/core";

import { RemappedTableData } from "./remappedTable";

function makeBase(): TableData {
  return {
    getIds: () => Uint32Array.from([10, 20, 30]),
    getSize: () => 3,
    getNames: () => ["a", "b", "c"],
    suggestColumnQueries: () => Promise.resolve([]),
    resolveColumnQuery: (q) => Promise.resolve(q),
    loadValues: ((column: string) =>
      Promise.resolve(
        column === "num" ? Float32Array.from([1.5, 2.5, 3.5]) : ["x", "y", "z"],
      )) as TableData["loadValues"],
    close: () => {},
  };
}

describe("RemappedTableData", () => {
  it("maps labels to base rows and keeps array identity", async () => {
    // labels 1 and 2 belong to row 2 and row 0; label 3 has no row
    const labelToRow = Int32Array.from([-1, 2, 0, -1]);
    const table = RemappedTableData.fromLabelToRow(makeBase(), labelToRow);
    expect([...table.getIds()]).toEqual([1, 2]);
    expect(table.getSize()).toBe(2);
    expect(table.getIds()).toBe(table.getIds());
    expect(table.getNames()).toEqual(["c", "a"]);
    const numbers = await table.loadValues<number>("num");
    expect(numbers).toBeInstanceOf(Float32Array);
    expect(Array.from(numbers as Float32Array)).toEqual([3.5, 1.5]);
    const strings = await table.loadValues<string>("str");
    expect(strings).toEqual(["z", "x"]);
    expect(await table.loadValues<number>("num")).toBe(numbers);
    expect(await table.loadValueRange("num")).toEqual([1.5, 3.5]);
  });
});
