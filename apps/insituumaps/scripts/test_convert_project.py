#!/usr/bin/env python3
"""Tests of convert_project.py on a synthetic project (no fixture needed).

    python3 scripts/test_convert_project.py

Needs the same packages as the converter (numpy, zarr, h5py, scipy, pyarrow, anndata).
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import unittest
import warnings
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import convert_project  # noqa: E402


def make_project(root: Path, n_cells: int = 20, n_genes: int = 5, n_transcripts: int = 500) -> Path:
    """Write a tiny format v2 project: .ispy, a cell layer with table.h5ad and X_csc.zarr,
    transcripts.parquet, and an annotations folder."""
    import anndata
    import pandas as pd
    import pyarrow as pa
    import pyarrow.parquet as pq
    import scipy.sparse as sp

    rng = np.random.default_rng(1)
    genes = [f"G{i}" for i in range(n_genes)]
    counts = sp.random(n_cells, n_genes, density=0.5, random_state=1, format="csr", dtype=np.float32)
    counts.data = np.round(counts.data * 10)
    table = anndata.AnnData(
        X=counts.copy(),
        obs=pd.DataFrame({"area": rng.random(n_cells)}, index=[f"c{i}" for i in range(n_cells)]),
        var=pd.DataFrame(index=genes),
        layers={"counts": counts.copy(), "norm": (counts * 2).tocsr()},
    )
    table.obsm["spatial"] = rng.random((n_cells, 2)) * 100
    layer_dir = root / "cells" / "uid1" / "main"
    layer_dir.mkdir(parents=True)
    table.write_h5ad(layer_dir / "table.h5ad")
    viewer = anndata.AnnData(
        X=sp.csc_matrix(table.X),
        obs=table.obs.assign(_label_id=np.arange(1, n_cells + 1, dtype=np.uint32)),
        var=table.var,
        obsm={"spatial": table.obsm["spatial"]},
    )
    with warnings.catch_warnings(), anndata.settings.override(zarr_write_format=2):
        warnings.simplefilter("ignore")
        viewer.write_zarr(layer_dir / "X_csc.zarr")
    (layer_dir / ".celldata").write_text(json.dumps({"table": "table.h5ad", "x_csc": "X_csc.zarr", "boundaries": "boundaries.zarr"}))
    (root / "cells" / "uid1" / ".multicelldata").write_text(json.dumps({"key_main": "main", "all_keys": ["main"]}))
    tdir = root / "transcripts"
    tdir.mkdir()
    frame = pa.table(
        {
            "x_location": rng.random(n_transcripts).astype(np.float32) * 1200,
            "y_location": rng.random(n_transcripts).astype(np.float32) * 800 + 10,
            "feature_name": pa.array(rng.choice(genes, n_transcripts)).dictionary_encode(),
            "qv": rng.random(n_transcripts).astype(np.float32),
        }
    )
    pq.write_table(frame, tdir / "transcripts.parquet", row_group_size=128)
    adir = root / "annotations" / "uid2"
    adir.mkdir(parents=True)
    (adir / "Tumor.geojson").write_text('{"type": "FeatureCollection", "features": []}')
    (root / ".ispy").write_text(
        json.dumps(
            {
                "sample_id": "S",
                "data": {"cells": "cells/uid1", "transcripts": "transcripts/transcripts.parquet", "annotations": "annotations/uid2"},
            }
        )
    )
    return root


class ConverterTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.project = make_project(Path(self.tmp.name) / "project")
        args = argparse.Namespace(tile_size=300.0, no_layers=False, no_transcripts=False, duplicate_layer="copy", force=False)
        convert_project.convert_project(self.project, args)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_layers_are_csc_in_the_viewer_table(self) -> None:
        import h5py
        import zarr

        store = self.project / "cells" / "uid1" / "main" / "X_csc.zarr"
        meta = json.loads((store / ".zmetadata").read_text())["metadata"]
        self.assertEqual(meta["layers/counts/.zattrs"]["encoding-type"], "csc_matrix")
        self.assertEqual(list(meta["layers/counts/.zattrs"]["shape"]), [20, 5])
        self.assertIn("layers/norm/indptr/.zarray", meta)
        group = zarr.open_group(str(store), mode="r", zarr_format=2)
        indptr = group["layers/counts/indptr"][:]
        data = group["layers/counts/data"][:]
        indices = group["layers/counts/indices"][:]
        with h5py.File(self.project / "cells" / "uid1" / "main" / "table.h5ad", "r") as h5:
            from anndata.io import read_elem

            expected = read_elem(h5["layers"]["counts"]).tocsc()
        for j in range(5):
            column = np.zeros(20, dtype=np.float32)
            column[indices[indptr[j] : indptr[j + 1]]] = data[indptr[j] : indptr[j + 1]]
            np.testing.assert_array_equal(column, expected[:, j].toarray().ravel())

    def test_duplicate_layer(self) -> None:
        multi = json.loads((self.project / "cells" / "uid1" / ".multicelldata").read_text())
        self.assertEqual(multi["all_keys"], ["main", "copy"])
        self.assertTrue((self.project / "cells" / "uid1" / "copy" / "X_csc.zarr" / ".zmetadata").exists())

    def test_transcript_index(self) -> None:
        import pyarrow.parquet as pq

        index_dir = self.project / "transcripts" / "insituumaps"
        index = json.loads((index_dir / "index.json").read_text())
        self.assertEqual(index["format"], "insituumaps-transcripts")
        self.assertEqual(index["version"], 1)
        frame = pq.read_table(self.project / "transcripts" / "transcripts.parquet").to_pandas()
        self.assertEqual(index["num_points"], len(frame))
        self.assertEqual(sum(g["points_count"] for g in index["genes"]), len(frame))
        self.assertEqual([g["name"] for g in index["genes"]], sorted(frame["feature_name"].unique()))
        points = np.fromfile(index_dir / "points.bin", dtype="<f4").reshape(-1, 2)
        tiles = np.fromfile(index_dir / "tiles.bin", dtype="<u4").reshape(-1, 3)
        x0, y0 = index["origin"]
        nx, ny = index["grid"]
        size = index["tile_size"]
        for gene in index["genes"]:
            gene_points = points[gene["points_offset"] : gene["points_offset"] + gene["points_count"]]
            expected = frame[frame["feature_name"] == gene["name"]]
            # the same multiset of coordinates, in another order
            self.assertEqual(
                sorted(map(tuple, np.round(gene_points, 3).tolist())),
                sorted(zip(np.round(expected["x_location"].to_numpy(), 3), np.round(expected["y_location"].to_numpy(), 3))),
            )
            gene_tiles = tiles[gene["tiles_offset"] : gene["tiles_offset"] + gene["tiles_count"]]
            self.assertEqual(int(gene_tiles[:, 2].sum()), gene["points_count"])
            self.assertTrue(np.all(np.diff(gene_tiles[:, 0]) > 0), "tiles sorted")
            for tile, offset, count in gene_tiles:
                tx, ty = tile % nx, tile // nx
                self.assertLess(ty, ny)
                chunk = gene_points[offset : offset + count]
                computed = np.minimum(((chunk[:, 0] - x0) / size).astype(int), nx - 1) + nx * np.minimum(
                    ((chunk[:, 1] - y0) / size).astype(int), ny - 1
                )
                self.assertTrue(np.all(computed == tile), "every point lies in its tile")

    def test_geometry_manifest(self) -> None:
        manifest = json.loads((self.project / "annotations" / "uid2" / "manifest.json").read_text())
        self.assertEqual(manifest, {"keys": {"Tumor": "Tumor.geojson"}, "files": ["Tumor.geojson"]})

    def test_rerun_is_idempotent(self) -> None:
        args = argparse.Namespace(tile_size=300.0, no_layers=False, no_transcripts=False, duplicate_layer="copy", force=False)
        convert_project.convert_project(self.project, args)
        multi = json.loads((self.project / "cells" / "uid1" / ".multicelldata").read_text())
        self.assertEqual(multi["all_keys"], ["main", "copy"])


if __name__ == "__main__":
    unittest.main(verbosity=1)
