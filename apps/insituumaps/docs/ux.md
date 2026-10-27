# UX decisions

What the user sees and why, and where InSitUUmaps deviates from the InSituPy napari viewer
(`InSituData.show`, the `TranscriptViewerWidget`).

## Principles

- The sidebar is the workflow, top to bottom: sample, cell layer, colour by (expression
  values, gene or property), outlines, images, transcripts, overlays. Every choice is visible
  without opening a menu, and uses the names from the data (layer keys, gene names, column
  names). No ids, paths or JSON appear.
- Defaults on open: H&E visible, fluorescence channels off (on if there is no RGB image), the
  main cell layer, white cell outlines, nothing coloured. The picture is readable before any
  click.
- Loading has visible feedback (header and viewer badges, spinners in the sections), and
  anything missing in the data is said in words: a disabled control with a tooltip, the
  "Data notes" list, or a notice. Nothing falls back silently.
- Fits 1366 x 768: a 320 px sidebar that scrolls, the viewer takes the rest; the sample table
  is a dialog over the viewer.
- The URL carries the state (source, sample, layer, colouring, outline target and style), so
  a view can be shared by copying the address bar.

## Deviations from the napari viewer

| napari viewer                                                               | InSitUUmaps                                                                                                                       | Why                                                                                                                             |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Cells are point layers coloured by gene or obs key                          | Values on the cell or nucleus **outlines** (or filled masks) over the image                                                       | Pathologists read morphology; outlines keep the tissue visible and show the segmentation itself. Points hide what they annotate |
| `keys` typed into a code call, `key_type` in {genes, obs, obsm}             | _Gene_ vs _Cell property_ buttons, a search box with suggestions, and a dropdown of properties                                    | No code and no spelling of key types; `obsm` is left out (viewer colours by one value)                                          |
| The expression source is whatever `.X` holds                                | An explicit _Expression values_ choice (`X`, `counts`, ...) shown next to the gene                                                | Users must see whether they look at counts or normalised values                                                                 |
| One napari layer per key, stacked                                           | One colouring at a time, switched instantly                                                                                       | Stacking two colourings on outlines is unreadable; switching is one click and the previous gene stays in the box                |
| Min-max contrast per layer                                                  | Numeric legend with editable min/max, _Auto_ and a palette; genes start at the 99.5th percentile                                  | A few extreme cells otherwise wash out the colouring; the user can always widen the range                                       |
| Categorical colours without a legend of counts                              | Category list with colours, cell counts and per-category toggles, _All_/_None_                                                    | Pathologists ask "which cluster is this and how big is it"                                                                      |
| Transcript dock with per-gene colours, loaded per bounding box              | Same idea: add genes, each coloured, loaded only for the view and only for those genes, with a point count and a subsample marker | Kept, as it is the right design; the loading is done through a static index instead of dask                                     |
| Annotations and regions are editable shape layers named `@ ClassName (key)` | Read-only overlays listed by key with a kind badge                                                                                | Editing is out of scope; the naming convention is hidden                                                                        |
| No cross-sample view                                                        | Sample table with the experiment metadata, sortable and filterable; switching keeps the colouring                                 | The experiment is the unit of work for a study                                                                                  |
| Scale bar option                                                            | Always on, with nice lengths (50 µm, 200 µm, 1 mm)                                                                                | It costs nothing and prevents misreading                                                                                        |
| Hover values through napari's status bar                                    | Click a cell for a card with its name, the current gene value and all properties                                                  | Hover would fire a network read per movement; a click is deliberate and works on touch                                          |

## Smaller choices

- Outline width is in pixels of the drawn pyramid level (1 to 4). One pixel is crisp when
  zoomed in; the slider helps on dense overviews.
- Nucleus outlines show the cell's value; the legend says so.
- The palette list is the continuous palettes of TissUUmaps; categories use a 20-colour
  distinct palette, or the experiment's `colors.json` if it names the column.
- Point size of transcripts is in µm (scales with zoom, like napari), default 2 µm.
- Fluorescence images (DAPI, other channels) have a colour and black/white level sliders,
  starting from the window InSituPy stored; H&E has opacity only.
- The sample table shows the sample and slide ids from every `.ispy` (read in the
  background after the experiment opens), not only the metadata columns.
- The sample dialog opens first for an experiment, because the first decision is which
  sample to look at; a link with `sample=` skips it.
- Transcripts of a gene with more points in view than the limit (2 million) are subsampled
  evenly per tile and marked with `*`; zooming in shows all of them.
