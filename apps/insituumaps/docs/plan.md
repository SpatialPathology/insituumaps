# InSitUUmaps plan

**InSitUUmaps** (working title InSituMaps until 2026-10-27, see decisions D22): a browser-only viewer for InSituPy projects and experiments, built on
TissUUmaps 4 (fork of upstream `main` at `4c665b6`, one commit after `tissuumaps@4.0.0-beta.3`).
The app lives in `apps/insituumaps`. This document is the living plan; `decisions.md` records
every decision taken alone, `ux.md` the UX reasoning, `insitupy-changes.md` the change requests
for InSituPy.

## 1. Gap analysis (section 1 of the brief vs. stock TissUUmaps 4)

| Need                                                              | Stock TissUUmaps 4                                                 | Gap                                                              | Approach                                                                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open an InSituPy project/experiment from its layout               | Opens a hand-built `project.tm4`                                   | No reader for `.ispy`, `.multicelldata`, `.celldata`, zarr attrs | Data-access layer in the app reads the layout and builds the TissUUmaps model in memory                                                                                 |
| Sample / cell layer / expression source / gene / outline workflow | Element-type panels (images, labels, points, shapes, tables)       | UI organised by SpatialData-like element types                   | Own React UI around the InSituPy model; TissUUmaps panels are not used                                                                                                  |
| Expression from `layers/<name>`                                   | Zarr AnnData reader supports `layers/<name>` as CSC matrix columns | `X_csc.zarr` only holds `.X`                                     | Converter writes layers as CSC into `X_csc.zarr`; change request for InSituPy                                                                                           |
| Values on cell or nucleus outlines                                | Labels are filled masks, one colouring per source works            | No outline mode; cache bug with two labels objects per source    | Core fix for the cache bug (per-tiled-image transfers and caches); outline render mode in the labels renderer; nucleus labels mapped to cells via `nucleus_to_cell_map` |
| Colour legend, adjustable range                                   | Project-level colour configs only                                  | No legend widget                                                 | Legend computed in the app from column range/categories; range editable                                                                                                 |
| Categorical obs with per-category toggles                         | `groupBy` colour maps and visibility maps exist                    | No UI                                                            | App builds colour/visibility maps per category                                                                                                                          |
| Transcripts on 81M rows                                           | Loads the whole Parquet                                            | No per-view or per-gene loading                                  | Spatially binned, gene-sorted index written by the converter; a points provider in the app loads only selected genes and tiles in view                                  |
| Experiment browser                                                | Per sample only                                                    | No metadata table                                                | App reads `metadata.parquet`/`.csv`, shows a sortable, filterable table                                                                                                 |
| Cell inspection                                                   | No picking                                                         | -                                                                | App reads the mask chunk under the cursor directly from zarr and shows the cell's values                                                                                |
| Clear errors                                                      | `console.warn` fallbacks                                           | Silent                                                           | App validates the layout and shows messages in the UI                                                                                                                   |
| Scale bar                                                         | None                                                               | -                                                                | App-side scale bar from the OSD viewport (world units are µm)                                                                                                           |

## 2. Limits of TissUUmaps 4 (section 4 of the brief)

| Limit                                          | Verdict                                     | Plan                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Labels colour cache bug                        | Fixable in the fork, small                  | `OpenSeadragonContext` keys data transfers by `TileSource`; `OMEZarrLabelsData.getTileSource()` returns one shared instance, so two labels objects collide, and OSD shares their tile cache (`getTileHashKey`). Fix: key transfers per `TiledImage` and give each tiled image its own cache namespace. Separable commit, offered upstream |
| No label hover/picking                         | Avoidable by design                         | Picking is done in the app by reading the mask chunk at the cursor from zarr (one range request per click), independent of the renderer                                                                                                                                                                                                   |
| Silent table fallbacks                         | Avoidable by design                         | The app checks the table/mask join itself (`_label_id` against mask labels) before building objects and reports problems in the UI                                                                                                                                                                                                        |
| Transcripts loaded whole                       | Needs a new file layout plus a new provider | The Parquet writer keeps FOV order; row-group statistics cannot prune by gene. A converter writes a per-gene, spatially tiled binary index; the app's provider reads only the selected genes' tiles in view. The plain layout still works with a slow fallback (scan the Parquet per gene)                                                |
| 4096 chunks time out, 512 tiles work           | Already solved by the sharded layout        | Nothing to do; a hint is shown when an image is not sharded                                                                                                                                                                                                                                                                               |
| Chunk downloads not cancelled, no tile timeout | Upstream-only for now                       | Out of scope unless time remains; documented as known issue                                                                                                                                                                                                                                                                               |
| SpatialData plugin is a stub                   | Not needed                                  | Untouched                                                                                                                                                                                                                                                                                                                                 |
| Per-sample only                                | Solved in the app                           | Sample browser and sample switch in the app                                                                                                                                                                                                                                                                                               |

## 3. Architecture

```
apps/insituumaps/src
  insitupy/            InSituPy-shaped interface (types only, no file knowledge)
  insitupy/v2/         Implementation for the on-disk layout of format v2 (.ispy, zarr, parquet)
  viewer/              Maps the InSituPy model + user choices onto the TissUUmaps project model
                       (layers, images, labels, points, shapes, tables, maps) and loads data
  transcripts/         Transcript index reader and points provider (view and gene limited)
  ui/                  React UI (workflow panel, sample browser, legend, scale bar, inspector)
  state/               Zustand stores: source, selection, view state
scripts/               fixture download/convert, data server with range requests, smoke test
```

The UI talks only to `insitupy/` types. `insitupy/v2` is one implementation; a SpatialData-backed
implementation plugs in by implementing the same interface (see section 5).

Rendering reuses `@tissuumaps/react`'s `Viewer` with a `ViewerAdapter` built by `viewer/`. The
TissUUmaps model is an implementation detail; no TissUUmaps panel or `project.tm4` is used.

World coordinates are µm: images and masks get a transform with `scale = pixel_size`; centroids,
transcripts and geometries are µm already.

## 4. Data-access interface (InSituPy-shaped)

```ts
// insitupy/types.ts (sketch; the code is the reference)
interface InSituSource            // where a project or experiment lives: URL or directory handle
interface InSituExperiment { samples: SampleEntry[]; metadata: MetadataTable; colors; openSample(i) }
interface InSituProject {
  id, sampleId, slideId, pixelSize, units: "µm"
  images: ImageEntry[]               // name, kind rgb|grayscale, raster source descriptor
  cellLayers: string[]; mainCellLayer: string
  openCellLayer(key): Promise<CellLayer>
  transcripts: TranscriptsEntry | null
  annotations: GeometryEntry[]; regions: GeometryEntry[]
}
interface CellLayer {
  key
  table: CellTable                   // genes, expression sources, obs columns, per-cell reads
  masks: { cells?: MaskEntry; nuclei?: MaskEntry }   // raster source + label mapping to cells
}
```

Raster/table "source descriptors" are the TissUUmaps data-source objects (`{type: "ome-zarr",
source}` etc.), so `viewer/` can hand them to the existing providers. The interface is in
`src/insitupy/types.ts`; `src/insitupy/v2/` implements it for the current layout, and
`src/insitupy/index.ts` is the only place that picks an implementation (`openSource`).

How a SpatialData-backed implementation plugs in (`src/insitupy/spatialdata/`, not written):

- `openSource` would detect a SpatialData zarr (`zarr.json` or `.zattrs` with
  `spatialdata_attrs`) next to the v2 detection and return the same `OpenedSource`.
- `InSituProject.images` come from `images/<name>` (OME-NGFF groups; the same `ome-zarr`
  data source type, as the TissUUmaps provider reads NGFF 0.4 and 0.5), `pixelSize` from the
  multiscale scale, `rgb` from the `c` axis.
- `cellLayers` come from the InSituPy attrs that the SpatialData writer will store (which
  `labels/<name>` and `tables/<name>` belong together, which layer is main); without them,
  one layer per table with `spatialdata_attrs.region` pointing at a labels element.
- `CellTable` wraps `tables/<name>` (AnnData zarr, v2 or v3): `genes` from `var`,
  `expressionSources` from `X` and `layers/*` (CSC required for per-gene reads, as today),
  `obsColumns` from `obs`, the table data source `{type: "zarr", source, idColumn:
"obs/<instance_key>"}` with the instance key from `spatialdata_attrs`.
- `MaskEntry` wraps `labels/<name>` with a `direct` mapping when the instance key equals the
  raster label, or a `mapped` one built like `buildLabelMapping`; `readLabel` reads the
  level-0 array through the same zarrita store.
- `TranscriptsEntry` points at `points/<name>` (Parquet) and at the same InSitUUmaps index
  folder if present; `GeometryEntry` at `shapes/<name>` with a `parquet` shapes data source
  (TissUUmaps reads GeoParquet) instead of GeoJSON.
- Nothing in `viewer/`, `state/` or `ui/` changes: they only see the interface.

## 5. Transcript strategy

Existing providers load the whole file into one points object; the Parquet layout cannot prune
by gene. Decision: a converter writes `transcripts/insituumaps/` next to the Parquet:

- `index.json`: genes (sorted), grid (tile size in µm, origin, number of tiles), per gene the
  byte offset and per-tile point counts
- `points.bin`: for every gene, its points sorted by tile, as interleaved float32 `x, y` (µm)

The app's provider fetches, per selected gene, the byte ranges of the tiles intersecting the view
(plus one tile of margin) and builds one TissUUmaps points object per gene. Without the index the
app falls back to scanning the Parquet (slow, with a visible warning). See
`insitupy-changes.md` for the InSituPy-side request.

## 6. Order of work and status

0. Recon (done)
1. Plan and docs skeleton (done)
2. Core fix: labels cache bug (done, `fix(render): isolate tile caches per tiled image`)
3. App scaffold, data-access layer, core workflow (sample, layer, source, gene, mask toggle, legend, range), scale bar, defaults (done)
4. Converter (layers, transcript index, duplicate layer for the fixture) and fixture scripts (done)
5. Outline rendering mode (done, `feat(labels): add an outline render mode`)
6. Obs colouring (categorical legend and toggles, numeric) (done)
7. Transcripts (selected genes, view limited) (done)
8. Experiment browser with metadata table (done)
9. Cell inspection (done, click)
10. Annotations and regions overlays (done; checked with demo GeoJSON)
11. Tests, smoke test, docs, final report (in progress)

Open: directory (local folder) mode is implemented but only checked by code reading, as a
headless browser cannot grant a directory picker; tile abort/timeout in the core is untouched.
