/**
 * Maps the InSituPy model and the user's selection onto the TissUUmaps
 * project model (layers, images, labels, points, shapes, tables and
 * group-to-value maps), which the TissUUmaps renderers draw.
 */
import {
  type Color,
  type ColorConfig,
  ColorUtils,
  type GroupValueMap,
  type Image,
  type Labels,
  type Layer,
  type Points,
  type Shapes,
  type Table,
  type VisibilityConfig,
  categoricalColorPalettes,
  createImage,
  createLabels,
  createLayer,
  createPoints,
  createShapes,
  createTable,
  identityTransform,
} from "@tissuumaps/core";

import type { CellLayer, InSituProject, ObsColumn } from "@/insitupy";
import {
  type TranscriptPointsDataSource,
  transcriptPointsDataSourceType,
  transcriptRegionKey,
} from "@/transcripts/provider";

import { grayscaleImageDataSourceType } from "./grayscaleImage";
import { virtualTableDataSourceType } from "./loaders";
import type { MaskKey, OutlineChoice, Selection } from "./selection";

/** ID of the single layer all objects of a sample live on (world = µm) */
export const sampleLayerId = "sample";
/** ID of the cell table */
export const cellTableId = "cells";
/** ID of the remapped table that colours a mapped nucleus mask */
export const nucleusTableId = "nuclei";
/** ID of the labels object filling the selected mask with the colouring */
export const maskLabelsId = "mask";
/** ID of the labels object drawing the neutral outlines of a mask */
export function outlineLabelsId(mask: MaskKey): string {
  return `mask-outlines:${mask}`;
}
/** Colour of the outlines (drawn with the outline opacity) */
const outlineColor: Color = { r: 0, g: 0, b: 0 };
const maskNames: Record<MaskKey, string> = { cells: "Cell", nuclei: "Nucleus" };

/** The masks to outline, in drawing order (nuclei above cells) */
function outlinedMasks(outlines: OutlineChoice): MaskKey[] {
  return outlines === "both" ? ["cells", "nuclei"] : [outlines];
}
/** ID of the colour map of a categorical colouring */
export const categoryColorMapId = "categories";
/** ID of the visibility map of a categorical colouring */
export const categoryVisibilityMapId = "category-visibility";

/** Everything the viewer adapter needs besides the loaders */
export type ViewerModel = {
  layers: Layer[];
  images: Image[];
  labels: Labels[];
  points: Points[];
  shapes: Shapes[];
  tables: Table[];
  colorMaps: GroupValueMap<Color>[];
  visibilityMaps: GroupValueMap<boolean>[];
};

/** The bounding box of the transcript tiles to load, in µm */
export type TranscriptRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function emptyViewerModel(): ViewerModel {
  return {
    layers: [createLayer({ id: sampleLayerId, name: "Sample" })],
    images: [],
    labels: [],
    points: [],
    shapes: [],
    tables: [],
    colorMaps: [],
    visibilityMaps: [],
  };
}

/** The colour of a category, from the experiment's colours or a palette */
export function categoryColor(
  category: string,
  index: number,
  presetColors: Record<string, string> | undefined,
): Color {
  const preset = presetColors?.[category];
  if (preset !== undefined) {
    try {
      return ColorUtils.fromHex(preset);
    } catch {
      // fall through to the palette
    }
  }
  return categoryPaletteColor(index);
}

/** The i-th colour of the categorical palette used for obs columns */
export function categoryPaletteColor(index: number): Color {
  const palette =
    categoricalColorPalettes.find((p) => p.id === "distinct") ??
    categoricalColorPalettes[0]!;
  return palette.colors[index % palette.colors.length]!;
}

export function buildViewerModel(options: {
  project: InSituProject;
  cellLayer: CellLayer | null;
  selection: Selection;
  /** The obs column of a categorical colouring, with its categories */
  obsColumn: ObsColumn | null;
  /** Colours by category name from the experiment, if any */
  presetCategoryColors: Record<string, string> | undefined;
  /** Where transcripts are loaded for, or null for none */
  transcriptRegion: TranscriptRegion | null;
}): ViewerModel {
  const {
    project,
    cellLayer,
    selection,
    obsColumn,
    presetCategoryColors,
    transcriptRegion,
  } = options;
  const model = emptyViewerModel();

  // images: µm world, so each raster is scaled by its pixel size
  for (const image of project.images) {
    const settings = selection.images[image.name];
    model.images.push(
      createImage({
        id: `image:${image.name}`,
        name: image.name,
        layer: sampleLayerId,
        // grayscale images go through the one-channel wrapper, which gives
        // them contrast limits and a colour
        dataSource: image.rgb
          ? image.dataSource
          : { ...image.dataSource, type: grayscaleImageDataSourceType },
        visibility: settings?.visible ?? true,
        opacity: settings?.opacity ?? 1,
        transform: { ...identityTransform, scale: image.pixelSize },
        ...(!image.rgb && {
          channels: [
            {
              name: image.name,
              contrastLimits: settings?.contrast,
              color:
                settings?.color !== undefined
                  ? ColorUtils.fromHex(settings.color)
                  : undefined,
            },
          ],
        }),
      }),
    );
  }

  // cells
  if (cellLayer !== null) {
    model.tables.push(
      createTable({
        id: cellTableId,
        name: `Cells (${cellLayer.key})`,
        dataSource: cellLayer.table.dataSource,
      }),
    );
    // a mapped nucleus mask is coloured through the nucleus table, registered
    // once for the fill and the outlines
    let nucleusTableAdded = false;
    const maskLabels = (maskKey: MaskKey) => {
      const mask = cellLayer.masks[maskKey];
      if (mask === undefined) {
        return undefined;
      }
      let tableId = cellTableId;
      if (mask.labelMapping.kind === "mapped") {
        tableId = nucleusTableId;
        if (!nucleusTableAdded) {
          nucleusTableAdded = true;
          model.tables.push(
            createTable({
              id: nucleusTableId,
              name: `Nuclei (${cellLayer.key})`,
              dataSource: {
                type: virtualTableDataSourceType,
                source: nucleusTableId,
              },
            }),
          );
        }
      }
      return {
        layer: sampleLayerId,
        dataSource: { ...mask.dataSource, table: tableId },
        transform: { ...identityTransform, scale: mask.pixelSize },
      };
    };

    // the values are always drawn as a fill on exactly one mask; with nothing
    // to colour, a fill would only cover the image, so only outlines are drawn
    const fillLabels =
      selection.colorBy.kind !== "none"
        ? maskLabels(selection.mask)
        : undefined;
    if (fillLabels !== undefined) {
      const { labelColor, labelVisibility, colorMap, visibilityMap } =
        buildLabelAppearance(
          cellLayer,
          selection,
          obsColumn,
          presetCategoryColors,
        );
      if (colorMap !== undefined) {
        model.colorMaps.push(colorMap);
      }
      if (visibilityMap !== undefined) {
        model.visibilityMaps.push(visibilityMap);
      }
      model.labels.push(
        createLabels({
          ...fillLabels,
          id: maskLabelsId,
          name: `${maskNames[selection.mask]} values`,
          opacity: selection.fillOpacity,
          labelColor,
          labelVisibility,
          labelRenderMode: "fill",
        }),
      );
    }

    // neutral outlines on top keep adjacent cells apart, on one or both masks
    // (nuclei above cells); they outline every cell, also those of hidden
    // categories
    if (selection.outlinesVisible) {
      for (const maskKey of outlinedMasks(selection.outlines)) {
        const outline = maskLabels(maskKey);
        if (outline !== undefined) {
          model.labels.push(
            createLabels({
              ...outline,
              id: outlineLabelsId(maskKey),
              name: `${maskNames[maskKey]} outlines`,
              opacity: selection.outlineOpacity,
              labelColor: { constant: { value: outlineColor } },
              labelRenderMode: "outline",
              labelOutlineWidth: selection.outlineWidth,
            }),
          );
        }
      }
    }
  }

  // transcripts: one points object per selected gene
  if (
    project.transcripts !== null &&
    selection.transcripts.visible &&
    transcriptRegion !== null
  ) {
    for (const { gene, color } of selection.transcripts.genes) {
      const dataSource: TranscriptPointsDataSource = {
        type: transcriptPointsDataSourceType,
        source:
          project.transcripts.index?.source.resolve("index.json") ??
          project.transcripts.parquetSource,
        gene,
        region: transcriptRegionKey(transcriptRegion),
      };
      model.points.push(
        createPoints({
          id: `transcripts:${gene}`,
          name: gene,
          layer: sampleLayerId,
          dataSource,
          pointColor: { constant: { value: ColorUtils.fromHex(color) } },
          pointSize: {
            constant: { value: selection.transcripts.pointSize, unit: "layer" },
          },
        }),
      );
    }
  }

  // annotations and regions
  for (const entry of [...project.annotations, ...project.regions]) {
    const overlayKey = `${entry.kind}:${entry.key}`;
    if (selection.overlays[overlayKey] !== true) {
      continue;
    }
    const color =
      entry.kind === "annotation"
        ? { r: 255, g: 230, b: 0 }
        : { r: 0, g: 200, b: 255 };
    model.shapes.push(
      createShapes({
        id: `overlay:${overlayKey}`,
        name: entry.key,
        layer: sampleLayerId,
        dataSource: entry.dataSource,
        shapeFillVisibility: { constant: { value: false } },
        shapeStrokeColor: { constant: { value: color } },
      }),
    );
  }

  return model;
}

function buildLabelAppearance(
  cellLayer: CellLayer,
  selection: Selection,
  obsColumn: ObsColumn | null,
  presetCategoryColors: Record<string, string> | undefined,
): {
  labelColor: ColorConfig;
  labelVisibility: VisibilityConfig;
  colorMap?: GroupValueMap<Color>;
  visibilityMap?: GroupValueMap<boolean>;
} {
  const { colorBy } = selection;
  const table = cellLayer.table;
  const everything: VisibilityConfig = { constant: { value: true } };
  if (colorBy.kind === "gene") {
    const source = table.expressionSources.find(
      (s) => s.name === colorBy.source,
    );
    if (source === undefined || !table.genes.includes(colorBy.gene)) {
      return {
        labelColor: { constant: { value: { r: 255, g: 255, b: 255 } } },
        labelVisibility: everything,
      };
    }
    return {
      labelColor: {
        from: {
          column: table.geneColumnQuery(source, colorBy.gene),
          palette: selection.palette,
          range: selection.range ?? undefined,
        },
      },
      labelVisibility: everything,
    };
  }
  if (colorBy.kind === "obs") {
    const column = table.obsColumnQuery(colorBy.column);
    if (obsColumn === null || obsColumn.kind === "numeric") {
      return {
        labelColor: {
          from: {
            column,
            palette: selection.palette,
            range: selection.range ?? undefined,
          },
        },
        labelVisibility: everything,
      };
    }
    const categories = obsColumn.categories ?? [];
    const colorValues: Record<string, Color> = {};
    categories.forEach((category, index) => {
      colorValues[category] = categoryColor(
        category,
        index,
        presetCategoryColors,
      );
    });
    const colorMap: GroupValueMap<Color> = {
      id: categoryColorMapId,
      name: colorBy.column,
      values: colorValues,
      default: { r: 128, g: 128, b: 128 },
    };
    const visibilityValues: Record<string, boolean> = {};
    for (const hidden of selection.hiddenCategories) {
      visibilityValues[hidden] = false;
    }
    const visibilityMap: GroupValueMap<boolean> = {
      id: categoryVisibilityMapId,
      name: colorBy.column,
      values: visibilityValues,
      default: true,
    };
    return {
      labelColor: { groupBy: { column, map: categoryColorMapId } },
      labelVisibility:
        selection.hiddenCategories.length > 0
          ? { groupBy: { column, map: categoryVisibilityMapId } }
          : everything,
      colorMap,
      visibilityMap,
    };
  }
  return {
    labelColor: { constant: { value: { r: 255, g: 255, b: 255 } } },
    labelVisibility: everything,
  };
}
