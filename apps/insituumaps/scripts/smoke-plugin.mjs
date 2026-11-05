#!/usr/bin/env node
/**
 * End-to-end smoke test of the TissUUmaps plugin in headless Chromium (needs
 * WebGL 2, see smoke-test.mjs).
 *
 * Expects three servers: the TissUUmaps app, the fixture data server and the
 * plugin server, e.g.
 *
 *   pnpm --filter tissuumaps exec vite --port 5173 --strictPort
 *   pnpm --filter insituumaps dev:fixture
 *   pnpm --filter insituumaps dev:plugin
 *
 * A production build of the app (`pnpm build`, then
 * `pnpm --filter tissuumaps exec vite preview --port 5175` and
 * `--app http://localhost:5175/`) is more reliable than the dev server, which
 * reloads the page when its connection to the page breaks.
 *
 *   node scripts/smoke-plugin.mjs [--app http://localhost:5173/] [--data http://localhost:8787/fixture/] [--plugin http://localhost:8788/insitupy-plugin.js] [--out dir]
 *
 * Opens the TissUUmaps app with `?source=` naming the fixture experiment, adds
 * the plugin as a module script (it registers itself, and the app opens the
 * source through the plugin's importer and shows the plugin's lens; in
 * an app without project importers, the plugin opens the source itself),
 * walks through sample, cell layer, colouring, outlines, images, transcripts
 * and overlays, and checks that the app's project store and viewer follow.
 * Overlays are only checked if the first sample has some (the fixture has
 * none; scripts/add_demo_annotations.py adds them). Screenshots go to --out (default:
 * test-data/smoke-plugin).
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { Browser, sleep } from "./browser.mjs";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const appUrl = arg("--app", "http://localhost:5173/");
const dataUrl = arg("--data", "http://localhost:8787/fixture/");
const pluginUrl = arg("--plugin", "http://localhost:8788/insitupy-plugin.js");
const outDir = resolve(
  arg("--out", resolve(import.meta.dirname, "../test-data/smoke-plugin")),
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
  // `s` is the fork store's state, `app` and `project` the app's stores' state
  const prelude = `const p = window.insitupyPlugin; const s = p.insitupyStore.getState(); const app = p.stores.appStore.getState(); const project = p.stores.projectStore.getState();`;
  const state = (expr) =>
    page.evaluate(
      `(() => { ${prelude} return JSON.parse(JSON.stringify(${expr})); })()`,
    );
  const call = (expr) =>
    page.evaluate(
      `(async () => { ${prelude} await (${expr}); return true; })()`,
    );
  const settled = async (timeout = 60000) => {
    await page.waitFor(
      `(() => {
        const p = window.insitupyPlugin;
        const s = p.insitupyStore.getState();
        const data = p.stores.dataStore.getState();
        const loading = [data.imageDataRefs, data.labelsDataRefs, data.pointsDataRefs, data.shapesDataRefs, data.tableDataRefs]
          .some((refs) => [...refs.values()].some((ref) => ref.status === "loading"));
        return !loading && [s.openStatus, s.projectStatus, s.cellLayerStatus, s.legendStatus].every((x) => x.phase !== "loading");
      })()`,
      { timeout, label: "loading to finish" },
    );
    await sleep(3000); // tiles
  };
  // the viewer fills the window left of the panel group
  const viewerStats = () => page.regionStats(100, 100, 500, 500);

  console.log("1. open the experiment through ?source= and the plugin");
  await page.goto(`${appUrl}?source=${encodeURIComponent(dataUrl)}`);
  await page.waitFor(`window.tissuumaps !== undefined`, {
    label: "the app to start",
  });
  await page.evaluate(`(() => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = ${JSON.stringify(pluginUrl)};
    document.head.append(script);
    return true;
  })()`);
  await page.waitFor(
    `window.insitupyPlugin !== undefined && window.insitupyPlugin.insitupyStore.getState().opened !== null`,
    { label: "the plugin to open the source" },
  );
  const opened = await state(
    "{ kind: s.opened.kind, samples: s.experiment ? s.experiment.samples.length : 0, browser: s.sampleBrowserOpen, panel: app.activePanelId }",
  );
  check(opened.kind === "experiment", `opened an experiment (${opened.kind})`);
  check(opened.samples === 2, `2 samples listed (${opened.samples})`);
  check(opened.browser === true, "the sample browser opens first");
  check(
    opened.panel === "plugin:insitupy",
    `the plugin's panel is active (${opened.panel})`,
  );
  // tab titles of the panel layout, for the lens checks
  const tabs = () =>
    page.evaluate(
      `[...document.querySelectorAll(".dv-tab")].map((tab) => tab.textContent.trim()).filter(Boolean)`,
    );
  const importsDatasets = await state(
    "typeof app.registerProjectImporter === 'function'",
  );
  if (importsDatasets) {
    const lens = await state(
      "{ active: app.activeLensId, importer: project.importerId }",
    );
    check(
      lens.importer === "insitupy",
      `the app opened ?source= through the plugin's importer (${lens.importer})`,
    );
    check(
      lens.active === "insitupy",
      `the InSituPy lens is active (${lens.active})`,
    );
    const lensTabs = await tabs();
    check(
      !["Images", "Labels", "Points", "Shapes", "Tables"].some((title) =>
        lensTabs.includes(title),
      ),
      `the generic data panels are hidden (${lensTabs})`,
    );
  }
  await page.screenshot(`${outDir}/01-samples.png`);

  console.log("2. pick a sample");
  await page.clickText("Open", '[role="dialog"] button');
  await settled();
  const first = await state(
    "{ instance: project.instanceId, name: project.name, layers: project.layers.map(l => l.id), images: project.images.map(i => i.id), labels: project.labels.map(l => l.id), tables: project.tables.map(t => t.id), open: app.projectOpen }",
  );
  check(
    first.images.includes("image:HE"),
    `the app's project has the H&E image (${first.images})`,
  );
  check(
    first.layers.length === 1 && first.layers[0] === "sample",
    `one layer (${first.layers})`,
  );
  check(
    first.labels.includes("mask-outlines:cells"),
    `cell outlines (${first.labels})`,
  );
  check(first.tables.includes("cells"), `cell table (${first.tables})`);
  check(first.open === true, "the app marks the project open");
  const firstStats = await viewerStats();
  check(
    firstStats !== null && firstStats.nonBackgroundFraction > 0.5,
    `the app's viewer draws the sample (${JSON.stringify(firstStats)})`,
  );
  await page.screenshot(`${outDir}/02-opened.png`);

  console.log("3. colour by a gene");
  const sources = await state(
    "s.cellLayer.table.expressionSources.map(x => x.name)",
  );
  const source = sources.includes("counts") ? "counts" : "X";
  await call(
    `s.setColorBy({ kind: "gene", source: "${source}", gene: "EPCAM" })`,
  );
  await settled();
  const legend = await state("s.legend");
  check(
    legend?.kind === "numeric" && legend.autoRange[1] > legend.autoRange[0],
    `numeric legend (${JSON.stringify(legend?.autoRange)})`,
  );
  const fill = await state(
    "project.labels.filter(l => l.id === 'mask').map(l => ({ color: l.labelColor, mode: l.labelRenderMode, opacity: l.opacity }))[0]",
  );
  check(
    fill?.mode === "fill" && fill.color.from !== undefined,
    `the app's project fills cells from the table (${JSON.stringify(fill)})`,
  );
  check(
    (await page.evaluate(`document.body.innerText.includes("EPCAM")`)) === true,
    "the panel names the gene",
  );
  await page.screenshot(`${outDir}/03-gene.png`);

  console.log("4. objects added in the generic panels stay");
  await call(
    `p.stores.projectStore.getState().addLabels({ ...project.labels.find(l => l.id === 'mask'), id: 'user-labels', name: 'Mine' })`,
  );
  await call(`s.setColorBy({ kind: "obs", column: "leiden" })`);
  await settled();
  const categorical = await state(
    "{ legend: s.legend && s.legend.kind, categories: s.legend && s.legend.categories && s.legend.categories.length, labels: project.labels.map(l => l.id), maps: project.colorMaps.map(m => m.id), instance: project.instanceId }",
  );
  check(
    categorical.legend === "categorical" && categorical.categories > 1,
    `categorical legend (${categorical.categories} categories)`,
  );
  check(
    categorical.maps.includes("categories"),
    `category colour map (${categorical.maps})`,
  );
  check(
    categorical.labels.includes("user-labels"),
    `the user's labels survive a rebuild (${categorical.labels})`,
  );
  check(
    categorical.instance === first.instance,
    "a new colouring keeps the project instance",
  );
  await call(`p.stores.projectStore.getState().deleteLabels('user-labels')`);
  const firstCategory = await state("s.legend.categories[0].name");
  await call(`s.toggleCategory(${JSON.stringify(firstCategory)})`);
  await settled();
  const hidden = await state(
    "project.visibilityMaps.filter(m => m.id === 'category-visibility').map(m => m.values)[0]",
  );
  check(
    hidden?.[firstCategory] === false,
    `hiding a category reaches the app (${JSON.stringify(hidden)})`,
  );
  await page.screenshot(`${outDir}/04-leiden.png`);
  await call(`s.toggleCategory(${JSON.stringify(firstCategory)})`);

  console.log("5. switch the cell layer");
  const layers = await state("s.project.cellLayers");
  if (layers.length > 1) {
    await call(`s.selectCellLayer(${JSON.stringify(layers[1])})`);
    await settled();
    const switched = await state(
      "{ layer: s.selection.cellLayer, table: project.tables.find(t => t.id === 'cells').dataSource.source }",
    );
    check(
      switched.layer === layers[1] && switched.table.includes(layers[1]),
      `the app's cell table follows the layer (${JSON.stringify(switched)})`,
    );
    const stats = await viewerStats();
    check(
      stats !== null && stats.nonBackgroundFraction > 0.5,
      `still drawn (${JSON.stringify(stats)})`,
    );
    await page.screenshot(`${outDir}/05-layer.png`);
    // back to the main layer, so that the headless renderer holds the data of
    // one cell layer only in the following steps
    await call(`s.selectCellLayer(${JSON.stringify(layers[0])})`);
    await settled();
  } else {
    console.log("  skip (single cell layer)");
  }

  // scrolls a section of the plugin's panel into view, for the screenshots;
  // only the panel's own scroll container scrolls (scrollIntoView would also
  // scroll the app's layout)
  const showSection = async (title) => {
    await page.evaluate(`(() => {
      const heading = [...document.querySelectorAll(".insitupy-plugin *")].find(
        (e) => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(title)},
      );
      let container = heading?.parentElement;
      while (container && getComputedStyle(container).overflowY !== "auto") {
        container = container.parentElement;
      }
      if (heading && container) {
        container.scrollTop += heading.getBoundingClientRect().top - container.getBoundingClientRect().top - 8;
      }
      return true;
    })()`);
    await sleep(300);
  };
  // the data of an object of the app's project, as the app's caches hold it,
  // once it is no longer loading (the viewer may only start loading it after
  // `settled` has returned)
  const dataStatus = async (kind, id) => {
    const status = () =>
      state(
        `(() => { const ref = p.stores.dataStore.getState()["${kind}DataRefs"].get(${JSON.stringify(id)}); return ref ? ref.status + (ref.error ? ": " + String(ref.error) : "") : "none"; })()`,
      );
    for (let waited = 0; waited < 60000; waited += 500) {
      const current = await status();
      if (current !== "loading" && current !== "none") {
        return current;
      }
      await sleep(500);
    }
    return await status();
  };

  console.log("5b. outlines on nuclei");
  await call(`s.setOutlines("nuclei")`);
  await settled();
  const outlines = await state(
    "project.labels.filter(l => l.id.startsWith('mask-outlines:')).map(l => ({ id: l.id, mode: l.labelRenderMode }))",
  );
  check(
    outlines.length === 1 &&
      outlines[0].id === "mask-outlines:nuclei" &&
      outlines[0].mode === "outline",
    `nucleus outlines in the app's project (${JSON.stringify(outlines)})`,
  );
  const nucleusOutlines = await dataStatus("labels", "mask-outlines:nuclei");
  check(
    nucleusOutlines === "loaded",
    `nucleus outlines loaded (${nucleusOutlines})`,
  );
  await showSection("Outlines");
  await page.screenshot(`${outDir}/05b-nuclei-outlines.png`);

  console.log("5c. images");
  const imageNames = await state("s.project.images.map(i => i.name)");
  const grayscale = await state(
    "s.project.images.filter(i => !i.rgb).map(i => i.name)[0]",
  );
  if (grayscale !== undefined) {
    await call(`s.setImage(${JSON.stringify(grayscale)}, { visible: true })`);
    await call(
      `s.setImage(${JSON.stringify(imageNames[0])}, { opacity: 0.4 })`,
    );
    await settled();
    const images = await state(
      "project.images.map(i => ({ id: i.id, visible: i.visibility, opacity: i.opacity, type: i.dataSource.type }))",
    );
    const gray = images.find((i) => i.id === `image:${grayscale}`);
    check(
      gray?.visible === true && gray.type === "insituumaps-grayscale",
      `the grayscale image is shown through the plugin's provider (${JSON.stringify(gray)})`,
    );
    check(
      images.find((i) => i.id === `image:${imageNames[0]}`)?.opacity === 0.4,
      "the first image's opacity reaches the app",
    );
    const grayStatus = await dataStatus("image", `image:${grayscale}`);
    check(grayStatus === "loaded", `grayscale image loaded (${grayStatus})`);
    await showSection("Images");
    await page.screenshot(`${outDir}/05c-images.png`);
    await call(`s.setImage(${JSON.stringify(grayscale)}, { visible: false })`);
    await call(`s.setImage(${JSON.stringify(imageNames[0])}, { opacity: 1 })`);
  } else {
    console.log("  skip (no grayscale image)");
  }

  console.log("5d. transcripts of two genes");
  await call(`s.addTranscriptGene("EPCAM")`);
  await call(`s.addTranscriptGene("CD3E")`);
  await settled();
  const points = await state(
    "{ ids: project.points.map(x => x.id), region: s.transcriptRegion, info: s.transcriptInfo }",
  );
  check(
    points.ids.includes("transcripts:EPCAM") &&
      points.ids.includes("transcripts:CD3E"),
    `one points object per gene in the app's project (${points.ids})`,
  );
  check(
    points.region !== null && points.region.width >= 1000,
    `transcripts are loaded for the whole sample (${JSON.stringify(points.region)})`,
  );
  check(
    points.info.EPCAM?.loaded > 1000,
    `EPCAM transcripts loaded (${points.info.EPCAM?.loaded})`,
  );
  const epcamStatus = await dataStatus("points", "transcripts:EPCAM");
  check(epcamStatus === "loaded", `EPCAM points loaded (${epcamStatus})`);
  await showSection("Transcripts");
  await page.screenshot(`${outDir}/05d-transcripts.png`);

  console.log("5e. annotations and regions");
  const overlayKeys = await state(
    "[...s.project.annotations, ...s.project.regions].map(e => e.kind + ':' + e.key)",
  );
  if (overlayKeys.length > 0) {
    for (const key of overlayKeys) {
      await call(`s.toggleOverlay(${JSON.stringify(key)})`);
    }
    await settled();
    const shapes = await state("project.shapes.map(x => x.id)");
    check(
      overlayKeys.every((key) => shapes.includes(`overlay:${key}`)),
      `overlays in the app's project (${shapes})`,
    );
    const shapesStatus = await dataStatus(
      "shapes",
      `overlay:${overlayKeys[0]}`,
    );
    check(shapesStatus === "loaded", `overlay loaded (${shapesStatus})`);
    await showSection("Annotations and regions");
    await page.screenshot(`${outDir}/05e-overlays.png`);
  } else {
    console.log(
      "  skip (no annotations; run scripts/add_demo_annotations.py on data-000)",
    );
  }
  const sections = await page.evaluate(`document.body.innerText`);
  check(
    ["OUTLINES", "IMAGES", "TRANSCRIPTS"].every((title) =>
      sections.toUpperCase().includes(title),
    ),
    "the panel shows the Outlines, Images and Transcripts sections",
  );

  console.log("6. the generic panels show the plugin's objects");
  if (importsDatasets) {
    // as the lens menu's "Generic" does
    await call(`app.setActiveLensId(null)`);
    await call(`window.tissuumaps.unmountPlugin("insitupy")`);
    await sleep(500);
    const genericTabs = await tabs();
    check(
      ["Images", "Labels", "Points", "Shapes", "Tables"].every((title) =>
        genericTabs.includes(title),
      ),
      `the generic lens shows the data panels again (${genericTabs})`,
    );
  }
  await call(`app.setActivePanelId("labels")`);
  await sleep(500);
  const labelsPanel = await page.evaluate(`document.body.innerText`);
  check(
    /(Cell|Nucleus) outlines/.test(labelsPanel),
    "the Labels panel lists the outlines",
  );
  await page.screenshot(`${outDir}/06-labels-panel.png`);
  if (importsDatasets) {
    // as choosing InSituPy in the lens menu does
    await call(`app.setActiveLensId("insitupy")`);
    await call(`window.tissuumaps.mountPlugin("insitupy")`);
    await sleep(1000);
    const panelText = await page.evaluate(`document.body.innerText`);
    check(
      panelText.includes("leiden"),
      "back in the lens, the sidebar shows the same colouring",
    );
  } else {
    await call(`app.setActivePanelId("plugin:insitupy")`);
  }

  console.log("7. another sample replaces the project");
  await call(`s.selectSample(1)`);
  await settled();
  const second = await state(
    "{ instance: project.instanceId, name: project.name, colorBy: s.selection.colorBy, image: project.images[0] && project.images[0].dataSource.source, points: project.points.map(x => x.id) }",
  );
  check(
    second.instance !== first.instance,
    "a new project instance (the view is fitted again)",
  );
  check(
    second.image?.includes("data-001"),
    `the second sample's image (${second.image})`,
  );
  check(
    second.colorBy.kind === "obs",
    `the colouring is kept (${JSON.stringify(second.colorBy)})`,
  );
  check(
    second.points.includes("transcripts:EPCAM"),
    `the transcript genes are kept (${second.points})`,
  );
  const secondPoints = await dataStatus("points", "transcripts:EPCAM");
  check(
    secondPoints === "loaded",
    `the second sample's transcripts loaded (${secondPoints})`,
  );
  const secondStats = await viewerStats();
  check(
    secondStats !== null && secondStats.nonBackgroundFraction > 0.5,
    `the second sample is drawn (${JSON.stringify(secondStats)})`,
  );
  await page.screenshot(`${outDir}/07-sample2.png`);

  // Clearing the project while the viewer still recolours tiles makes the
  // app log "Failed to transfer tile data: Data has been destroyed": tiles of
  // removed images are still recoloured after the data cache destroyed their
  // data. This is the app's own cleanup race, not the plugin's, so the test
  // lets the recolouring finish first.
  await sleep(8000);

  console.log("8. a project opened in the app closes the plugin's source");
  await call(`p.stores.projectStore.getState().clear()`);
  await sleep(500);
  const closed = await state(
    "{ source: s.source, panel: app.activePanelId, lens: app.activeLensId }",
  );
  check(closed.source === null, "the plugin shows its start screen again");
  if (importsDatasets) {
    check(
      closed.lens === null,
      `the generic lens for a project without importer (${closed.lens})`,
    );
  }
  await page.screenshot(`${outDir}/08-closed.png`);

  // "Failed to transfer tile data: Data has been destroyed" is the app's own
  // race: tiles of an image or labels object whose data source changed are
  // still recoloured after the data cache destroyed the old data (see
  // docs/lens-prototype-spec.md, section 12)
  const errors = page.errors.filter(
    (e) =>
      !e.includes("404") &&
      !e.includes("GL Driver") &&
      !e.includes("project.tm4") &&
      !e.includes("Failed to transfer tile data"),
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
    ? "\nPlugin smoke test passed"
    : `\nPlugin smoke test: ${failures} checks failed`,
);
process.exit(failures === 0 ? 0 : 1);
