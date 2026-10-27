import { describe, expect, it } from "vitest";

import { type InSituSource, NotFoundError } from "../source";
import { openSourceV2 } from "./index";

/** An in-memory source made of text files */
function memorySource(
  files: Record<string, string>,
  label = "memory://",
): InSituSource {
  const source: InSituSource = {
    kind: "url",
    label,
    workspace: null,
    resolve: (p) => `${label}${p}`,
    child: (p) => {
      const prefix = `${p.replace(/\/+$/, "")}/`;
      const nested: Record<string, string> = {};
      for (const [k, v] of Object.entries(files)) {
        if (k.startsWith(prefix)) nested[k.slice(prefix.length)] = v;
      }
      return memorySource(nested, `${label}${prefix}`);
    },
    readText: (p) =>
      p in files
        ? Promise.resolve(files[p]!)
        : Promise.reject(new NotFoundError(p)),
    readJSON: <T>(p: string): Promise<T> =>
      p in files
        ? Promise.resolve(JSON.parse(files[p]!) as unknown as T)
        : Promise.reject(new NotFoundError(p)),
    readBytes: (p) =>
      p in files
        ? Promise.resolve(new TextEncoder().encode(files[p]))
        : Promise.reject(new NotFoundError(p)),
    exists: (p) => Promise.resolve(p in files),
    list: () => Promise.resolve(null),
  };
  return source;
}

const zarrGroup = JSON.stringify({
  zarr_format: 3,
  node_type: "group",
  attributes: {},
});
const imageAttrs = {
  zarr_format: 3,
  node_type: "group",
  attributes: {
    pixel_size: 0.5,
    rgb: true,
    shape: [3, 100, 200],
    ome: {
      multiscales: [
        {
          axes: [{ name: "c" }, { name: "y" }, { name: "x" }],
          datasets: [
            {
              path: "0",
              coordinateTransformations: [
                { type: "scale", scale: [1, 0.5, 0.5] },
              ],
            },
          ],
        },
      ],
    },
  },
};
const level0 = {
  zarr_format: 3,
  node_type: "array",
  shape: [3, 100, 200],
  data_type: "uint8",
  chunk_grid: {
    name: "regular",
    configuration: { chunk_shape: [3, 4096, 4096] },
  },
  codecs: [
    { name: "sharding_indexed", configuration: { chunk_shape: [3, 512, 512] } },
  ],
};

describe("openSourceV2", () => {
  it("reads a project with its images, cell layers and transcripts", async () => {
    const source = memorySource({
      ".ispy": JSON.stringify({
        uid: "abc",
        sample_id: "S1",
        slide_id: "slide",
        method: "Xenium",
        method_params: { pixel_size: 0.5 },
        data: {
          images: { HE: "images/HE.zarr", missing: "images/nope.zarr" },
          cells: "cells/uid1",
          transcripts: "transcripts/transcripts.parquet",
          annotations: "annotations/uid2",
        },
      }),
      "images/HE.zarr/zarr.json": JSON.stringify(imageAttrs),
      "images/HE.zarr/0/zarr.json": JSON.stringify(level0),
      "cells/uid1/.multicelldata": JSON.stringify({
        key_main: "main",
        all_keys: ["proseg", "main"],
      }),
      "annotations/uid2/manifest.json": JSON.stringify({
        keys: { Tumor: "Tumor.geojson" },
      }),
    });
    const opened = await openSourceV2(source);
    expect(opened.kind).toBe("project");
    if (opened.kind !== "project") return;
    const { project } = opened;
    expect(project.sampleId).toBe("S1");
    expect(project.pixelSize).toBe(0.5);
    expect(project.images.map((i) => i.name)).toEqual(["HE"]);
    expect(project.images[0]!.size).toEqual({ width: 200, height: 100 });
    expect(project.images[0]!.dataSource).toEqual({
      type: "ome-zarr",
      source: "memory://images/HE.zarr",
    });
    expect(project.cellLayers).toEqual(["main", "proseg"]);
    expect(project.mainCellLayer).toBe("main");
    expect(project.transcripts?.index).toBeNull();
    expect(project.annotations).toEqual([
      {
        kind: "annotation",
        key: "Tumor",
        dataSource: {
          type: "geojson",
          source: "memory://annotations/uid2/Tumor.geojson",
        },
      },
    ]);
    const missing = project.issues.find((i) => i.subject === "Image missing");
    expect(missing?.severity).toBe("error");
    await expect(project.openCellLayer("nope")).rejects.toThrow(
      /Unknown cell layer/,
    );
  });

  it("reads an experiment from metadata.csv", async () => {
    const source = memorySource({
      "metadata.csv": "# comment\n,uid,crop\n0,abc,A\n1,def,B\n",
      "data-000/.ispy": JSON.stringify({
        uid: "abc",
        sample_id: "S1",
        data: {},
      }),
      "data-001/.ispy": JSON.stringify({
        uid: "zzz",
        sample_id: "S2",
        data: {},
      }),
    });
    const opened = await openSourceV2(source);
    expect(opened.kind).toBe("experiment");
    if (opened.kind !== "experiment") return;
    const { experiment } = opened;
    expect(experiment.metadata.columns).toEqual(["uid", "crop"]);
    expect(experiment.samples.map((s) => s.path)).toEqual([
      "data-000",
      "data-001",
    ]);
    const first = await experiment.openSample(0);
    expect(first.sampleId).toBe("S1");
    expect(experiment.samples[0]!.name).toBe("S1");
    const second = await experiment.openSample(1);
    expect(second.issues.some((i) => i.message.includes("uid"))).toBe(true);
    expect(await experiment.openSample(0)).toBe(first);
  });

  it("explains folders that are neither", async () => {
    await expect(
      openSourceV2(memorySource({ "readme.txt": "" })),
    ).rejects.toThrow(/neither/);
    expect(zarrGroup).toContain("group");
  });
});
