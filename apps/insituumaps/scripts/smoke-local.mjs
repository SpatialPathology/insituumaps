#!/usr/bin/env node
/**
 * Smoke test of the "local folder" mode without a directory picker: copies
 * one fixture sample into the browser's origin-private file system (real
 * FileSystemDirectoryHandle objects) and opens it through the same code path
 * as a folder picked by the user.
 *
 *   node scripts/smoke-local.mjs [--app http://localhost:5174/] [--data http://localhost:8787/fixture/data-000/] [--folder test-data/fixture/data-000]
 */
import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { Browser, sleep } from "./browser.mjs";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const appUrl = arg("--app", "http://localhost:5174/");
const dataUrl = arg("--data", "http://localhost:8787/fixture/data-000/");
const folder = resolve(
  arg(
    "--folder",
    resolve(import.meta.dirname, "../test-data/fixture/data-000"),
  ),
);

// the files the viewer needs; the h5ad and the Parquet file are not read when
// the converter ran
const skip = /\.h5ad$|transcripts\.parquet$/;
const files = (await readdir(folder, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) =>
    relative(folder, join(entry.parentPath ?? entry.path, entry.name))
      .split("\\")
      .join("/"),
  )
  .filter((path) => !skip.test(path));
console.log(
  `${files.length} files to copy into the browser's private file system`,
);

let failures = 0;
function check(condition, message) {
  if (condition) {
    console.log(`  ok   ${message}`);
  } else {
    failures++;
    console.log(`  FAIL ${message}`);
  }
}

const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.goto(appUrl);
  await page.waitFor(`!!window.insituumaps`, {
    timeout: 30000,
    label: "the app",
  });
  console.log("copying files ...");
  const copied = await page.evaluate(`(async () => {
    const root = await navigator.storage.getDirectory();
    const sample = await root.getDirectoryHandle("sample", { create: true });
    const files = ${JSON.stringify(files)};
    let n = 0;
    const copyOne = async (path) => {
      const parts = path.split("/");
      let dir = sample;
      for (const part of parts.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
      const file = await dir.getFileHandle(parts.at(-1), { create: true });
      const response = await fetch(${JSON.stringify(dataUrl)} + path.split("/").map(encodeURIComponent).join("/"));
      if (!response.ok) throw new Error("fetch failed: " + path);
      const writable = await file.createWritable();
      await response.body.pipeTo(writable);
      n++;
    };
    // a few at a time
    for (let i = 0; i < files.length; i += 8) {
      await Promise.all(files.slice(i, i + 8).map(copyOne));
    }
    window.__sample = sample;
    return n;
  })()`);
  check(copied === files.length, `copied ${copied} files`);

  console.log("opening the folder through the directory code path");
  await page.evaluate(
    `window.insituumaps.getState().openDirectory(window.__sample)`,
  );
  await page.waitFor(
    `(() => { const s = window.insituumaps.getState(); return s.cellLayer !== null && [s.openStatus, s.projectStatus, s.cellLayerStatus].every(x => x.phase !== "loading"); })()`,
    { timeout: 90000, label: "the project to load from the directory" },
  );
  await sleep(4000);
  const state = (expr) =>
    page.evaluate(
      `(() => { const s = window.insituumaps.getState(); return JSON.parse(JSON.stringify(${expr})); })()`,
    );
  const project = await state(
    "{ kind: s.source.kind, sample: s.project.sampleId, labels: s.model.labels.map(l => l.dataSource.source), images: s.model.images.map(i => i.dataSource.source), masks: Object.keys(s.cellLayer.masks) }",
  );
  check(project.kind === "directory", `directory source (${project.kind})`);
  check(project.sample === "Replicate 1", `sample opened (${project.sample})`);
  // the picked folder is the workspace, so paths are relative to it
  check(
    project.images[0]?.startsWith("/images/"),
    `workspace paths for images (${project.images[0]})`,
  );
  const stats = await page.regionStats(500, 100, 600, 500);
  check(
    stats !== null && stats.nonBackgroundFraction > 0.5,
    `the image renders (${JSON.stringify(stats)})`,
  );
  await page.evaluate(
    `window.insituumaps.getState().setColorBy({ kind: "gene", source: "X", gene: "EPCAM" })`,
  );
  await page.waitFor(`window.insituumaps.getState().legend !== null`, {
    timeout: 60000,
    label: "the legend",
  });
  await sleep(3000);
  const legend = await state("s.legend");
  check(
    legend?.kind === "numeric",
    `gene colouring from the local table (${JSON.stringify(legend)})`,
  );
  await page.evaluate(
    `window.insituumaps.getState().addTranscriptGene("EPCAM")`,
  );
  await page.waitFor(
    `window.insituumaps.getState().transcriptInfo.EPCAM !== undefined`,
    { timeout: 60000, label: "transcripts" },
  );
  const transcripts = await state("s.transcriptInfo.EPCAM");
  check(
    transcripts.loaded > 1000,
    `transcripts from the local index (${transcripts.loaded})`,
  );
  let inspection = null;
  for (const [x, y] of [
    [840, 400],
    [800, 360],
    [880, 440],
    [760, 480],
  ]) {
    await page.mouseClick(x, y);
    await page.waitFor(
      `(() => { const i = window.insituumaps.getState().inspection; return i !== null && i.status === "ready"; })()`,
      { timeout: 30000, label: "the inspection" },
    );
    inspection = await state("s.inspection");
    if (inspection.label > 0) break;
  }
  check(
    inspection?.label > 0,
    `cell inspected from the local mask (label ${inspection?.label})`,
  );
  await page
    .screenshot(resolve(import.meta.dirname, "../test-data/smoke-local.png"))
    .catch(() => {});
  const errors = page.errors.filter(
    (e) => !e.includes("404") && !e.includes("GL Driver"),
  );
  check(errors.length === 0, `no console errors (${errors.length})`);
  for (const error of errors) console.log(`    ${error.slice(0, 300)}`);
} finally {
  await browser.close();
}
console.log(
  failures === 0
    ? "\nLocal folder smoke test passed"
    : `\nLocal folder smoke test: ${failures} checks failed`,
);
process.exit(failures === 0 ? 0 : 1);
