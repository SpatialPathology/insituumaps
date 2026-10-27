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
4. **Outlines**: fill the _cell boundaries_ or the _nucleus boundaries_ with the values
   (nuclei show the value of their cell), with an opacity slider. Thin neutral outlines on
   top keep neighbouring cells apart; the switch at the top hides them, and their width and
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
needs `python3` with `numpy zarr h5py scipy pyarrow anndata` (`pip install` them). Without it
the fixture still opens, with `.X` only and transcripts read from the Parquet file.

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

### Test

```bash
pnpm --filter insituumaps test           # vitest: data layer, transcript index, state
pnpm --filter insituumaps test:converter # python unittest of the converter on synthetic data
pnpm --filter insituumaps smoke          # headless Chromium end-to-end run on the fixture
pnpm --filter insituumaps smoke:local    # the same through the local-folder code path
pnpm typecheck && pnpm lint             # whole monorepo
```

The smoke tests need the dev and data servers running (`dev:fixture`) and a Chromium with
WebGL 2; they find the Playwright Chromium or `INSITUUMAPS_CHROME`. Screenshots land in
`test-data/smoke/`. `smoke:local` copies one sample into the browser's private file system
and opens it as a directory, which exercises the same code as a folder picked by the user.

### Prepare your own data

```bash
python3 scripts/convert_project.py <project-or-experiment-folder>
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
