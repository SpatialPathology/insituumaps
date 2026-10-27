---
"@tissuumaps/render": patch
---

fix(render): pass the raster size of each tile to `DataTransfer.transferValues`, so that the outline render mode of labels no longer uses the size of another tile that was fetched concurrently (which drew partial edge tiles filled or with wrong outlines)
