# InSitUUmaps

A browser viewer for [InSituPy](https://github.com/SpatialPathology/insitupy) projects and
experiments, built on [TissUUmaps 4](https://github.com/TissUUmaps/TissUUmaps). It reads an
InSituPy project or experiment straight from its folder (over HTTPS with range requests, or
from a folder on your computer); nothing is installed, uploaded or converted into a
`project.tm4`.

The viewer follows the InSituPy data model: pick a **sample**, a **cell layer**
(segmentation), the **expression values** (`.X` or a layer such as `counts`), type a
**gene** (or pick a cell property), and see it on the **cell or nucleus outlines** over the
H&E or DAPI image. Transcripts of selected genes, annotations and regions are overlays.

## For users (no programming needed)

Open the link you were given. It looks like

```
https://<viewer>/?source=https://<data>/my-experiment/
```

and can carry the view: `&sample=3&layer=main&color=gene:EPCAM@counts&mask=nuclei`.
Copy the address bar at any time to share exactly what you see.

1. **Sample** (experiments only): the sample table opens first. Sort by clicking a column,
   filter with the box at the top right, then click _Open_. The _Browse_ button and the
   sample list at the top of the sidebar switch samples later; your colouring is kept.
2. **Cell layer**: `main` is selected; other segmentations (e.g. `proseg`) are one click away.
3. **Colour cells by**: _Gene_ (choose the expression values, then type a gene; the list
   suggests matches as you type, Enter selects), _Cell property_ (a column of the cell table:
   clusters, areas, counts) or _None_ (outlines only).
   - Numeric values get a colour bar. The range starts at the data minimum and, for genes,
     at the 99.5th percentile so that a few extreme cells do not wash out the rest; edit
     _Min_/_Max_ or press _Auto_. The palette can be changed.
   - Categories get a list with a colour and a cell count each; untick a category to hide
     it, _All_/_None_ toggle them all.
4. **Outlines**: _Colour on_ fills either the _Cells_ or the _Nuclei_ with the values (nuclei
   show the value of their cell), with an opacity slider. Thin neutral outlines on top keep
   neighbouring cells apart: _Outline_ draws them on the cells, the nuclei or _Both_ (nucleus
   outlines over the cell fill). The switch at the top hides them, and their width and
   opacity can be changed.
5. **Images**: show or hide H&E and the fluorescence channels, with opacity. A fluorescence
   channel also gets a colour and black/white levels (_Reset_ returns to the stored window).
6. **Transcripts**: add genes one by one (each gets its own colour). Only the genes you add
   and only the area you look at are loaded. When a gene has more points in view than the
   viewer draws, a `*` marks a subsample; zoom in to see every point.
7. **Annotations and regions**: switch each set on or off.
8. **Inspect a cell**: click a cell to see its name, the current gene value and all its
   properties. The scale bar sits at the bottom left; the house button shows the whole sample.

If something is missing in the data (no nucleus mask, no `counts` layer, no transcript
index), the control is disabled and _Data notes_ at the bottom of the sidebar says why.

### Opening a folder on your computer

Press _Open a folder on this computer_ on the start screen and pick the project folder
(the one with `.ispy`) or the experiment folder (with `metadata.parquet`). This needs a
Chromium-based browser (Chrome, Edge). Nothing leaves your computer.

## For developers

### Run on the test fixture

```bash
pnpm install
pnpm --filter insituumaps fixture        # downloads, unzips and converts the 2-sample fixture
pnpm --filter insituumaps dev:fixture    # data server (port 8787) + viewer (port 5174)
```

Then open <http://localhost:5174/?source=http://localhost:8787/fixture/>. The converter step
needs Python with `numpy zarr h5py scipy pyarrow anndata` (`pip install` them). Without it
the fixture still opens, with `.X` only and transcripts read from the Parquet file.

The scripts use the first Python that runs out of `INSITUUMAPS_PYTHON`, `python3`, `python`
and (on Windows) `py -3`. On Windows `python3` is often the Microsoft Store stub, so point
`INSITUUMAPS_PYTHON` at the environment with these packages, e.g.
`$env:INSITUUMAPS_PYTHON = "C:\path\to\env\python.exe"`. Unzipping falls back to Python's
`zipfile` when there is no `unzip`.

Point the dev server at other data with `pnpm --filter insituumaps dev` and a `?source=` URL
(the server must allow cross-origin requests and support HTTP range requests; see
`scripts/serve-data.mjs` for a minimal one: `pnpm --filter insituumaps serve:data <folder>`).

### Build

```bash
pnpm build:packages                     # the TissUUmaps packages the app resolves to in production
pnpm --filter insituumaps build          # apps/insituumaps/dist, works from any static host
pnpm --filter insituumaps preview        # serves dist locally
```

(`pnpm build` at the root builds everything in order.)

The build uses relative asset paths, so `dist/` can live at any path on any static host.
Add `?source=<folder url>` to its URL, or host a redirect that fills it in.

### TissUUmaps plugin (prototype)

The same sources also build as a TissUUmaps plugin, which shows the sidebar in a panel of the
TissUUmaps app and lets the app's viewer draw the sample. With the project importer and
perspective hooks of this branch, the app opens InSituPy datasets itself and swaps its generic
panels for the InSituPy panel. Design and status: `docs/perspective-prototype.md` and
`docs/perspective-prototype-spec.md` at the repository root.

#### Setup

Requirements: Node 24 or newer (check `node -v`), pnpm through Corepack, Python with
`numpy zarr h5py scipy pyarrow anndata` (see the Python lookup above), and Chrome or Edge,
which are needed to open a folder on your computer.

```bash
pnpm install
pnpm build:packages                      # the plugin resolves the packages to their build output
pnpm --filter insituumaps fixture        # the 2-sample fixture
```

Optional: demo annotations and regions on the first sample (test data only, decision D17), so
that "Annotations and regions" has something to show:

```bash
python3 scripts/add_demo_annotations.py test-data/fixture/data-000
```

Then start three servers, each in its own terminal:

```bash
pnpm --filter tissuumaps exec vite --port 5173 --strictPort  # the TissUUmaps app
pnpm --filter insituumaps dev:fixture                        # fixture data (8787), this app (5174)
pnpm --filter insituumaps dev:plugin                         # rebuilds and serves the plugin (8788)
```

The plugin is loaded in the TissUUmaps app from the plugins menu (the three dots at the right
of the tab bar): "Load plugin from URL…", `http://localhost:8788/insitupy-plugin.js`, and
confirm. `pnpm --filter insituumaps build:plugin` writes `dist-plugin/` once instead.

#### Test A: the plugin's start screen

1. Open <http://localhost:5173/> and load the plugin. An "InSituPy" tab opens with the start
   screen.
2. Enter `http://localhost:8787/fixture/` and click "Open"; the sample table covers the window.
   Open `data-000`.
3. Check: the H&E image with cell outlines; colour by Gene (`counts`, EPCAM) with a legend and
   editable Min/Max; colour by Cell property (`leiden`) with per-category boxes and counts;
   the `main-copy` cell layer; outlines on Nuclei; the `nuclei` image in grayscale; transcripts
   of EPCAM and CD3E as coloured points; annotations and regions (with the demo annotations);
   the Labels, Points and Tables tabs listing the plugin's objects; switching to `data-001` from
   the sample browser (grid button in the panel header), which fits the view to the new sample.

#### Test B: importer and perspective

1. Open <http://localhost:5173/?source=http://localhost:8787/fixture/data-000/> in a fresh tab.
   The welcome view stays: no importer is loaded yet.
2. Load the plugin.
3. Check: the sample opens by itself; only the Project and InSituPy tabs remain; a Perspective
   button (panel icon) appears left of the plugins menu. "Generic" there brings back the Images,
   Labels, Points, Shapes and Tables tabs, which show the plugin's objects; "InSituPy" returns
   with the same selection. Closing the InSituPy tab also switches to Generic, and
   `&perspective=nothing` in the URL opens the generic panels without an error.

#### Test C: "Open dataset from URL…"

1. Open <http://localhost:5173/>, load the plugin and click the Project tab. The welcome view
   now offers "Open dataset from URL…" (only once an importer is registered).
2. Enter `http://localhost:8787/fixture/`: the sample table opens in the InSituPy perspective.
3. Enter `http://localhost:8787/nothing/`: a "Dataset not recognized" dialog appears.

#### Test D: your own dataset

Run the converter on the dataset first (see "Prepare your own data" below; it adds files in
place, so use a copy if in doubt). Then either:

- **a folder on your computer** (not tested yet): load the plugin and click "Open a folder on
  this computer" on its start screen. Check that the sample appears, that the Project tab's
  footer shows the folder as connected, and that images, masks and transcripts load; or
- **over HTTP**, which also uses the importer: serve the folder that contains the dataset on a
  free port, e.g. `pnpm --filter insituumaps serve:data <parent-folder> --port 8789` (an
  absolute path, as the script runs in `apps/insituumaps`). Then open
  `http://localhost:5173/?source=http://localhost:8789/<dataset-folder>/` and load the plugin.

On a full slide, watch the loading time of transcripts: the plugin loads each gene for the
whole sample, and a gene with more than 2 million points is thinned evenly over the slide.

#### What is normal

- 404 errors in the console: Zarr probes for optional files, and `project.tm4` is looked for
  when `?source=` is given.
- The plugin is forgotten on reload; load it again. After a rebuild, reload the page or add
  `?v=2` to the plugin URL, since the browser caches modules.
- No scale bar and no click-to-inspect in the plugin: both need viewer hooks that plugins do not
  have yet. The plugin panel stays light in dark mode.
- "Failed to transfer tile data: Data has been destroyed" after quick sample or layer switches:
  the app's own cleanup race, harmless (see section 13 of the spec).

### Test

```bash
pnpm --filter insituumaps test           # vitest: data layer, transcript index, state
pnpm --filter insituumaps test:converter # python unittest of the converter on synthetic data
pnpm --filter insituumaps smoke          # headless Chromium end-to-end run on the fixture
pnpm --filter insituumaps smoke:local    # the same through the local-folder code path
pnpm --filter insituumaps smoke:plugin   # the plugin in the TissUUmaps app, see below
pnpm typecheck && pnpm lint             # whole monorepo
```

The smoke tests need the dev and data servers running (`dev:fixture`) and a Chromium with
WebGL 2; they use `INSITUUMAPS_CHROME` if set, else the Playwright Chromium or an installed
Chrome (Linux, macOS, Windows; Edge on Windows as a last resort). Screenshots land in
`test-data/smoke/`. `smoke:local` copies one sample into the browser's private file system
and opens it as a directory, which exercises the same code as a folder picked by the user.

`smoke:plugin` also needs `dev:plugin`, and is reliable only against a production build of the
TissUUmaps app: the dev server can reload the page during the run. With `dev:fixture` and
`dev:plugin` running:

```bash
pnpm build
pnpm --filter tissuumaps exec vite preview --port 5175 --strictPort
pnpm --filter insituumaps smoke:plugin -- --app http://localhost:5175/
```

Its screenshots land in `test-data/smoke-plugin/`.

### Prepare your own data

```bash
python3 scripts/convert_project.py <project-or-experiment-folder>
# or, with the Python lookup above:
node scripts/python.mjs scripts/convert_project.py <project-or-experiment-folder>
```

adds, in place and without touching what InSituPy wrote: the AnnData layers as CSC matrices
in the viewer table (expression sources besides `.X`), the transcript index
(`transcripts/insituumaps/`), and manifests for annotations and regions. See
`docs/insitupy-changes.md` for what InSituPy itself should write in the future.

### Structure

```
src/insitupy/      InSituPy-shaped interface (types) and the format v2 implementation (v2/)
src/viewer/        Mapping onto the TissUUmaps model, data loaders, picking
src/transcripts/   Transcript index reader, Parquet fallback, points provider
src/state/         Zustand store and URL state
src/ui/            React UI
scripts/           Fixture, data server, converter, smoke test
docs/              plan, decisions, ux, insitupy-changes, final-report
```

InSitUUmaps uses the TissUUmaps packages of this monorepo (`@tissuumaps/core`, `render`,
`storage`, `react`) and does not change `apps/tissuumaps`. Two small core changes support
it: isolated tile caches per tiled image (a cache bug fix) and an outline render mode for
labels; both have changesets.
