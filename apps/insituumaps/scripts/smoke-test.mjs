#!/usr/bin/env node
/**
 * End-to-end smoke test in headless Chromium (needs WebGL 2, which the
 * bundled Playwright Chromium provides through SwiftShader).
 *
 * Expects the dev server and the data server to run, e.g. through
 * `pnpm --filter insituumaps dev:fixture`, or pass the URLs:
 *
 *   node scripts/smoke-test.mjs [--app http://localhost:5174/] [--data http://localhost:8787/fixture/] [--out dir]
 *
 * Opens the fixture experiment, walks through the core workflow (sample, cell
 * layer, expression source, gene, outlines, cell property, transcripts,
 * inspection) and checks the store state and the rendered canvas after each
 * step. Screenshots go to --out (default: test-data/smoke).
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { Browser, sleep } from "./browser.mjs";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const appUrl = arg("--app", "http://localhost:5174/");
const dataUrl = arg("--data", "http://localhost:8787/fixture/");
const outDir = resolve(
  arg("--out", resolve(import.meta.dirname, "../test-data/smoke")),
);
await mkdir(outDir, { recursive: true });

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
  const state = (expr) =>
    page.evaluate(
      `(() => { const s = window.insituumaps.getState(); return JSON.parse(JSON.stringify(${expr})); })()`,
    );
  const call = (expr) =>
    page.evaluate(
      `(async () => { const s = window.insituumaps.getState(); await (${expr}); return true; })()`,
    );
  const settled = async (timeout = 60000) => {
    await page.waitFor(
      `(() => { const s = window.insituumaps.getState(); return [s.openStatus, s.projectStatus, s.cellLayerStatus, s.legendStatus].every(x => x.phase !== "loading"); })()`,
      { timeout, label: "loading to finish" },
    );
    await sleep(2500); // tiles
  };
  const viewerStats = () => page.regionStats(500, 100, 600, 500);

  console.log("0. a wrong address shows a message");
  await page.goto(
    `${appUrl}?source=${encodeURIComponent(dataUrl + "nothing/")}`,
  );
  await page.waitFor(
    `window.insituumaps && window.insituumaps.getState().openStatus.phase === "error"`,
    { timeout: 60000, label: "the error" },
  );
  const errorShown = await page.evaluate(
    `document.body.innerText.includes("Could not open the data") && document.body.innerText.includes("neither")`,
  );
  check(
    errorShown,
    "the start screen explains that the folder is neither a project nor an experiment",
  );

  console.log("1. open the experiment");
  await page.goto(`${appUrl}?source=${encodeURIComponent(dataUrl)}`);
  await page.waitFor(
    `window.insituumaps && window.insituumaps.getState().opened !== null`,
    { timeout: 60000, label: "the source to open" },
  );
  const opened = await state(
    "{ kind: s.opened.kind, samples: s.experiment ? s.experiment.samples.length : 0, browser: s.sampleBrowserOpen }",
  );
  check(opened.kind === "experiment", `opened an experiment (${opened.kind})`);
  check(opened.samples === 2, `2 samples listed (${opened.samples})`);
  check(opened.browser === true, "the sample browser opens first");
  await page.screenshot(`${outDir}/01-samples.png`);

  console.log("2. pick a sample");
  await page.clickText("Open", '[role="dialog"] button');
  await settled();
  const project = await state(
    "{ name: s.project && s.project.sampleId, layers: s.project && s.project.cellLayers, images: s.project && s.project.images.map(i => i.name), layer: s.selection.cellLayer, masks: s.cellLayer && Object.keys(s.cellLayer.masks), genes: s.cellLayer && s.cellLayer.table.genes.length, sources: s.cellLayer && s.cellLayer.table.expressionSources.map(x => x.name), obs: s.cellLayer && s.cellLayer.table.obsColumns.map(c => c.name) }",
  );
  check(project.name === "Replicate 1", `sample opened (${project.name})`);
  check(
    project.layer === "main",
    `main cell layer selected (${project.layer})`,
  );
  check(
    project.masks?.includes("cells") && project.masks?.includes("nuclei"),
    `cell and nucleus masks found (${project.masks})`,
  );
  check(project.genes === 313, `313 genes (${project.genes})`);
  check(project.images?.[0] === "HE", `H&E first (${project.images})`);
  const beforeStats = await viewerStats();
  check(
    beforeStats !== null && beforeStats.nonBackgroundFraction > 0.5,
    `the image renders (${JSON.stringify(beforeStats)})`,
  );
  await page.screenshot(`${outDir}/02-opened.png`);

  console.log("3. colour by a gene");
  const hasCounts = project.sources?.includes("counts");
  await call(
    `s.setColorBy({ kind: "gene", source: ${hasCounts ? '"counts"' : '"X"'}, gene: "EPCAM" })`,
  );
  await settled();
  const legend = await state("s.legend");
  check(
    legend?.kind === "numeric" && legend.autoRange[1] > legend.autoRange[0],
    `numeric legend (${JSON.stringify(legend)})`,
  );
  const labels = await state(
    "s.model.labels.map(l => ({ id: l.id, color: l.labelColor, mode: l.labelRenderMode, opacity: l.opacity }))",
  );
  check(
    labels[0]?.mode === "fill" &&
      labels[0]?.color.from !== undefined &&
      labels[0]?.opacity === 0.5,
    `fill coloured from the table (${JSON.stringify(labels[0])})`,
  );
  check(
    labels.length === 2 &&
      labels[1]?.mode === "outline" &&
      labels[1]?.color.constant?.value.r === 0 &&
      labels[1]?.opacity === 0.5,
    `neutral outlines on top (${JSON.stringify(labels[1])})`,
  );
  if (hasCounts) {
    check(
      labels[0]?.color.from.column.startsWith("layers/counts"),
      `counts layer used (${labels[0]?.color.from.column})`,
    );
  } else {
    console.log("  skip counts layer (converter not run)");
  }
  await page.screenshot(`${outDir}/03-gene.png`);

  console.log("4. nuclei filled, outlines off");
  await call(`s.setMask("nuclei")`);
  await call(`s.setOutlinesVisible(false)`);
  await settled();
  const nucleiModel = await state(
    "s.model.labels.map(l => ({ source: l.dataSource.source, table: l.dataSource.table, mode: l.labelRenderMode }))",
  );
  check(
    nucleiModel.length === 1 &&
      nucleiModel[0]?.source.includes("masks/nuclei") &&
      nucleiModel[0]?.mode === "fill",
    `nucleus mask filled without outlines (${JSON.stringify(nucleiModel)})`,
  );
  await page.screenshot(`${outDir}/04-nuclei-fill.png`);

  console.log("5. colour by a cell property");
  await call(`s.setColorBy({ kind: "obs", column: "leiden" })`);
  await settled();
  const catLegend = await state(
    "s.legend && { kind: s.legend.kind, n: s.legend.categories && s.legend.categories.length }",
  );
  check(
    catLegend?.kind === "categorical" && catLegend.n >= 10,
    `categorical legend with categories (${JSON.stringify(catLegend)})`,
  );
  await call(`s.toggleCategory("1")`);
  await settled();
  const vis = await state("s.model.visibilityMaps");
  check(
    vis.length === 1 && vis[0].values["1"] === false,
    `category toggle hides cluster 1 (${JSON.stringify(vis)})`,
  );
  await page.screenshot(`${outDir}/05-leiden.png`);

  console.log("5b. both outlines over the nucleus fill");
  await call(`s.setOutlinesVisible(true)`);
  await call(`s.setOutlines("both")`);
  await settled();
  const both = await state(
    "s.model.labels.map(l => ({ id: l.id, mode: l.labelRenderMode, source: l.dataSource.source.split('/').pop() }))",
  );
  check(
    both.length === 3 &&
      both[0]?.mode === "fill" &&
      both[0]?.source === "nuclei" &&
      both[1]?.id === "mask-outlines:cells" &&
      both[2]?.id === "mask-outlines:nuclei",
    `nucleus fill, then cell and nucleus outlines (${JSON.stringify(both)})`,
  );
  await page.screenshot(`${outDir}/05b-both-outlines.png`);

  console.log("6. transcripts");
  await call(`s.addTranscriptGene("EPCAM")`);
  await call(`s.addTranscriptGene("CD3E")`);
  await page.waitFor(
    `Object.keys(window.insituumaps.getState().transcriptInfo).length === 2`,
    { timeout: 60000, label: "transcripts to load" },
  );
  await sleep(3000);
  const transcripts = await state(
    "{ info: s.transcriptInfo, points: s.model.points.length, hasIndex: s.transcriptSource.hasIndex }",
  );
  check(
    transcripts.points === 2,
    `two transcript point layers (${transcripts.points})`,
  );
  check(
    transcripts.info.EPCAM?.loaded > 1000,
    `EPCAM transcripts loaded (${transcripts.info.EPCAM?.loaded})`,
  );
  console.log(`  transcript index: ${transcripts.hasIndex}`);
  await page.screenshot(`${outDir}/06-transcripts.png`);

  console.log("7. zoom and inspect a cell");
  for (let i = 0; i < 6; i++) {
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 840,
      y: 400,
      deltaX: 0,
      deltaY: -200,
    });
    await sleep(100);
  }
  await sleep(4000);
  const region = await state("s.transcriptRegion");
  check(
    region !== null && region.width <= 3000,
    `transcript region follows the view (${JSON.stringify(region)})`,
  );
  // click until a cell (not the background between cells) is hit
  let inspection = null;
  for (const [x, y] of [
    [840, 400],
    [800, 360],
    [880, 440],
    [760, 480],
    [920, 320],
  ]) {
    await page.mouseClick(x, y);
    await page.waitFor(
      `(() => { const i = window.insituumaps.getState().inspection; return i !== null && i.status === "ready"; })()`,
      { timeout: 30000, label: "the inspection" },
    );
    inspection = await state("s.inspection");
    if (inspection.label > 0) {
      break;
    }
  }
  check(
    inspection.label > 0 && inspection.values.length > 0,
    `cell inspected (label ${inspection.label}, ${inspection.values.length} values)`,
  );
  await page.screenshot(`${outDir}/07-inspect.png`);

  console.log("8. switch cell layer and sample");
  const layers = project.layers ?? [];
  if (layers.length > 1) {
    await call(`s.selectCellLayer(${JSON.stringify(layers[1])})`);
    await settled();
    const after = await state(
      "{ layer: s.selection.cellLayer, colorBy: s.selection.colorBy }",
    );
    check(
      after.layer === layers[1] && after.colorBy.kind === "obs",
      `layer switched keeping the colouring (${JSON.stringify(after)})`,
    );
  } else {
    console.log("  skip (single cell layer)");
  }
  await call(`s.selectSample(1)`);
  await settled();
  const second = await state(
    "{ sample: s.sampleIndex, colorBy: s.selection.colorBy, genes: s.selection.transcripts.genes.length }",
  );
  check(
    second.sample === 1 && second.colorBy.kind === "obs",
    `second sample shown with the same colouring (${JSON.stringify(second)})`,
  );
  await page.screenshot(`${outDir}/08-sample2.png`);

  const errors = page.errors.filter(
    (e) => !e.includes("404") && !e.includes("GL Driver"),
  );
  check(errors.length === 0, `no console errors (${errors.length})`);
  for (const error of errors) {
    console.log(`    ${error.slice(0, 300)}`);
  }
} finally {
  await browser.close();
}
console.log(
  failures === 0
    ? "\nSmoke test passed"
    : `\nSmoke test: ${failures} checks failed`,
);
process.exit(failures === 0 ? 0 : 1);
