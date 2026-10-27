---
"@tissuumaps/render": patch
---

fix(render): give every tiled image its own tile cache namespace, so that two labels (or image) objects opened from the same tile source instance no longer share cached tiles and overwrite each other's recolored tiles
