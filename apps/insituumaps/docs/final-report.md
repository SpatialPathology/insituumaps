# InSitUUmaps: final report

Branch `insituumaps/viewer` on `SpatialPathology/insituumaps` (mirrored to
`claude/optimistic-ride-gjd8jb`), based on upstream `main` at `4c665b6`; draft pull request
SpatialPathology/insituumaps#1. Commits: docs skeleton, two separable core changes, the app,
converter and tests, fixes, and the fluorescence contrast and sample id additions.

## What works

- **Opens InSituPy data from its layout.** `?source=<url>` or a picked local folder; a folder
  with `.ispy` is a project, one with `metadata.parquet` (or `.csv`) an experiment. Reads
  `.ispy`, `.multicelldata`, `.celldata`, the zarr attributes of images and masks, the
  consolidated metadata of `X_csc.zarr` and `boundaries.zarr` arrays. No `project.tm4`.
- **Core workflow in the brief's order**: sample (table with sorting and filtering, or a
  dropdown), cell layer (`main` and others), expression values (`.X` and, after the
  converter, `counts`, `norm_counts`), gene search with suggestions, values drawn on cell or
  nucleus outlines (or filled), colour legend with editable range and palette. Nucleus labels
  are joined to cells through `nucleus_to_cell_map` (general mapping; the fixture's happens to
  be the identity, which is detected).
- **Cell properties**: numeric columns with a legend; categorical columns with colours,
  counts and per-category toggles (experiment `colors.json` is honoured when it names the
  column).
- **Images**: H&E (RGB) and fluorescence channels with visibility and opacity; fluorescence
  channels also get a colour and black/white levels (starting from the stored omero window);
  defaults H&E on, DAPI off.
- **Transcripts**: per selected gene, only the tiles in view, through a converter-written
  index (`transcripts/insituumaps/`), with per-tile fair subsampling above 2 million points
  in view and a `*` marker; Parquet fallback without the index (up to 20 million rows, with a
  warning).
- **Annotations and regions** as read-only overlays (GeoJSON, needs the manifest over HTTP).
- **Cell inspection**: click a cell to see its name, the current gene value and all obs
  columns; the label is read from the mask store, not from the renderer.
- **Scale bar, shareable URL state, visible loading feedback, data notes** for everything
  that is missing or odd in the data.
- **Core fixes in the fork** (separable commits with changesets): tile caches isolated per
  tiled image (the labels colour cache bug), and an outline render mode for labels.
- **Converter** (`scripts/convert_project.py`): AnnData layers into the viewer table as CSC,
  transcript index, geometry manifests, optional duplicate cell layer for test data.
- **Static production build** (`dist/`, relative paths) that runs from any static host.

## How it was verified

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm fmt:check` and `pnpm changeset status`
  pass for the whole monorepo (the TissUUmaps packages' tests included, plus 29 new tests in
  `@tissuumaps/render` and 25 in the app); `pnpm --filter insituumaps test:converter` runs the
  converter on a synthetic project (5 tests).
- `pnpm --filter tissuumaps build` still builds, `apps/tissuumaps` is untouched.
- `scripts/smoke-test.mjs`: headless Chromium (SwiftShader WebGL 2) walks the workflow on
  the fixture experiment and checks the store state and the rendered canvas after every step
  (sample table, sample, gene with the `counts` layer, nucleus outlines filled, `leiden`
  with a hidden category, transcripts of two genes, zoom with a follow-up transcript region,
  cell inspection, cell-layer and sample switches, no console errors). Passed against the dev
  server and against the production build served by a plain static server.
- `scripts/smoke-local.mjs`: the same core path through a real `FileSystemDirectoryHandle`
  (origin-private file system). Passed.
- Screenshots of each step were inspected during development (gene outlines, nucleus
  outlines, cluster fills, transcripts, overlays, inspector).

### Not verified

- The _Open a folder on this computer_ button itself (needs a user gesture); the code path
  behind it is the one the local smoke test covers.
- Performance on real sample sizes (41k x 37k images, 81M transcripts, 100 samples). The
  design covers it (tiles, per-gene per-view ranges, one small JSON per experiment), but the
  fixture is 1.2 x 1.2 mm. Watch the first transcript request of a gene on a large slide: it
  fetches that gene's tile table (12 bytes per non-empty tile, so about 1 MB for 80k tiles).
- Behaviour behind the production signing proxy (CORS headers for `Range` and
  `Content-Range` must be exposed; `scripts/serve-data.mjs` shows the headers used).
- Firefox and Safari (only Chromium ran here). Local folders need Chromium by design.

## Known issues and limits

- Outlines are detected per tile: a cell boundary that coincides with a tile edge is not
  drawn along that edge (a few pixels on seams of 512 px tiles).
- A fluorescence image drawn over H&E darkens it by its opacity (the TissUUmaps renderer
  puts a black backdrop under additively blended channels); use the opacity slider.
- Transcript genes with more than 2 million points in view are subsampled evenly; the number
  shown is marked with `*`.
- The Parquet fallback for transcripts keeps all coordinates in memory and refuses files
  above 20 million rows.
- Annotations and regions over HTTP need `manifest.json` (converter) until InSituPy writes it;
  local folders list the files themselves.
- Experiments map metadata row `i` to `data-NNN` and warn on `uid` mismatch; a reordered
  table is not repaired.
- The sandbox could not run `pnpm install` as committed (a git-hosted dependency behind a
  blocked host) and used Node 22; the lockfile was updated by hand-merging the new importer
  block, so a fresh `pnpm install --frozen-lockfile` with Node 24 should be the first thing to
  try. The build and tests passed here with the same lockfile contents.

## What to check by eye

1. `pnpm install`, `pnpm --filter insituumaps fixture`, `pnpm --filter insituumaps dev:fixture`,
   open the printed URL, pick a sample.
2. Type a gene, switch between cell and nucleus outlines, outline and filled, change the
   range; is the 99.5th percentile default sensible on real data?
3. Zoom in on outlines: 1 px lines at 1366 x 768; is 2 px a better default?
4. Add two or three transcript genes, pan and zoom; check the loading feel and the point
   size default (2 µm).
5. Pick a folder with the button (Chrome) and compare with the URL mode.
6. Open a real experiment of 10 to 100 samples and judge the sample table.
7. The production build behind your proxy: `pnpm --filter insituumaps build`, host `dist/`,
   open `?source=https://.../experiment/`.

## Questions for JW

1. Branch names: both `insituumaps/viewer` (your rule) and `claude/optimistic-ride-gjd8jb`
   (the session's requirement) carry the same commits. Which one should the PR stay on?
2. The `tm4_builder_excerpt.py` and the `project.tm4` announced in the brief were not
   attached; the mapping was derived from the layout and the fixture instead. Does your
   builder set anything the viewer should copy (e.g. a specific DAPI contrast window or
   palette)?
3. Transcript index: is `transcripts/insituumaps/` an acceptable folder name for a file that
   InSituPy would write, or should it be named in `.ispy` (`data.transcripts_index`)?
4. Default colour range at the 99.5th percentile for all numeric colourings: keep, or
   min-max for obs columns?
5. Should single-channel images get a contrast slider (needs a small TissUUmaps change to
   expose `range` on single-channel OME-Zarr tile sources)?
6. Duplicate `main` as `main-copy` in the fixture (converter flag) is for the layer switch
   only; should the fixture release carry a real second layer (e.g. proseg) instead?
7. Experiments: do you want sample names (`sample_id`) in `metadata.parquet`, or should the
   viewer read every `.ispy` up front (one request per sample)?
8. Hover inspection was left out deliberately (one network read per mouse move); is a
   hover-after-delay mode wanted?
9. Would you like the two core changes offered upstream as they are (changesets included)?
