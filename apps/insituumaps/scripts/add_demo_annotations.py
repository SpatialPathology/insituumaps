#!/usr/bin/env python3
"""Add demo annotations and regions to a project (test data only).

The fixture has no annotations or regions. This writes a few polygons in µm,
in the layout InSituPy uses (``annotations/<uid>/<key>.geojson`` and
``regions/<uid>/<key>.geojson``), registers them in ``.ispy`` and writes the
manifests the viewer needs over HTTP. Never run it on real data.

    python3 add_demo_annotations.py <project-folder>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def feature(name, coords, extra=None):
    props = {"name": name}
    if extra:
        props.update(extra)
    return {
        "type": "Feature",
        "properties": props,
        "geometry": {"type": "Polygon", "coordinates": [coords]},
    }


def main() -> None:
    project = Path(sys.argv[1]).resolve()
    ispy_path = project / ".ispy"
    ispy = json.loads(ispy_path.read_text())
    uid = "251023-120000000000-demo0000"
    ann_dir = project / "annotations" / uid
    reg_dir = project / "regions" / uid
    ann_dir.mkdir(parents=True, exist_ok=True)
    reg_dir.mkdir(parents=True, exist_ok=True)
    annotations = {
        "type": "FeatureCollection",
        "features": [
            feature("tumor", [[200, 200], [600, 180], [650, 500], [250, 550], [200, 200]], {"classification": {"name": "Tumor"}}),
            feature("stroma", [[700, 700], [1000, 720], [980, 1000], [720, 980], [700, 700]], {"classification": {"name": "Stroma"}}),
        ],
    }
    regions = {
        "type": "FeatureCollection",
        "features": [
            feature("core", [[100, 100], [1100, 100], [1100, 1100], [100, 1100], [100, 100]]),
        ],
    }
    (ann_dir / "pathologist.geojson").write_text(json.dumps(annotations))
    (reg_dir / "tissue.geojson").write_text(json.dumps(regions))
    (ann_dir / "manifest.json").write_text(json.dumps({"keys": {"pathologist": "pathologist.geojson"}, "files": ["pathologist.geojson"]}))
    (reg_dir / "manifest.json").write_text(json.dumps({"keys": {"tissue": "tissue.geojson"}, "files": ["tissue.geojson"]}))
    ispy.setdefault("data", {})["annotations"] = f"annotations/{uid}"
    ispy["data"]["regions"] = f"regions/{uid}"
    ispy_path.write_text(json.dumps(ispy, indent=4))
    print(f"wrote demo annotations and regions into {project}")


if __name__ == "__main__":
    main()
