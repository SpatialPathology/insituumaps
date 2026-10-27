// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { DirectorySource, NotFoundError, URLSource } from "./source";

type FakeDir = {
  kind: "directory";
  name: string;
  entries: Record<string, FakeEntry>;
};
type FakeFile = { kind: "file"; name: string; data: Uint8Array };
type FakeEntry = FakeDir | FakeFile;

function dir(name: string, entries: Record<string, FakeEntry>): FakeDir {
  return { kind: "directory", name, entries };
}
function file(name: string, text: string): FakeFile {
  return { kind: "file", name, data: new TextEncoder().encode(text) };
}

/** A minimal FileSystemDirectoryHandle lookalike */
function handle(entry: FakeDir): FileSystemDirectoryHandle {
  const domError = (name: string) => {
    const error = new DOMException("", name);
    return error;
  };
  const fileHandle = (f: FakeFile): FileSystemFileHandle =>
    ({
      kind: "file",
      name: f.name,
      getFile: () =>
        Promise.resolve(new File([f.data as unknown as BlobPart], f.name)),
    }) as unknown as FileSystemFileHandle;
  const h = {
    kind: "directory",
    name: entry.name,
    getDirectoryHandle: (name: string) => {
      const child = entry.entries[name];
      if (child === undefined) return Promise.reject(domError("NotFoundError"));
      if (child.kind !== "directory")
        return Promise.reject(domError("TypeMismatchError"));
      return Promise.resolve(handle(child));
    },
    getFileHandle: (name: string) => {
      const child = entry.entries[name];
      if (child === undefined) return Promise.reject(domError("NotFoundError"));
      if (child.kind !== "file")
        return Promise.reject(domError("TypeMismatchError"));
      return Promise.resolve(fileHandle(child));
    },
    *entries() {
      for (const [name, child] of Object.entries(entry.entries)) {
        yield [name, { kind: child.kind, name }];
      }
    },
  };
  return h as unknown as FileSystemDirectoryHandle;
}

describe("DirectorySource", () => {
  const root = handle(
    dir("exp", {
      "metadata.csv": file("metadata.csv", "a,b\n1,2\n"),
      "data-000": dir("data-000", {
        ".ispy": file(".ispy", '{"sample_id": "S1"}'),
        annotations: dir("annotations", {
          "k.geojson": file("k.geojson", "{}"),
        }),
      }),
    }),
  );

  it("resolves workspace paths and reads files", async () => {
    const source = new DirectorySource(root);
    expect(source.kind).toBe("directory");
    expect(source.resolve("data-000/images/HE.zarr")).toBe(
      "/data-000/images/HE.zarr",
    );
    expect(await source.readText("metadata.csv")).toBe("a,b\n1,2\n");
    const child = source.child("data-000");
    expect(child.resolve("x")).toBe("/data-000/x");
    expect(child.label).toBe("exp/data-000");
    expect(await child.readJSON<{ sample_id: string }>(".ispy")).toEqual({
      sample_id: "S1",
    });
    expect(await child.exists(".ispy")).toBe(true);
    expect(await child.exists("nothing")).toBe(false);
    expect(await child.list("annotations")).toEqual([
      { name: "k.geojson", kind: "file" },
    ]);
    await expect(child.readText("missing")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("reads byte ranges and suffixes", async () => {
    const source = new DirectorySource(root);
    expect(
      Array.from(await source.readBytes("metadata.csv", { range: [0, 3] })),
    ).toEqual(Array.from(new TextEncoder().encode("a,b")));
    expect(
      new TextDecoder().decode(
        await source.readBytes("metadata.csv", { suffixLength: 4 }),
      ),
    ).toBe("1,2\n");
  });
});

describe("URLSource", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalises the base URL and encodes path segments", () => {
    const source = new URLSource("https://example.org/data/exp?x=1");
    expect(source.baseUrl).toBe("https://example.org/data/exp/");
    expect(source.resolve("data-000/images/H E.zarr")).toBe(
      "https://example.org/data/exp/data-000/images/H%20E.zarr",
    );
    expect(source.child("data-000").resolve(".ispy")).toBe(
      "https://example.org/data/exp/data-000/.ispy",
    );
  });

  it("maps 404 to NotFoundError and honours ranges", async () => {
    const calls: {
      url: string;
      headers: Record<string, string> | undefined;
    }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (
          url: string,
          init?: { headers?: Record<string, string>; method?: string },
        ) => {
          calls.push({ url, headers: init?.headers });
          if (url.endsWith("missing")) {
            return Promise.resolve(new Response(null, { status: 404 }));
          }
          const body = new TextEncoder().encode("0123456789");
          const range = init?.headers?.["Range"];
          if (range !== undefined) {
            const [, a, b] = /bytes=(\d*)-(\d*)/.exec(range)!;
            const slice =
              a === ""
                ? body.slice(-Number(b))
                : body.slice(Number(a), Number(b) + 1);
            return Promise.resolve(new Response(slice, { status: 206 }));
          }
          return Promise.resolve(new Response(body, { status: 200 }));
        },
      ),
    );
    const source = new URLSource("https://example.org/p/");
    await expect(source.readText("missing")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(
      new TextDecoder().decode(await source.readBytes("f", { range: [2, 5] })),
    ).toBe("234");
    expect(
      new TextDecoder().decode(
        await source.readBytes("f", { suffixLength: 3 }),
      ),
    ).toBe("789");
    expect(calls.at(-1)?.headers?.["Range"]).toBe("bytes=-3");
    expect(await source.list("x")).toBeNull();
  });
});
