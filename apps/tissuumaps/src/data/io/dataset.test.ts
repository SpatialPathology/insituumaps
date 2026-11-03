import { describe, expect, it } from "vitest";

import type { ProjectImporter } from "@tissuumaps/core";

import { findProjectImporter } from "./dataset";

function importer(
  id: string,
  supports: (source: string) => boolean | Promise<boolean>,
): ProjectImporter {
  return {
    id,
    name: id,
    supports: async (source) => await supports(source),
    open: () => Promise.resolve({ name: id }),
  };
}

describe("findProjectImporter", () => {
  it("returns the first registered importer that supports the source", async () => {
    const importers = [
      importer("a", () => false),
      importer("b", (source) => source.endsWith(".zarr")),
      importer("c", () => true),
    ];
    const found = await findProjectImporter(importers, "x.zarr", null);
    expect(found?.id).toBe("b");
  });

  it("treats a rejection as not supported", async () => {
    const importers = [
      importer("a", () => Promise.reject(new Error("unreachable"))),
      importer("b", () => true),
    ];
    const found = await findProjectImporter(importers, "x", null);
    expect(found?.id).toBe("b");
  });

  it("returns undefined if no importer supports the source", async () => {
    const found = await findProjectImporter(
      [importer("a", () => false)],
      "x",
      null,
    );
    expect(found).toBeUndefined();
  });

  it("asks all importers at once", async () => {
    const asked: string[] = [];
    let release = () => {};
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const importers = [
      importer("slow", async () => {
        asked.push("slow");
        await blocked;
        return false;
      }),
      importer("fast", () => {
        asked.push("fast");
        return true;
      }),
    ];
    const found = findProjectImporter(importers, "x", null);
    await Promise.resolve();
    expect(asked).toEqual(["slow", "fast"]);
    release();
    expect((await found)?.id).toBe("fast");
  });

  it("rejects once aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();
    await expect(
      findProjectImporter([importer("a", () => true)], "x", null, {
        signal: abortController.signal,
      }),
    ).rejects.toThrow();
  });
});
