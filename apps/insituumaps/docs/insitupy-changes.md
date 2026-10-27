# Change requests for InSituPy

What the viewer needs that InSituPy (branch `feat/format-v2`) does not write yet. Each entry
says what the converter (`apps/insituumaps/scripts/convert_project.py`) does in the meantime.
The viewer opens the plain layout in every case, with the reduced features named below.

## 1. AnnData layers in the viewer table (blocking for the expression-source choice)

**Problem.** `X_csc.zarr` holds only `.X`. The core workflow lets the user choose `.X` or a
layer (e.g. `counts`), which is only in `table.h5ad` (CSR, not range-readable).

**Priority.** Blocking for step 3 of the core workflow; without it the viewer offers `.X`
only and says so.

**Layout to write.** In `cells/<uid>/<layer>/X_csc.zarr` (AnnData zarr v2, consolidated), for
every layer `name` of `table.layers`:

```
layers/<name>/            group, attrs {"encoding-type": "csc_matrix", "encoding-version": "0.1.0", "shape": [n_obs, n_vars]}
layers/<name>/data        1-D, float32 (cast from float64; integer counts may stay int32), chunks ~ 100k
layers/<name>/indices     1-D int32
layers/<name>/indptr      1-D int32, length n_vars + 1
layers/.zattrs            {"encoding-type": "dict", "encoding-version": "0.1.0"}
```

This is exactly what `anndata.io.write_elem(group["layers"], name, matrix.tocsc())` writes.
Re-consolidate afterwards (`zarr.consolidate_metadata(path, zarr_format=2)`), as the viewer
lists columns from `.zmetadata` only. Dense layers should be written as CSC too (the viewer
can read dense 2-D arrays by column, but CSC keeps one gene = one small range read).

**Writer affected.** `insitupy/containers/_viewer_table.py`, `write_viewer_table`: add
`layers={name: X.tocsc() ...}` to the `AnnData` it writes (anndata writes `layers/<name>` with
the encoding above); the warning filter and the consolidation check stay.

**Backward compatibility.** Additive: readers that ignore `layers` are unaffected. The
viewer treats a missing or empty `layers` group as ".X only". A CSR layer is skipped with a
note.

**Converter.** Copies `table.h5ad` layers into the store as above (`--no-layers` skips it).

**Test.** After `save()`, open `X_csc.zarr` with zarr, assert `layers/<name>/.zattrs
["encoding-type"] == "csc_matrix"`, `shape == [n_obs, n_vars]`, and that
`layers/<name>` column `j` (via `indptr[j]:indptr[j+1]`) equals `table.layers[name][:, j]`.

## 2. Transcript index for per-gene, per-view reads (blocking for usable transcripts on large samples)

**Problem.** `transcripts.parquet` keeps the Xenium row order (by FOV, then gene) in 1M-row
row groups. Row-group statistics cannot prune by gene (every group holds nearly all genes)
and prune by position only coarsely. TissUUmaps loads the whole file. For 81M rows this is
minutes and gigabytes.

**Priority.** Blocking for transcripts on real samples; nice to have for small ones. Without
it the viewer scans the Parquet file once per sample (allowed up to 20M rows, with a warning)
and keeps all coordinates in memory.

**Layout to write.** `transcripts/insituumaps/` next to the Parquet file (the folder name is
the viewer's; `transcripts/index/` would do as well if `.ispy` named it):

- `index.json`:
  ```json
  {
    "format": "insituumaps-transcripts", "version": 1,
    "source": "transcripts/transcripts.parquet", "source_mtime": 1761234567.0,
    "units": "µm", "tile_size": 500.0, "origin": [x0, y0], "grid": [nx, ny],
    "num_points": N, "points_file": "points.bin", "tiles_file": "tiles.bin",
    "genes": [{"name": "ABCC11", "points_offset": 0, "points_count": 13633,
               "tiles_offset": 0, "tiles_count": 9}, ...]
  }
  ```
  Genes sorted by name. `origin` is the floor of the minimum x and y; `grid` the number of
  tiles per axis; a point belongs to tile `floor((x - x0) / tile_size) + nx * floor((y - y0) / tile_size)`.
- `points.bin`: for every gene in `genes` order, its points sorted by tile index, shuffled
  within each tile (so that any prefix of a tile is a fair spatial subsample), as
  little-endian float32 pairs `x, y` in µm. `points_offset` counts points, not bytes.
- `tiles.bin`: for every gene, one entry per non-empty tile as three little-endian uint32:
  tile index, offset of the tile's first point within the gene's points, number of points.

Sizes: `points.bin` is 8 bytes per point (650 MB for 81M points, read only in ranges);
`tiles.bin` is 12 bytes per non-empty (gene, tile) pair; `index.json` about 100 bytes per
gene. A tile size of 500 µm gives a few range requests per gene and view.

**Writer affected.** `insitupy/containers/io.py`, `_save_transcripts`: after writing the
Parquet file, build the index from the in-memory or dask frame (the converter shows a
numpy-only implementation: sort by `(gene rank, tile, random)` with `np.lexsort`, then
`np.diff` boundaries). It needs one pass over x, y and feature_name; for 81M rows that is
about 2 GB of RAM in numpy, or a per-gene pass with dask if memory is tight. Invalidate the
index when the Parquet file is rewritten (`source_mtime`).

**Backward compatibility.** Additive. Readers of `transcripts.parquet` are unaffected. The
viewer checks `format` and `version` and falls back to the Parquet file.

**Converter.** `build_transcript_index` writes exactly this layout (`--tile-size` sets the
tile size).

**Test.** For a small frame, read back the index and check that, for every gene, the
concatenated tile ranges hold exactly the gene's rows, that every point lies in its tile,
and that `sum(points_count) == len(frame)`.

## 3. A list of GeoJSON files for annotations and regions (blocking for overlays over HTTP)

**Problem.** `annotations/<uid>/` and `regions/<uid>/` hold one `<key>.geojson` per key, but
a static host cannot list a directory, so the viewer does not know the keys.

**Priority.** Blocking for the overlays when served over HTTP; local folders work without it.

**Layout to write.** `manifest.json` in each folder:

```json
{
  "keys": { "Tumor": "Tumor.geojson", "Stroma": "Stroma.geojson" },
  "files": ["Tumor.geojson", "Stroma.geojson"]
}
```

Alternatively list the keys in `.ispy` under `data.annotations_keys` / `data.regions_keys`;
the viewer reads the manifest first and could read `.ispy` as well.

**Writer affected.** `insitupy/containers/io.py`, the annotations/regions save (the function
that writes `<key>.geojson` into the versioned folder).

**Backward compatibility.** Additive.

**Converter.** `write_geometry_manifest` writes it from the directory listing.

**Test.** After `save()`, the manifest lists exactly the `.geojson` files of the folder.

## 4. Stable experiment-to-folder mapping (nice to have)

**Problem.** The viewer maps metadata row `i` to `data-{i:03d}` and checks the `uid` of
`.ispy` against the metadata `uid` column, warning on mismatch. If rows are reordered or a
dataset is removed without renumbering, the mapping breaks.

**Request.** Write the folder name into the metadata table (`folder` column, e.g.
`data-003`), or a `datasets.json` with `[{"uid": ..., "path": ...}]` at the experiment root.
The viewer would prefer the explicit column.

**Writer affected.** `InSituExperiment.save` (`insitupy/experiment/data.py`).

**Converter.** None; the viewer uses the positional mapping and warns on uid mismatch.

## 5. Omero contrast windows for fluorescence images (nice to have)

**Problem.** Single-channel images start with the omero window as written (`nuclei`: 0 to
1534 on the fixture). The viewer lets the user change black and white levels, but the
stored window is what everybody sees first, so it should be a good default (e.g. the 1st
to 99.5th percentile of a downsampled level).

**Writer affected.** `ImageData.save` / `write_zarr` (`insitupy/io/...`, the `omero`
section).

**Converter.** None.

## 6. Sample names in the metadata table (nice to have)

**Problem.** The sample table shows `sample_id` from the metadata if present; the fixture's
table has none, so the viewer shows the folder name until the sample is opened (then it reads
`.ispy`).

**Request.** `InSituExperiment.save` writes `sample_id` and `slide_id` into
`metadata.parquet` (they are in every `.ispy`).

## Not requested

- Vector cell boundaries: the label masks plus the outline render mode cover outlines; no
  polygon export is needed.
- Zipped stores (`.zarr.zip`): not readable with range requests; the viewer reports them.
