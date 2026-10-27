#!/usr/bin/env python3
"""Prepare InSituPy projects (format v2) for InSitUUmaps.

The viewer opens the plain layout as written by InSituPy, but some features need
files InSituPy does not write yet (see docs/insitupy-changes.md). This script
adds them, in place, without touching what InSituPy wrote:

1. AnnData layers (e.g. ``counts``) are copied from ``table.h5ad`` into the viewer
   table ``X_csc.zarr`` as CSC matrices (``layers/<name>``), so the viewer can offer
   them as expression sources. Only ``.X`` is there by default.
2. A spatially tiled, gene-sorted transcript index (``transcripts/insituumaps/``) that
   the viewer reads per gene and per view with range requests.
3. A ``manifest.json`` in the annotations and regions folders, as static hosts cannot
   list directories.
4. Optionally, a second cell layer that is a copy of ``main`` (``--duplicate-layer``),
   to exercise the cell-layer choice on single-layer test data.

Usage::

    python3 convert_project.py <project-or-experiment-folder> [options]

Options::

    --tile-size UM          transcript tile size in µm (default 500)
    --no-layers             skip step 1
    --no-transcripts        skip step 2
    --duplicate-layer NAME  step 4 (only if the layer does not exist yet)
    --force                 rewrite files that already exist

Requires numpy, zarr (>= 3), h5py, scipy, pyarrow and anndata.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
import warnings
from pathlib import Path

import numpy as np

INDEX_FORMAT = "insituumaps-transcripts"
INDEX_DIR = "insituumaps"
MANIFEST_NAME = "manifest.json"
HIDDEN_LAYER_COLUMNS: tuple[str, ...] = ()


def log(message: str) -> None:
    print(message, flush=True)


# ---------------------------------------------------------------------------
# discovery


def find_projects(root: Path) -> list[Path]:
    """Return the project folders under *root* (itself, or the data-NNN folders of an experiment)."""
    if (root / ".ispy").exists():
        return [root]
    if (root / "metadata.parquet").exists() or (root / "metadata.csv").exists():
        projects = sorted(p for p in root.glob("data-*") if (p / ".ispy").exists())
        if not projects:
            sys.exit(f"{root} looks like an experiment but holds no data-NNN project folders.")
        return projects
    sys.exit(f"{root} is neither a project (no .ispy) nor an experiment (no metadata table).")


def read_json(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


def write_json(path: Path, data: dict) -> None:
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


# ---------------------------------------------------------------------------
# step 1: AnnData layers into the viewer table


def add_layers_to_viewer_table(layer_dir: Path, force: bool) -> list[str]:
    """Copy the layers of ``table.h5ad`` into ``X_csc.zarr/layers/<name>`` as CSC matrices."""
    import anndata
    import h5py
    import scipy.sparse as sp
    import zarr
    from anndata.io import read_elem, write_elem

    celldata = read_json(layer_dir / ".celldata")
    table_path = layer_dir / celldata.get("table", "table.h5ad")
    store_path = layer_dir / celldata.get("x_csc", "X_csc.zarr")
    if not table_path.exists() or not store_path.exists():
        log(f"  skip layers: {table_path.name} or {store_path.name} missing")
        return []
    with h5py.File(table_path, "r") as h5:
        if "layers" not in h5:
            return []
        layer_names = list(h5["layers"].keys())
        # the index may be a dataset or a string group, depending on the anndata version
        num_rows = len(read_elem(h5["obs"]))
    if not layer_names:
        return []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        # opened without the consolidated metadata, which anndata refuses to edit;
        # it is consolidated again below
        group = zarr.open_group(str(store_path), mode="r+", zarr_format=2, use_consolidated=False)
    viewer_rows = len(read_elem(group["obs"]))
    if viewer_rows != num_rows:
        log(f"  skip layers: table.h5ad has {num_rows} cells, the viewer table {viewer_rows}")
        return []
    layers_group = group.require_group("layers")
    layers_group.attrs.update({"encoding-type": "dict", "encoding-version": "0.1.0"})
    written: list[str] = []
    with h5py.File(table_path, "r") as h5:
        for name in layer_names:
            if name in layers_group and not force:
                log(f"  layers/{name}: exists, kept (use --force to rewrite)")
                written.append(name)
                continue
            matrix = read_elem(h5["layers"][name])
            matrix = matrix.tocsc() if sp.issparse(matrix) else sp.csc_matrix(np.asarray(matrix))
            if matrix.dtype == np.float64:
                matrix = matrix.astype(np.float32)
            if name in layers_group:
                del layers_group[name]
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                write_elem(layers_group, name, matrix)
            written.append(name)
            log(f"  layers/{name}: written as CSC ({matrix.nnz} non-zeros, {matrix.dtype})")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        zarr.consolidate_metadata(str(store_path), zarr_format=2)
    _ = anndata  # imported for its side effects on the writers
    return written


# ---------------------------------------------------------------------------
# step 2: transcript index


def build_transcript_index(project: Path, parquet_rel: str, tile_size: float, force: bool) -> None:
    """Write transcripts/insituumaps/{index.json,points.bin,tiles.bin}."""
    import pyarrow.parquet as pq

    parquet_path = project / parquet_rel
    out_dir = parquet_path.parent / INDEX_DIR
    index_path = out_dir / "index.json"
    if index_path.exists() and not force:
        existing = read_json(index_path)
        if existing.get("source_mtime") == parquet_path.stat().st_mtime:
            log(f"  transcript index exists and is current, kept")
            return
        log("  transcript index is older than the Parquet file, rebuilding")
    if not parquet_path.exists():
        log(f"  skip transcripts: {parquet_rel} missing")
        return
    t0 = time.time()
    pf = pq.ParquetFile(parquet_path)
    schema = pf.schema_arrow
    columns = {"x_location", "y_location", "feature_name"}
    if not columns <= set(schema.names):
        log(f"  skip transcripts: columns {sorted(columns - set(schema.names))} missing")
        return
    num_rows = pf.metadata.num_rows
    log(f"  transcripts: {num_rows:,} rows in {pf.metadata.num_row_groups} row groups")

    # pass 1: read x, y and the gene code of every row, row group by row group
    xs = np.empty(num_rows, dtype=np.float32)
    ys = np.empty(num_rows, dtype=np.float32)
    codes = np.empty(num_rows, dtype=np.int32)
    gene_ids: dict[str, int] = {}
    gene_names: list[str] = []
    offset = 0
    for rg in range(pf.metadata.num_row_groups):
        table = pf.read_row_group(rg, columns=["x_location", "y_location", "feature_name"])
        n = table.num_rows
        xs[offset : offset + n] = table.column("x_location").to_numpy(zero_copy_only=False)
        ys[offset : offset + n] = table.column("y_location").to_numpy(zero_copy_only=False)
        names = table.column("feature_name")
        # dictionary-encode per chunk, then map local codes onto global gene ids
        dictionary = names.dictionary_encode() if names.type != "dictionary" else names
        for chunk in dictionary.chunks:
            local_names = chunk.dictionary.to_pylist()
            local_codes = chunk.indices.to_numpy(zero_copy_only=False).astype(np.int64)
            mapping = np.empty(len(local_names), dtype=np.int32)
            for i, name in enumerate(local_names):
                gid = gene_ids.get(name)
                if gid is None:
                    gid = len(gene_names)
                    gene_ids[name] = gid
                    gene_names.append(name)
                mapping[i] = gid
            m = len(chunk)
            codes[offset : offset + m] = mapping[local_codes]
            offset += m
    assert offset == num_rows, (offset, num_rows)

    # grid
    finite = np.isfinite(xs) & np.isfinite(ys)
    if not finite.all():
        log(f"  dropping {(~finite).sum()} rows with non-finite coordinates")
        xs, ys, codes = xs[finite], ys[finite], codes[finite]
    x0 = float(np.floor(xs.min())) if len(xs) else 0.0
    y0 = float(np.floor(ys.min())) if len(ys) else 0.0
    nx = int(np.floor((xs.max() - x0) / tile_size)) + 1 if len(xs) else 1
    ny = int(np.floor((ys.max() - y0) / tile_size)) + 1 if len(ys) else 1
    tx = np.minimum(((xs - x0) / tile_size).astype(np.int64), nx - 1)
    ty = np.minimum(((ys - y0) / tile_size).astype(np.int64), ny - 1)
    tiles = ty * nx + tx

    # sort by gene, then tile; shuffle within each tile so that a prefix of a
    # tile's points is a fair spatial subsample
    order_by_gene = np.argsort(gene_names)  # genes in sorted name order
    gene_rank = np.empty(len(gene_names), dtype=np.int64)
    gene_rank[order_by_gene] = np.arange(len(gene_names))
    rng = np.random.default_rng(0)
    noise = rng.random(len(codes))
    key_gene = gene_rank[codes]
    order = np.lexsort((noise, tiles, key_gene))
    xs, ys, codes, tiles = xs[order], ys[order], codes[order], tiles[order]
    key_gene = key_gene[order]

    out_dir.mkdir(parents=True, exist_ok=True)
    points = np.empty((len(xs), 2), dtype="<f4")
    points[:, 0] = xs
    points[:, 1] = ys
    points.tofile(out_dir / "points.bin")

    genes_meta = []
    tile_entries: list[np.ndarray] = []
    tiles_offset = 0
    # boundaries between genes
    gene_starts = np.flatnonzero(np.diff(key_gene, prepend=-1))
    gene_ends = np.append(gene_starts[1:], len(key_gene))
    sorted_names = [gene_names[i] for i in order_by_gene]
    for start, end in zip(gene_starts, gene_ends):
        name = sorted_names[int(key_gene[start])]
        gene_tiles = tiles[start:end]
        tile_starts = np.flatnonzero(np.diff(gene_tiles, prepend=-1))
        tile_ends = np.append(tile_starts[1:], len(gene_tiles))
        entries = np.empty((len(tile_starts), 3), dtype="<u4")
        entries[:, 0] = gene_tiles[tile_starts]
        entries[:, 1] = tile_starts
        entries[:, 2] = tile_ends - tile_starts
        tile_entries.append(entries)
        genes_meta.append(
            {
                "name": name,
                "points_offset": int(start),
                "points_count": int(end - start),
                "tiles_offset": int(tiles_offset),
                "tiles_count": int(len(entries)),
            }
        )
        tiles_offset += len(entries)
    (np.concatenate(tile_entries) if tile_entries else np.empty((0, 3), dtype="<u4")).tofile(
        out_dir / "tiles.bin"
    )
    index = {
        "format": INDEX_FORMAT,
        "version": 1,
        "source": parquet_rel,
        "source_mtime": parquet_path.stat().st_mtime,
        "units": "µm",
        "tile_size": float(tile_size),
        "origin": [x0, y0],
        "grid": [nx, ny],
        "num_points": int(len(xs)),
        "points_file": "points.bin",
        "tiles_file": "tiles.bin",
        "genes": genes_meta,
    }
    write_json(index_path, index)
    log(
        f"  transcript index: {len(genes_meta)} genes, {nx}x{ny} tiles of {tile_size} µm, "
        f"{len(xs):,} points, {time.time() - t0:.1f} s"
    )


# ---------------------------------------------------------------------------
# step 3: geometry manifests


def write_geometry_manifest(project: Path, rel_dir: str | None) -> None:
    if rel_dir is None:
        return
    folder = project / rel_dir
    if not folder.is_dir():
        return
    files = sorted(p.name for p in folder.glob("*.geojson"))
    manifest = {"keys": {Path(f).stem: f for f in files}, "files": files}
    write_json(folder / MANIFEST_NAME, manifest)
    log(f"  {rel_dir}/{MANIFEST_NAME}: {len(files)} files")


# ---------------------------------------------------------------------------
# step 4: duplicate a cell layer (test data only)


def duplicate_layer(cells_dir: Path, name: str) -> None:
    multi_path = cells_dir / ".multicelldata"
    multi = read_json(multi_path)
    keys = list(multi.get("all_keys", []))
    main = multi.get("key_main", keys[0] if keys else None)
    if name in keys:
        log(f"  cell layer {name} exists, kept")
        return
    if main is None or not (cells_dir / main).is_dir():
        log("  skip duplicate layer: no main layer")
        return
    shutil.copytree(cells_dir / main, cells_dir / name, symlinks=False)
    multi["all_keys"] = keys + [name]
    write_json(multi_path, multi)
    log(f"  cell layer {name}: copied from {main} (demo only; InSituPy would not write this)")


# ---------------------------------------------------------------------------


def convert_project(project: Path, args: argparse.Namespace) -> None:
    log(f"{project}")
    ispy = read_json(project / ".ispy")
    data = ispy.get("data", {})
    cells_rel = data.get("cells")
    if cells_rel is not None and (project / cells_rel).is_dir():
        cells_dir = project / cells_rel
        if args.duplicate_layer:
            duplicate_layer(cells_dir, args.duplicate_layer)
        if not args.no_layers:
            multi = read_json(cells_dir / ".multicelldata")
            for key in multi.get("all_keys", []):
                layer_dir = cells_dir / key
                if (layer_dir / ".celldata").exists():
                    log(f"  cell layer {key}")
                    add_layers_to_viewer_table(layer_dir, args.force)
    if not args.no_transcripts and data.get("transcripts"):
        build_transcript_index(project, data["transcripts"], args.tile_size, args.force)
    write_geometry_manifest(project, data.get("annotations"))
    write_geometry_manifest(project, data.get("regions"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("root", type=Path, help="project or experiment folder")
    parser.add_argument("--tile-size", type=float, default=500.0)
    parser.add_argument("--no-layers", action="store_true")
    parser.add_argument("--no-transcripts", action="store_true")
    parser.add_argument("--duplicate-layer", default=None)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    for project in find_projects(args.root.resolve()):
        convert_project(project, args)
    log("done")


if __name__ == "__main__":
    main()
