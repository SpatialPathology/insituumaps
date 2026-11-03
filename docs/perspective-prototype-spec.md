# InSituPy perspective prototype: implementation spec

Status: milestones 1a and 1b and step 2 implemented (2026-11-03); the demo recording (step 3) is open. Branch `feat/insitupy-perspective-prototype` of `SpatialPathology/insituumaps`, started from fork `main` at `da0165c`. Section 12 lists where the implementation differs from this plan.

This spec turns section 12 of the design doc ([perspective-prototype.md](./perspective-prototype.md)) into ordered tasks for a later implementation session. It covers milestone 1a, milestone 1b and step 2. The demo recording (step 3) is done locally by Johannes after step 2.

Decisions taken in the planning session:

| Question        | Decision                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step-1 entry    | Both: a start screen in the plugin panel (URL field and folder picker) **and** the plugin reading `?source=` from the page URL when it is set up                          |
| Scope and order | 1a (Sample, Cell layer, Colour cells by), then 1b (the other five sidebar sections), then step 2 (importer registry, `source` parameter, perspective hook), then the demo |
| Branch          | `feat/insitupy-perspective-prototype`                                                                                                                                     |

## 1. Words used in this spec

For readers new to TypeScript and to this codebase. Python and napari comparisons where they help.

- **Store**: a global state object with functions that change it (Zustand library). Think of a Python singleton holding a dict plus methods, which also notifies subscribers on every change, like a Qt signal. The app has four stores: `appStore` (UI state, data providers, plugins), `projectStore` (the project: images, labels, points, shapes, tables, maps), `dataStore` (loading state) and `settingsStore` (dark mode).
- **Project store**: the generic model the viewer draws. It plays the role of napari's `viewer.layers`: whatever is in it is rendered.
- **Data provider**: an object that knows how to read one file format for one data kind, registered under a "data source type" string. Comparable to a napari reader plugin, but for a single object rather than a whole dataset.
- **Plugin**: an ES module (a JavaScript file) whose default export is `{ id, name, setup, mount }`. `setup` runs once when the plugin is loaded, `mount` draws its user interface into one panel. Comparable to a napari plugin that contributes one dock widget.
- **Fork store**: the Zustand store of `apps/insituumaps` (`src/state/store.ts`, exported as `useAppStore`). It holds the InSituPy selection (sample, cell layer, colouring, ...) and computes a `ViewerModel` from it. Note the name clash: in plugin code, call the app's store `tmAppStore` and the fork's store `insitupyStore`.
- **Bridge**: new code (this spec) that copies the fork store's `ViewerModel` into the app's project store.
- **Importer** and **perspective**: as defined in the design doc, section 3.2.

## 2. Environment for the implementation session

What a cloud session needs, found while checking the environment on 2026-11-03:

1. **Node 24.** The default `node` is 22. Run `export PATH=/opt/node24/bin:$PATH` in every shell. pnpm comes from corepack (`pnpm -v` gives 12.8.1).
2. **Blocked git dependencies.** `pnpm install` fails with HTTP 403 from `codeload.github.com` for `TissUUmaps/zarrita.js` and `TissUUmaps/GeoTIFFTileSource`. `git clone` of both works. Workaround, local only, never committed:
   - Clone both at the commits pinned in `pnpm-lock.yaml`.
   - In `zarrita.js`: `pnpm install --ignore-scripts`, then `pnpm exec tsc --build` and `pnpm pack` in `packages/@zarrita-storage`. Packing applies its `publishConfig`, which points the exports at `dist`; without it, TypeScript type-checks the raw sources and the storage build fails.
   - Append an `overrides` block to `pnpm-workspace.yaml` that maps `@zarrita/storage` to the packed `.tgz` and `geotiff-tilesource` to the clone (its `dist` is committed), then run `pnpm install --no-frozen-lockfile`.
   - Leave the modified `pnpm-lock.yaml` and `pnpm-workspace.yaml` unstaged: every `pnpm run` reinstalls first and fails again if they are reverted. Stage files by path only, never with `git add -A`.
3. **Build** with `pnpm -r --workspace-concurrency=1 build`. In parallel, the render package build was killed for lack of memory.
4. **Fixture.** It needs Python with `numpy zarr h5py scipy pyarrow anndata`. Create a venv, set `INSITUUMAPS_PYTHON` to its `python`, then run `pnpm --filter insituumaps fixture`.
5. **Servers**:
   - `pnpm --filter tissuumaps exec vite --port 5173 --strictPort` serves the TissUUmaps app, which is the host for the plugin.
   - `pnpm --filter insituumaps dev:fixture` serves the fixture data on :8787 (CORS enabled) and the standalone InSitUUmaps app on :5174.
6. **Browser.** The Playwright Chromium has WebGL 2 through SwiftShader. Both apps rendered the fixture headlessly.

## 3. Design choices for the prototype

Each choice is the smallest one that tests the design doc's main assumption: the InSituPy view works as a presentation layer over the app's project store and data caches.

**C1. The plugin is a second build of `apps/insituumaps`, not a new package.** All plugin-only code goes into `src/plugin/`. The standalone app keeps working from the same sources, so the smoke tests stay a reference. (Python comparison: one package with two entry points, a CLI and a library.)

**C2. The fork store stays as it is, and a bridge copies its output.** The fork store already rebuilds a complete `ViewerModel` whenever the selection changes (`store.ts:199-237`). The bridge watches two values:

- `projectInstanceId` changes (another sample was opened): replace the whole app project in one `projectStore.setState` call, with a fresh `instanceId` (so that the viewer resets its view) and `source: null`.
- `model` changes and the instance is the same: replace only the objects the plugin owns.

In napari terms, the sidebar no longer draws its own canvas; it adds and updates layers in `viewer.layers`.

**C3. Ownership by id.** The plugin owns every object whose id it assigns in `model.ts`:

- the layer `sample`;
- the tables `cells` and `nuclei`;
- the labels `mask` and `mask-outlines:*`;
- the images `image:*`;
- the points `transcripts:*`;
- the shapes `overlay:*`;
- the maps `categories` and `category-visibility`.

Objects the user adds in the generic panels survive a rebuild, and objects the plugin owns come back if the user deletes them (design doc section 4.3). This is a pure function, `mergeOwned`, with a unit test.

**C4. Data providers are registered in `setup`, and they delegate to the fork store.** The app already registers providers for ome-zarr, zarr, parquet and geojson. The plugin adds three:

- `insituumaps-grayscale`: the one-channel wrapper (`viewer/grayscaleImage.ts`); a plain registration.
- `insituumaps-transcripts`: the provider instance depends on the open sample (`store.ts:432-440`). Register one small delegating provider that forwards to the current sample's provider.
- `insituumaps-virtual-table`: the nucleus table is built in memory (`store.ts:358`). The delegating provider forwards to `insitupyStore.getState().loaders`. Its data source must name the sample and the cell layer (today it is the fixed string `nuclei`), because the app's cache keys entries by data source (`code-architecture.md` "Data caches"); with the fixed string it would return the previous sample's table.

**C5. Transcripts load for the whole sample.** A plugin cannot read the viewer's viewport, so the per-viewport tile loading of the fork (`ViewerPanel.tsx:75-113`) has no input. The bridge sets the fork store's region once per sample to the sample's full extent. This is fine for the fixture (1.2 × 1.2 mm). On the full dataset, keep the number of genes small for the demo, or accept the loading time.

**C6. Own CSS, injected by `mount`.** The app's Tailwind build only contains the classes the app uses. The plugin imports its stylesheet as a string (`?inline`) and adds a `<style>` element when mounted. The stylesheet contains Tailwind's theme and utilities and the fork's tokens, but not Tailwind's preflight (the CSS reset), which the app already applies. The plugin root sets its own light background and text colour, because the fork UI has no dark theme.

**C7. Not carried over into plugin mode:** the fork's header bar, the scale bar and click-to-inspect (both need the viewer, see out of scope), and the fork's `ViewerPanel`. The app's own home button stays.

**C8. Generic app changes stay apart from plugin work.** Every change under `packages/` or `apps/tissuumaps/` is its own commit, with a changeset and nothing from `apps/insituumaps`. Those commits can later be cherry-picked onto a branch from `upstream/main` in `jwrth/TissUUmaps` without editing. Plugin commits only touch `apps/insituumaps/` (and this spec).

## 4. Building and loading the plugin

### Build

- New `apps/insituumaps/vite.plugin.config.ts`, based on `vite.config.ts`:
  - library mode: `build.lib = { entry: "src/plugin/index.ts", formats: ["es"], fileName: () => "insitupy-plugin.js" }`;
  - `build.outDir = "dist-plugin"`;
  - everything inlined into one file (no code splitting, `build.assetsInlineLimit` high enough for assets);
  - `define: { "process.env.NODE_ENV": JSON.stringify(mode) }`.

  One file is required: "Load plugin from file" cannot resolve relative imports (`plugins.md`, "Loading plugins from the plugins menu").

- React, Zustand, immer and the `@tissuumaps/*` packages are bundled into the plugin. The app's copies are not shared. This is allowed: a plugin gets only the stores (`types/plugins.ts:9-14`). The project store is typed through `@tissuumaps/core` types, which are the same source in this monorepo.
- New scripts in `apps/insituumaps/package.json`:
  - `"build:plugin": "vite build -c vite.plugin.config.ts"`;
  - `"dev:plugin": "node scripts/dev-plugin.mjs"`, which runs `vite build -c vite.plugin.config.ts --watch` and serves `dist-plugin/` with the existing `scripts/serve-data.mjs` on port 8788 (it already sends `Access-Control-Allow-Origin: *`).
- Add `dist-plugin/` to the app's `.gitignore`.

### Load

1. Start the servers (section 2, step 5) and `pnpm --filter insituumaps dev:plugin`.
2. Open `http://localhost:5173/` (optionally with `?source=http://localhost:8787/fixture/data-000/`).
3. Open the plugins menu (the vertical dots in the tab bar), choose **Load plugin from URL…**, enter `http://localhost:8788/insitupy-plugin.js` and confirm. The app loads the module and opens its panel ("InSituPy").
4. The browser caches modules by URL: after a rebuild, reload the page, or load `...insitupy-plugin.js?v=2`.

The module also registers itself when included as `<script type="module">`, following the pattern in `plugins.md` (default export plus `window.tissuumaps.registerPlugin`). The headless smoke test uses this path.

### Headless check

New `apps/insituumaps/scripts/smoke-plugin.mjs`, built on the existing `scripts/browser.mjs` (DevTools protocol, decision D14). It:

1. opens the TissUUmaps dev URL with `?source=`;
2. adds the plugin as a module script and calls `window.tissuumaps.mountPlugin("insitupy")`;
3. waits until the viewer has drawn;
4. checks the state through a debug handle and saves screenshots to `test-data/smoke-plugin/`.

The debug handle is set only in development builds: `window.__insitupyPlugin = { insitupyStore, stores }`. New script `"smoke:plugin"`.

## 5. Milestone 1a: Sample, Cell layer, Colour cells by

Goal: on the fixture, the InSituPy panel in the stock app opens a sample, switches the cell layer and colours cells by a gene or a cell property, with the app's own viewer drawing the result.

Tasks in order:

| #    | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Files                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1a.1 | Plugin build and an empty plugin: default export `{ id: "insitupy", name: "InSituPy", setup, mount }`, self-registration, `mount` that injects the CSS and renders a React root with a placeholder text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | new `apps/insituumaps/vite.plugin.config.ts`, `src/plugin/index.ts`, `src/plugin/plugin.css`, `scripts/dev-plugin.mjs`; change `package.json`, `.gitignore`  |
| 1a.2 | `mergeOwned(current, next, isOwned)`: for each collection, keep the user's objects in place, replace the owned ones by the next model's, append new owned ones; unit test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | new `src/plugin/mergeOwned.ts`, `src/plugin/mergeOwned.test.ts`                                                                                              |
| 1a.3 | Bridge: subscribe to the fork store. On a new `projectInstanceId`, write a full project built with `createProject` from `@tissuumaps/core` (name = sample name, the model's collections, the standalone app's background colour) with a fresh `instanceId`. On a new `model` (same instance), merge with `mergeOwned`. Remember the last `instanceId` the bridge wrote: if the project store gets another one that the bridge did not write (the user closed the project or opened a `.tm4`), call the fork store's `closeSource()` so that the panel returns to its start screen. For local folders, call `tmAppStore.getState().setWorkspace(handle)` before writing, because folder sources are workspace paths (`insitupy/source.ts:8-9`) | new `src/plugin/bridge.ts`                                                                                                                                   |
| 1a.4 | Providers (C4): register the grayscale provider, the delegating transcript provider and the delegating virtual table provider in `setup`; return a teardown that stops the bridge. Make the virtual table source sample-specific                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | new `src/plugin/providers.ts`; change `src/viewer/model.ts` (virtual table source), `src/state/store.ts` (registration key)                                  |
| 1a.5 | Panel UI: export the section components of `Sidebar.tsx` (today file-local functions) and compose a `PluginRoot`: the start screen while nothing is open, else the Sample, Cell layer and Colour cells by sections (the legend is part of the colour section), plus the sample browser dialog, the notices and a small "Close dataset" button. Adapt widths to the panel (about 420 px)                                                                                                                                                                                                                                                                                                                                                       | new `src/plugin/PluginRoot.tsx`; change `src/ui/Sidebar.tsx` (exports only), possibly `src/ui/StartScreen.tsx` (no full-height layout when inside the panel) |
| 1a.6 | `?source=` entry: in `setup`, read `readStateFromUrl()`; if it has a `source`, call `openUrl` and mount the panel with `window.tissuumaps?.mountPlugin("insitupy")` in a microtask (after registration has finished). The fork's URL writing (`state/url.ts:53-84`) only touches its own parameters, and the app only writes `project`, so both can share the address bar                                                                                                                                                                                                                                                                                                                                                                     | change `src/plugin/index.ts`                                                                                                                                 |
| 1a.7 | Headless smoke for 1a                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | new `scripts/smoke-plugin.mjs`; change `package.json`                                                                                                        |

Done when, on `http://localhost:5173/?source=http://localhost:8787/fixture/data-000/` with the plugin loaded, screenshots show:

1. The InSituPy tab is active, with the Sample, Cell layer and Colour cells by sections. The viewer shows the H&E image with cells filled by the colour of gene EPCAM (expression source `counts`), and the numeric legend shows a colour bar with its range.
2. After choosing **Cell property** and `leiden`: categorical colours and a categorical legend with one toggle per category. Hiding one category removes its cells from the viewer.
3. After switching to the `main-copy` cell layer: the viewer still shows coloured cells, and the cell layer control shows `main-copy`.
4. The generic **Labels** tab lists `mask` and `mask-outlines:cells`, and **Tables** lists `cells`. Switching back to the InSituPy tab keeps the selection.
5. On `?source=http://localhost:8787/fixture/` (the experiment), the sample table appears; opening `data-001` replaces the image, and the view fits the new sample.
6. `pnpm --filter insituumaps test` (including `mergeOwned.test.ts`) and `smoke:plugin` pass. The standalone `smoke` still passes.

## 6. Milestone 1b: the remaining five sections

| #    | Task                                                                                                                                                                                                                                                                                       | Files                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| 1b.1 | Add the Outlines, Images, Transcripts, Annotations and regions, and Data notes sections to `PluginRoot`, in the order of the standalone sidebar                                                                                                                                            | change `src/plugin/PluginRoot.tsx` |
| 1b.2 | Transcript region (C5): after each new sample, set the fork store's viewport to the full sample extent. The extent comes from the transcript index metadata (tile size and tile count) or from the largest image's size and pixel size; pick whichever the store already has at that point | change `src/plugin/bridge.ts`      |
| 1b.3 | Check that the grayscale wrapper and the outline render mode draw in the app's viewer. Both depend on the fork's core changes, which `apps/tissuumaps` in this fork already contains                                                                                                       | none, unless a bug appears         |
| 1b.4 | Extend the smoke test to the 1b steps of the standalone smoke (outlines on nuclei, a gene in Transcripts, an overlay)                                                                                                                                                                      | change `scripts/smoke-plugin.mjs`  |

Done when screenshots of `data-000` show:

1. Outlines on nuclei (black lines) over the cell fill.
2. The DAPI image switched on (shown in grayscale) and the H&E opacity lowered.
3. Two transcript genes as coloured points over the whole sample, each with its own colour.
4. Annotations or regions drawn as shapes. Data notes lists the fixture's notes (if any).
5. The generic **Points** tab lists `transcripts:<gene>` for both genes.
6. `smoke:plugin` passes with the 1b steps.

## 7. Step 2: importer registry, `source` parameter, perspective hook

Step 2 moves the entry from the plugin into the app. The first two tasks are generic app changes, in their own commits with changesets. The third is plugin work.

### 2.1 `feat(core,app): open datasets through project importers` (generic)

| Change                                                                                                                                                                                                                                                                                                                                                                                         | Files                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `ProjectImporter` type: `{ id; name; supports(normalizedSource, workspace, options?): Promise<boolean>; open(normalizedSource, workspace, options?): Promise<RawProject> }`, with TSDoc in the style of `DataProvider.supports` (`storage/base.ts:181-199`); export it                                                                                                                         | new `packages/@tissuumaps-core/src/storage/importer.ts`; change `packages/@tissuumaps-core/src/index.ts`    |
| App store state `projectImporters: Map<string, ProjectImporter>`, `projectImporterId: string \| null` (the importer that opened the open project), action `registerProjectImporter(importer)`                                                                                                                                                                                                  | change `packages/@tissuumaps-core/src/types/stores/app.ts`, `apps/tissuumaps/src/stores/app.ts`             |
| `loadDatasetFromSource(source, options?)`: normalise with `SourceUtils.normalizeSource`, ask all importers in parallel (rejection counts as `false`, as in `AddDataObjectDialog/hooks.ts:144-160`), open with the first that says yes, `createProject` the result and load it with `loadProject(project, normalizedSource)`, then set `projectImporterId`. Returns whether an importer matched | new `apps/tissuumaps/src/data/io/dataset.ts`, `dataset.test.ts` (importer selection)                        |
| Startup: a `source` GET parameter beside `project`. If no importer matches yet, keep the source **pending** and try again each time an importer is registered, until the user opens something else. Reason: a plugin loaded from the menu registers its importer after startup                                                                                                                 | change `apps/tissuumaps/src/bootstrap.ts`                                                                   |
| "Open dataset…" in the welcome view: asks for a URL (same dialog as "From URL…") and calls `loadDatasetFromSource`                                                                                                                                                                                                                                                                             | change `apps/tissuumaps/src/components/panels/ProjectPanel/ProjectWelcomeView.tsx`, `ProjectPanel/hooks.ts` |
| Docs: a short "Project importers" section; one paragraph on opening datasets                                                                                                                                                                                                                                                                                                                   | change `docs/development/plugins.md`, `docs/concepts/projects.md`                                           |
| Changeset: `@tissuumaps/core` minor, `tissuumaps` minor                                                                                                                                                                                                                                                                                                                                        | new `.changeset/*.md`                                                                                       |

### 2.2 `feat(core,app): let a plugin act as a perspective` (generic)

Prototype shape: a perspective is a plugin with a `perspective` field, and its one panel is the perspective panel. This is the narrowest version of the design doc's PR 3 and needs no change to how panels are mounted.

| Change                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Files                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `Plugin.perspective?: { appliesTo: string[]; hiddenPanels: string[] }` (importer ids it fits, built-in panel ids it hides)                                                                                                                                                                                                                                                                                                                                         | change `packages/@tissuumaps-core/src/types/plugins.ts`                                                                           |
| App store: `plugins` entries carry the plain `perspective` data (the registry copies it in, `plugins.ts:86-91`); new `activePerspectiveId: string \| null` and `setActivePerspectiveId`                                                                                                                                                                                                                                                                            | change `packages/@tissuumaps-core/src/types/stores/app.ts`, `apps/tissuumaps/src/stores/app.ts`, `apps/tissuumaps/src/plugins.ts` |
| Selection: `startSelectingPerspective()` in `bootstrap.ts`, modelled on `startCollapsingOnProjectSwitch` (`bootstrap.ts:74-86`). On a new `instanceId`, and when a plugin registers: use `?perspective=<plugin id>` if set; else the single registered perspective whose `appliesTo` contains `projectImporterId`; else none. Activating mounts the plugin (`pluginRegistry.mountPlugin`). Unregistering the active perspective's plugin deactivates it            | change `apps/tissuumaps/src/bootstrap.ts`                                                                                         |
| Panel hook: `usePerspectivePanels(dockviewApi)`, modelled on `usePluginPanels.ts:25-69`. When a perspective is active, it removes the hidden built-in panels and activates the plugin's panel. When none is active, it adds them back in their original order into the Project panel's group. Move the built-in panel definitions out of `onDockviewReady` into one list, so that both use the same definitions. Keep `activePanelId` valid (`useActivePanelSync`) | new `apps/tissuumaps/src/hooks/usePerspectivePanels.ts`; change `apps/tissuumaps/src/App.tsx`, possibly `panels.ts`               |
| Switch menu: next to the plugins menu (`App.tsx:145-161`), shown when at least one perspective is registered: "Generic" plus each perspective, the active one checked. "Generic" deactivates (and unmounts the plugin panel); choosing a perspective activates it                                                                                                                                                                                                  | new `apps/tissuumaps/src/components/app/PerspectiveMenu/index.tsx`; change `App.tsx`                                              |
| Docs: a short "Perspectives (experimental)" section                                                                                                                                                                                                                                                                                                                                                                                                                | change `docs/development/plugins.md`                                                                                              |
| Changeset: `@tissuumaps/core` minor, `tissuumaps` minor                                                                                                                                                                                                                                                                                                                                                                                                            | new `.changeset/*.md`                                                                                                             |

### 2.3 `feat(insituumaps): register the InSituPy importer and perspective` (plugin)

| Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Files                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Importer `insitupy`. `supports(normalizedSource, workspace)`: for a URL, `exists(".ispy")` or `exists("metadata.parquet")` or `exists("metadata.csv")` through the fork's URL source (`insitupy/source.ts`); for a workspace path, the same through the directory source. `open(...)`: call the fork store's `openUrl` or `openDirectory`, wait until the project or the experiment is ready, then return the `RawProject` of the current model (for an experiment: only the `sample` layer, and the sample table opens in the panel) | new `src/plugin/importer.ts`      |
| Bridge: when the app loads the project returned by `open` with its own fresh `instanceId`, the bridge adopts that id instead of treating it as "the user opened something else"                                                                                                                                                                                                                                                                                                                                                       | change `src/plugin/bridge.ts`     |
| Plugin: `perspective: { appliesTo: ["insitupy"], hiddenPanels: ["images", "labels", "points", "shapes", "tables"] }`. Register the importer in `setup` only if `registerProjectImporter` exists, so that the same file still loads into an app without step 2                                                                                                                                                                                                                                                                         | change `src/plugin/index.ts`      |
| Smoke test for step 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | change `scripts/smoke-plugin.mjs` |

Done when:

1. A fresh load of `http://localhost:5173/?source=http://localhost:8787/fixture/data-000/` shows the welcome view (no importer yet). After **Load plugin from URL…**, the sample opens by itself (H&E with cells), the Images, Labels, Points, Shapes and Tables tabs are gone, the InSituPy tab is active, and the perspective menu shows "InSituPy" checked. One screenshot.
2. In the perspective menu, **Generic**: the six built-in tabs are back and the Labels tab lists `mask` and `mask-outlines:cells`. **InSituPy** again: the sidebar shows the same selection as before. Two screenshots.
3. In a fresh page with the plugin loaded, **Open dataset…** in the welcome view with `http://localhost:8787/fixture/` opens the sample table. One screenshot.
4. `?perspective=` with a missing id falls back to generic, without an error.
5. `pnpm typecheck`, `pnpm lint`, `pnpm fmt:check`, `pnpm exec vitest run apps/tissuumaps/src/data/io/dataset.test.ts` and `smoke:plugin` pass.

## 8. Commit plan

The order of commits on the branch. G = generic (cherry-pick candidate for upstream), P = plugin, D = docs of the fork.

1. D `docs: add the perspective prototype design doc` (done)
2. D `docs: add the perspective prototype implementation spec` (this file)
3. P `build(insituumaps): build the viewer as a TissUUmaps plugin` (1a.1)
4. P `feat(insituumaps): write the InSituPy model into the project store` (1a.2 to 1a.4)
5. P `feat(insituumaps): show sample, cell layer and colouring in the plugin panel` (1a.5, 1a.6)
6. P `test(insituumaps): headless smoke test for the plugin` (1a.7)
7. P `feat(insituumaps): add the remaining sidebar sections to the plugin` (1b)
8. G `feat(core,app): open datasets through project importers` (2.1)
9. G `feat(core,app): let a plugin act as a perspective` (2.2)
10. P `feat(insituumaps): register the InSituPy importer and perspective` (2.3)

Rules:

- G commits touch only `packages/`, `apps/tissuumaps/`, `docs/development/`, `docs/concepts/` and `.changeset/`. They never touch `apps/insituumaps/`, `CLAUDE.md`, `planning/` or the `docs/perspective-prototype*` files.
- P commits touch only `apps/insituumaps/`. The `insituumaps` app is private, but CI asks for a changeset for every changed application, so add one per P commit that changes it (`.changeset/`, `insituumaps` patch or minor).
- Conventional commit messages, as in the rest of the repo.
- Never stage `pnpm-lock.yaml` or `pnpm-workspace.yaml` while the install workaround (section 2) is in place.

## 9. Risks and open points

Found while reading the code. Each states what to check first.

1. **The fork is 3 commits behind upstream `main`** (#385 docs and conventions, #312 viewer toolbar, #387 points shader). The G commits do not touch the files these change, except `docs/development/*`, so cherry-picks should apply. Docs conflicts are possible. Merge `upstream/main` into the fork before step 2, or accept conflicts at cherry-pick time (a decision for Johannes).
2. **Outline rendering needs the fork's core changes.** The demo must run on the fork's `apps/tissuumaps`, not on upstream's, until upstream PR 0 of the design doc lands.
3. **Data loaded twice.** The fork store keeps its own `ViewerDataLoaders` for legends, percentiles and the sample table, while the app's caches load the same sources for drawing. Acceptable for the fixture. On the full dataset, watch memory and load time; the fix later is to read through the app's `dataStore` instead.
4. **Shared data closed by the wrong owner.** The delegating virtual table provider hands the app the same table instance the fork's loader caches. When the app unloads it, the app calls `close()` on it (`code-architecture.md` "Data caches"). Return a wrapper whose `close()` does nothing.
5. **Stale cache entries for virtual sources** (C4). Any data source whose meaning changes with the sample must carry the sample and the cell layer in its `source` string.
6. **Frozen objects.** The app freezes the project deeply (`data/io/project.ts:61-75`). If the bridge passes the fork model's objects by reference, they become read-only for the fork store too. The fork rebuilds new objects on every change, so this should be fine. If something throws "Cannot assign to read only property", pass copies.
7. **Viewport reset.** The viewer fits the view when `instanceId` changes. A sample switch must therefore write a new `instanceId` (C2). Check early that the view also fits when the images arrive after the instance change.
8. **Dockview surgery (step 2).** Removing and re-adding built-in panels is new. Order, group, width (`initialWidth: 420`) and the active panel need care. Prototype the panel hook before polishing the menu.
9. **Startup race (step 2).** A plugin loaded from the menu registers after startup. The pending `source` (2.1) covers this. A plugin included in the page also registers after `tissuumaps-loaded`, which fires after the initial load has started, so the pending source is needed there too.
10. **Importer and bridge both load the project** (2.3). The importer opens the sample in the fork store, which may already make the bridge write it once before the app loads the returned project. The view resets twice. This is acceptable for the prototype; the clean fix is for the plugin to stop writing while an importer `open` is running.
11. **CSS.** Two Tailwind builds on one page; the plugin's stylesheet has no CSS reset. Check the dialogs (the sample browser is drawn on top of the page) and z-index against Dockview. In dark mode the plugin panel stays light.
12. **Bundle size.** The plugin bundles React and the storage package with its inlined workers. Measure `dist-plugin/insitupy-plugin.js`. Several MB is acceptable for the prototype.
13. **Module caching** when reloading the same plugin URL (section 4). A `?v=` query or a page reload.
14. **Local folders and the app's workspace.** Setting the workspace from the plugin changes the app's welcome text and the workspace widget. That is acceptable and even correct (the folder is open), but it differs from the standalone app.
15. **Transcripts on the full dataset** (C5): no viewport-driven loading. Pick a few genes for the demo.
16. **Lost features in plugin mode:** scale bar and click-to-inspect (C7). Mention them in the demo as known gaps that need viewer hooks.
17. **Open point.** In 1b.2, which extent the bridge uses (transcript index or image size) is left to the implementer.

## 10. Out of scope

- Quick settings (#390), and any change to `TableData` or the table providers.
- Declarative sections and JSON perspectives (design doc sections 5 and 6), including `terms` and `defaults`.
- Presets (#341).
- Viewer hooks for plugins: viewer click events (click-to-inspect), plugin viewer controls (scale bar, legend in the viewer), viewport access.
- Upstream PRs, the issue text (design doc section 11) and the cherry-picks onto `upstream/main`. The prototype only keeps them possible (section 8).
- The SpatialData importer and InSituPy's SpatialData dialect.
- A user preference for the perspective in the settings store, asking when several perspectives apply, dataset-shipped perspectives, and more than one panel per perspective.
- Dark mode for the plugin UI, and tests for GUI components and glue code (not required by the conventions).
- Removing the standalone `apps/insituumaps` app.

## 11. Corrections to the design doc

Found by checking the doc's references against fork `da0165c` and upstream `67de073` (still upstream `main` on 2026-11-03). These should be folded into the living doc.

1. Section 2.1: "a plugin cannot … be mounted automatically" no longer holds. `window.tissuumaps.mountPlugin(id)` is public (`plugins.md`, "Panel lifetime"), and loading from the menu mounts the plugin right away.
2. Section 2.1: `docs/development/code-architecture.md` line numbers hold upstream, but in the fork they are 2 lower after line 120 (143 becomes 141, 159 becomes 157, 226 becomes 224). The fork also has older wordings of `coding-conventions.md:18` and of the changeset rule in `development-workflow.md`, because it lacks upstream #385.
3. Sections 2.3 and 3.4: `Sidebar.tsx` "Colour cells by" spans lines 135-392 (not 135-300); the file has 860 lines (the sections run 48-860, not 48-818).
4. Sections 7.3 and 9: the home button is merged (#289; the fork has `HomeViewerControl`, upstream groups it into a toolbar since #312). Only the scale bar and the colour bar are still on branches (`feat/viewer-scale-bar`, `feat/colorbar-viewer-control`).
5. Section 7.3: the fork has no `useData`. The glue is `ViewerDataLoaders` (`src/viewer/loaders.ts`) and `src/ui/ViewerPanel.tsx`. Of the fork's providers, ome-zarr, zarr, parquet and geojson are already registered by the app; only the grayscale wrapper, the transcript provider and the in-memory nucleus table need registering.
6. Section 7.3: the nucleus table is not a provider but an in-memory closure under a fixed id (`store.ts:358`). As a provider it needs a sample-specific data source (C4).
7. Section 7.3 and 12: transcript loading per viewport depends on the fork's viewer reporting the viewport (`ViewerPanel.tsx:75-113`), which a plugin cannot get today. Not mentioned in the doc.
8. Section 12: plugins have no `loadProject`. A plugin loads a project by setting the project store with a fresh `instanceId`. Folder sources need the app's workspace set to the folder (`setWorkspace`).
9. Section 12.1: checked. The app keeps unknown URL parameters: it only reads and writes `project` (`bootstrap.ts:96-108`, `data/io/project.ts:292-305`). With `?source=` and no `?project=`, it also tries `project.tm4` and logs a harmless 404.
10. Not checked in this session: the InSituPy references (`insitupy/...`) and issues #341 and #390, because neither repository was reachable from the session.

## 12. Implementation notes (as built)

Where milestone 1a differs from the plan above, and what was learned:

1. **No separate Vite config.** The plugin is built by `vite.config.ts` in a `plugin` mode (`vite build --mode plugin`), because a second config file would have needed changes to the root ESLint and TypeScript setup. `build:plugin` and `dev:plugin` work as described in section 4.
2. **Order of merged objects.** `mergeOwned` lists the plugin's objects in the model's order, followed by the user's objects in their current order, so the user's objects are drawn on top. Keeping user objects at their exact positions would have made the order of the plugin's own objects depend on history.
3. **Debug handle.** `window.insitupyPlugin` (`{ insitupyStore, stores }`) is always set, not only in development builds, because the plugin is always built in production mode. The smoke test reads it.
4. **Commits.** Tasks 1a.2 to 1a.6 are one commit, because they all wire into `src/plugin/index.tsx`.
5. **Store types.** `PluginStores` only type-checks in `apps/insituumaps` with the zustand immer type augmentation loaded (`src/plugin/stores.d.ts`).
6. **CSS.** The plugin's root rules sit in Tailwind's base layer, so that utilities such as `bg-transparent` on the full-window overlays win over the root's white background.
7. **Overlays.** The sample browser and the notices are portalled to the document body, so they cover the window rather than the narrow panel.
8. **Bundle size.** `dist-plugin/insitupy-plugin.js` is about 3.2 MB (1.0 MB gzipped), most of it the storage package.
9. **Checks (1a).** `smoke:plugin` passed all 28 checks on the fixture: the experiment's sample browser, both samples drawn by the app's viewer, gene and categorical colouring with legends, category hiding, the cell layer switch, user objects surviving a rebuild, the generic Labels panel listing the plugin's objects, and the plugin returning to its start screen when the app's project is replaced. The standalone `smoke` still passes.

Milestone 1b:

10. **Transcript region (1b.2).** The extent is the largest image's size times its pixel size (`sampleExtent` in `bridge.ts`), with a large square as the fallback. The bridge reports it as the viewport once per sample; the fork store then snaps it to the transcript tiles, one tile of margin included.
11. **Grayscale and outlines (1b.3).** Both work in the app's viewer without changes: the DAPI image is drawn through the plugin's grayscale provider, and nucleus outlines through the fork's outline render mode.
12. **Overlays.** The fixture has no annotations or regions. The overlay checks run when `scripts/add_demo_annotations.py` has been run on `test-data/fixture/data-000` (decision D17), and are skipped otherwise.
13. **App race, found by the smoke test.** Clearing the app's project while the viewer still recolours tiles logs "Failed to transfer tile data: Data has been destroyed": the viewer recolours tiles of removed images after the data cache destroyed their data. It is the app's own cleanup (`OpenSeadragonContext` tile-invalidated handler and `data/cache/wrappers`), not the plugin's, and only logs. The smoke test waits for the recolouring before clearing. Candidate for an upstream issue after checking it with a plain `.tm4` project.
14. **Checks (1b).** `smoke:plugin` adds 14 checks: nucleus outlines, the grayscale image and an image opacity, two transcript genes loaded for the whole sample, overlays, the new sections in the panel, and the transcript genes carried over to the second sample.
15. **Smoke test stability.** Against the app's dev server, the plugin smoke test failed at random points: the Vite dev client forwards the page's console to the dev server, a message once exceeded its WebSocket payload limit ("Max payload size exceeded" in the server log, at the same second as the failure), and the dev client then reloads the page, which drops the plugin. In the smoke test's own headless browser, the page also crashed now and then, which used to hang the test. `browser.mjs` now fails the test when the page crashes, and the smoke test runs against a production build of the app (`vite preview` on port 5175), where it passes all 47 checks. It also switches back to the main cell layer before step 5b, so that the headless renderer holds one cell layer at a time.

Step 2:

16. **Importer ID in the project store (2.1).** The ID of the importer that built the open project is `importerId` in the project store's state, next to `source` and `instanceId`, not in the app store: every other way of loading a project (`loadProject`, `clear`) resets it, and a plugin replacing its own objects keeps it.
17. **URL parameters (2.1).** `project` wins over `source` when both are given; with `source` alone, `project.tm4` is no longer tried. `setProjectURLParam` and `clearProjectURLParam` also remove `source`, and opening a dataset removes `project`.
18. **"Open dataset from URL…" (2.1)** is only shown once an importer is registered. A dataset no importer recognises gets an alert ("Dataset not recognized").
19. **Perspective shape (2.2).** `Plugin.perspective = { appliesTo, hiddenPanels }`; the plugin's one panel is the perspective panel, and only plugins with a `mount` can have one. Selection runs on every new project instance and whenever the set of registered perspectives changes (not when a plugin is merely mounted, so that a manual switch to "Generic" stays). Closing the perspective's tab also switches to generic, so that the built-in panels never stay hidden without a perspective panel.
20. **Folders (2.3).** The InSituPy importer only supports URLs. Folders on the user's computer are opened from the plugin's start screen, as in step 1.
21. **Double write (2.3, risk 10).** Opening through the importer writes the project twice: once by the bridge while the fork store opens it, once by the app with the importer's result. The bridge adopts the second instance (same `importerId`, a source is open), so the plugin keeps its state; the view is fitted twice.
22. **Checks (step 2).** In a fresh page with `?source=` naming the fixture, loading the plugin from the plugins menu opens the sample by itself, with the generic data tabs hidden and the InSituPy tab active; "Generic" in the perspective menu shows them again and lists the plugin's objects; switching back shows the same selection; "Open dataset from URL…" opens the experiment's sample browser, and an unknown URL gives an alert; `?perspective=` naming no plugin falls back to generic. `smoke:plugin` checks the perspective and the switch too. `dataset.test.ts` covers the choice of importer and `plugins.test.ts` the perspective bookkeeping of the registry.
23. **Transcript loads aborted for good (found in step 2 testing).** The fork's transcript index reader caches each gene's tile table as a promise made with the first caller's abort signal. The standalone app never passes signals to providers, but the app's data cache does: once it abandoned a transcript load, every later load of that gene failed with an `AbortError` that the cache keeps. The plugin's transcript provider now loads without the app's signal and only races it, as decision D15 does for other shared reads. The reader itself should get the same fix.
