# Decisions taken alone

Each entry: the decision, the alternatives, the reasoning. Newest at the bottom.

## D1. Branch names

Decision: develop on `insituumaps/viewer` (brief, section 5) and mirror the same commits to the
session's designated branch `claude/optimistic-ride-gjd8jb`, which the session harness requires.
Alternatives: only one of the two. Reasoning: both instructions are satisfied; the PR is opened
from `insituumaps/viewer`.

## D2. Sandbox install workaround (not committed)

The sandbox proxy blocks `codeload.github.com`, which `pnpm install` needs for the
`@zarrita/storage` fork pinned in `packages/@tissuumaps-storage`. Decision: install locally with a
temporary `overrides` entry pointing at a local clone of the same commit, then restore
`pnpm-workspace.yaml`, `pnpm-lock.yaml` and `package.json`. Nothing of this is committed. Node 22
is used although `engines` asks for 24: typecheck and tests pass. New dependencies of
`apps/insituumaps` are limited to packages already in the lockfile so the committed lockfile stays
consistent.

## D3. App structure: one app, layered folders, no new packages yet

Decision: `apps/insituumaps` holds the InSituPy interface, the v2 implementation, the viewer
mapping and the UI as separate folders with a strict import direction (ui -> state -> viewer ->
insitupy). Alternatives: new workspace packages (`@insituumaps/model`, `@insituumaps/storage`).
Reasoning: packages add build/typedoc/changeset plumbing without benefit while there is one
consumer; the folder boundary keeps a later split mechanical.

## D4. World units are µm

Decision: layer transforms are identity and raster objects carry `scale = pixel_size`, so the
OpenSeadragon world is in µm. Alternatives: pixel world with µm overlays rescaled. Reasoning:
centroids, transcripts and geometries are µm in InSituPy; the scale bar and inspector become
trivial.

## D5. Transcript index as binary + JSON instead of Parquet or Zarr

Decision: `transcripts/insituumaps/points.bin` + `index.json` (see plan, section 5).
Alternatives: (a) gene-sorted Parquet with small row groups and statistics; (b) per-gene zarr
arrays. Reasoning: (a) needs Parquet decoding of row groups in a worker and still reads whole row
groups per tile; (b) needs a variable-length tile index anyway. Raw float32 ranges are the
cheapest to read with HTTP range requests, trivial to write with numpy, and the index is a
single small JSON. The plain Parquet layout stays supported through a slow fallback.

## D6. Picking by reading the mask from zarr, not from the renderer

Decision: on click the app converts the cursor to mask pixels and reads the containing
512 x 512 chunk via zarrita (one range request plus the shard index, through the data-access
layer's `MaskEntry.readLabel`, so it works for URL and directory sources alike).
Alternatives: patch OpenSeadragon/TissUUmaps to expose tile data under the cursor. Reasoning:
independent of renderer internals, works for both masks, small code.

## D7. Outline mode implemented in the labels data transfer (core patch)

Decision: add `labelRenderMode: "fill" | "outline"` to the labels model and compute outlines per
tile in the labels renderer's `transferValues` (a pixel is drawn when a 4-neighbour holds another
label). Alternatives: vector boundaries (not stored by InSituPy), shader-based edge detection
(OSD canvas drawer has no shader stage). Known limitation: a boundary that lies exactly on a tile
seam is not drawn on that seam; documented.

## D8. Transcript index: per-gene tile tables in a binary file, not in `index.json`

Decision: `index.json` lists genes with offsets only; the per-gene tile tables live in
`tiles.bin` and are fetched per gene. Alternatives: tile tables inline in the JSON.
Reasoning: 5000 genes x 20k tiles of a large slide would make the JSON hundreds of
megabytes; the binary table costs one small range request per selected gene.

## D9. Points are shuffled within a tile; subsampling takes a prefix of every tile

Decision: when a gene has more points in view than `maxPointsPerGene` (2 million), the
reader loads the same fraction of every visible tile and marks the result as subsampled.
Alternatives: load everything (freezes the browser on dense genes at low zoom), load only
some tiles (spatially biased). Reasoning: the shuffle makes any prefix a fair sample, so
the overview stays honest and zooming in shows all points.

## D10. Native HTML controls styled with Tailwind, no component library

Decision: selects, sliders, switches and inputs are native elements (or two-line React
wrappers). Alternatives: copy the shadcn/Base UI components of `apps/tissuumaps`.
Reasoning: fewer dependencies and failure modes, keyboard and touch work out of the box,
and the viewer's UI is small. Tooltips are `title` attributes.

## D11. Automatic colour range of genes ends at the 99.5th percentile

Decision: numeric legends start at the minimum; for genes the upper end is the 99.5th
percentile of the cells, for obs columns the maximum. Alternatives: min-max (napari).
Reasoning: expression columns have long tails; a handful of cells otherwise push every
other cell into the darkest colours. The full data range is shown in the tooltip of _Auto_
and both ends are editable.

## D12. The sample table opens first for an experiment

Decision: opening an experiment URL without `sample=` shows the sample table as a dialog;
the first sample is not opened automatically. Alternatives: open sample 0. Reasoning: the
first decision of the user is which sample to look at, and loading a sample nobody asked
for costs bandwidth. A link with `sample=` skips the dialog.

## D13. Click to inspect, not hover

Decision: a click on a cell shows its values; hover does nothing. Alternatives: hover with
a delay. Reasoning: a hover read is a range request per mouse movement; a click is a
deliberate question and also works on touch screens. Picking reads the mask directly from
zarr (D6).

## D14. Headless browser test through the DevTools protocol without Playwright

Decision: `scripts/browser.mjs` drives the bundled Chromium over CDP with Node's WebSocket;
`scripts/smoke-test.mjs` walks the workflow and checks the store (exposed as
`window.insituumaps`) and the canvas. Alternatives: add `playwright` as a dependency.
Reasoning: the sandbox cannot install new packages consistently with the lockfile (D2), and
the driver is 200 lines. Playwright can replace it later without touching the test logic.

## D15. Shared reads are cached without the caller's abort signal

Decision: `InSituExperiment.openSample` and `InSituProject.openCellLayer` run the read once
without a signal and race each caller's signal against the shared promise. Reasoning: a
double click aborted the first caller's signal and poisoned the cached promise for the
second ("signal is aborted without reason"), found by the smoke test.

## D16. The app build follows the `apps/tissuumaps` convention

Decision: `pnpm --filter insituumaps build` is `tsc -b && vite build`, like the TissUUmaps
app; the root `pnpm build` (or `pnpm build:packages` first) builds the workspace packages
the production bundle resolves to. Reasoning: the same rule as the existing app, and no
double package build when CI runs `pnpm build` recursively.

## D17. Demo annotations for the fixture are written by a script, not shipped

Decision: `scripts/add_demo_annotations.py` writes two annotation polygons and one region
into a project (test data only) so that overlays can be checked. Reasoning: the fixture has
none, and inventing annotations inside the release asset is not mine to do.

## D18. The local-folder mode is tested through the origin-private file system

Decision: `scripts/smoke-local.mjs` copies a fixture sample into the browser's
origin-private file system and calls `openDirectory` with that handle. Reasoning: a
headless browser cannot grant a directory picker, but OPFS handles are real
`FileSystemDirectoryHandle` objects, so the `DirectorySource`, the TissUUmaps workspace
paths and `FileSystemHandleStore` run exactly as for a picked folder. The picker button
itself remains a thing to check by eye.

## D19. One colouring at a time, no stacked layers

Decision: the viewer shows one colouring (gene or property) on one mask at a time.
Alternatives: napari-style stacked layers per key. Reasoning: outlines of two colourings
cannot be read; switching is one click and keeps the previous gene in the search box. The
core cache fix makes two labels objects per mask possible should a comparison view be
wanted later.

## D20. Single-channel images are wrapped as one-channel multi-channel images

Decision: the viewer loads grayscale OME-Zarr images through a wrapper provider
(`viewer/grayscaleImage.ts`) that presents them as a one-channel multi-channel image, so the
TissUUmaps renderer applies contrast limits and a colour through its data transfer (no
re-download when they change). Alternatives: (a) change `OMEZarrImageDataProvider` in the
fork to do the same (changes `apps/tissuumaps` behaviour for every single-channel image);
(b) re-open the tile source with a new omero `range` per change (re-downloads tiles).
Reasoning: (a) is a behaviour change outside InSitUUmaps; (b) is slow. Side effect: the
renderer draws an opaque black backdrop under additive channels, so a fluorescence image
over H&E darkens it by its opacity, which reads as a normal overlay.

## D21. Sample ids are read from every `.ispy` after the experiment opens

Decision: the sample table shows `sample_id` and `slide_id` read from each project's
`.ispy` (one small request per sample, six at a time, in the background). Alternatives:
folder names only, or waiting for InSituPy to write them into the metadata table
(insitupy-changes.md, item 6). Reasoning: 100 small requests are cheap and the names are
what users look for; the request to InSituPy stays, as it removes the requests.

## D22. Name: InSitUUmaps (JW, 2026-10-27)

Decision (JW, after the session): the app is renamed from the working title InSituMaps to
**InSitUUmaps**, `insituumaps` in lowercase identifiers. The rename covers the display name, the
app folder (`apps/insituumaps`), the package name, `window.insituumaps`, `INSITUUMAPS_CHROME`, the
data-source type ids and the on-disk transcript index (`transcripts/insituumaps/`, format
`"insituumaps-transcripts"`), plus the repository and branch names. Alternatives: keep
InSituMaps with a "built on TissUUmaps" tagline; rename the display name only. Reasoning: the
name should show that the viewer is built on TissUUmaps (the "UU" of Uppsala University's
TissUUmaps) while still pointing to InSituPy; renaming before any data or InSituPy code depends
on the index format is cheapest now. Data converted before the rename must be converted again.

## D23. Values always on the fill, neutral outlines as a separate overlay (JW, 2026-10-27)

Decision (JW, after the eye check): the colouring is always drawn as a fill; the Style switch
(outline vs filled) is removed. The outlines are a second labels object on the same mask, drawn
on top in black at 50 % opacity and 1 px by default (width 1-4 px and opacity sliders), switched
on and off by the section switch. With _None_ as colouring, no fill is drawn (it would only cover
the image), so only the outlines show. Outlines cover all cells, also those of hidden categories.
The `style=` URL parameter is dropped (ignored in old links). Alternatives: solid black outlines
(the "dark mesh" over H&E at low zoom), a colour picker for the outlines (one more control), a
background-dependent colour. Reasoning: coloured outlines are hard to read; a neutral, semi-
transparent separator keeps cells apart without hiding colour or tissue. Tile seams (D7) are
checked by eye first and fixed only if visible; JW saw none on full-size samples (2026-10-27), so
no halo read is added. The fill starts at 50 % opacity (JW), so the image stays visible under
coloured cells. Supersedes the outline-as-colour part of D7 and
the D19 remark on outlines of two colourings.

## D24. One fill, outlines on cells, nuclei or both (JW, 2026-10-27)

Decision (JW): cell and nucleus boundaries can be shown together by separating the fill from
the outlines. _Colour on_ fills exactly one mask (cells or nuclei); _Outline_ draws neutral
outlines on the cells, the nuclei or both (nucleus outlines drawn above cell outlines), and
the section switch hides all outlines. Alternatives: two independent cell/nucleus checkboxes
that fill and outline each mask. Reasoning: two fills overlap inside the nucleus and blend
(today a double-blended copy of the same cell value, later two different values once nucleus
expression exists), and "neither checked" is a confusing empty state; one fill plus any outlines
avoids both. Designed to grow: a _Cytoplasm_ fill (cell minus nucleus) can join _Colour on_ when
compartment values exist, and with _Both_ outlines the nucleus hole stays visible. A layer with
only one mask falls back to outlining that mask. Each outline is its own labels object on the
shared mask data.

## D25. Build on TissUUmaps components; full gene list on its autocomplete (JW, 2026-10-27)

Decision (JW): InSitUUmaps is developed from TissUUmaps, reusing its components instead of its
own controls (D10 is superseded where a TissUUmaps component exists). First case, the gene
picker: TissUUmaps' `Autocomplete` (Base UI), its `InputGroup`/`IconButton`/`Button`/`Input`/
`Tooltip` and `useCompressedRowVirtualizer` are copied **verbatim** into `src/components` and
`src/hooks` (same relative paths as in `apps/tissuumaps/src`, upstream `79f9480`, see
`src/components/README.md`), with the TissUUmaps light-theme tokens in `index.css` (radius
scale left at this app's defaults). `GeneSearch` is built like TissUUmaps' `TableColumnInput`:
the whole gene list can be browsed (virtualized, A-Z) or searched (prefix matches first), and the
transcript picker lists control probes in a collapsed "Control probes (n)" group at the end
(detected by name prefix, plus "not in the cell table"); a pressed group row reopens the list
expanded. The transcript picker now offers every name of the transcript index (control probes
included), not only the table's genes. Alternatives: keep the app's own picker and lift its
12-entry cap; wait for a shared package. Reasoning: reuse first; verbatim copies keep a later
move into `@tissuumaps/react` mechanical, which the image-layer review (6.3) decides.
