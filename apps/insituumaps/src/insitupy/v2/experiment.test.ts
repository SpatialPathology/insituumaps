import { describe, expect, it } from "vitest";

import { parseCSVLine, sampleFolderName } from "./experiment";

describe("experiment helpers", () => {
  it("names sample folders like InSituPy", () => {
    expect(sampleFolderName(0)).toBe("data-000");
    expect(sampleFolderName(12)).toBe("data-012");
    expect(sampleFolderName(1234)).toBe("data-1234");
  });

  it("parses CSV lines with quotes", () => {
    expect(parseCSVLine('a,"b, c",d')).toEqual(["a", "b, c", "d"]);
    expect(parseCSVLine('"x ""y"" z",')).toEqual(['x "y" z', ""]);
    expect(parseCSVLine("")).toEqual([""]);
  });
});
