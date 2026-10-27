/**
 * What the user chose: the state that `model.ts` turns into TissUUmaps
 * objects. Everything here uses names from the data (layer keys, gene names,
 * column names), never internal IDs.
 */

/** What colours the cells */
export type ColorBy =
  | { kind: "none" }
  | { kind: "gene"; source: string; gene: string }
  | { kind: "obs"; column: string };

/** How the selected mask is drawn */
export type MaskStyle = "outline" | "fill";

/** Per-image display settings */
export type ImageSettings = {
  visible: boolean;
  opacity: number;
  /** Contrast limits of a grayscale image (black and white level); undefined = automatic */
  contrast?: [number, number];
  /** Colour of a grayscale image as hex; undefined = white */
  color?: string;
};

/** A selected transcript gene with its colour (hex) */
export type TranscriptGene = { gene: string; color: string };

export type Selection = {
  /** Cell layer key, or null for none */
  cellLayer: string | null;
  colorBy: ColorBy;
  /** Which outlines the values are drawn on */
  mask: "cells" | "nuclei";
  maskStyle: MaskStyle;
  /** Outline width in screen pixels (outline style) */
  outlineWidth: number;
  /** Opacity of the mask layer, 0 to 1 */
  maskOpacity: number;
  /** Whether the mask is shown at all */
  maskVisible: boolean;
  /** Continuous colour palette ID (see `@tissuumaps/core` palettes) */
  palette: string;
  /** Value range of the colour legend; null = automatic */
  range: [number, number] | null;
  /** Categories switched off (categorical colouring) */
  hiddenCategories: string[];
  images: Record<string, ImageSettings>;
  transcripts: {
    genes: TranscriptGene[];
    /** Point size in µm */
    pointSize: number;
    visible: boolean;
  };
  /** Visible overlays by `<kind>:<key>` */
  overlays: Record<string, boolean>;
};

export const defaultPalette = "viridis";

/** Colours for successive transcript genes */
export const transcriptColorCycle = [
  "#ff4d4d",
  "#4dff88",
  "#4da6ff",
  "#ffd24d",
  "#ff4dff",
  "#4dffff",
  "#ff944d",
  "#b366ff",
  "#99ff4d",
  "#ff66b3",
];

export function createDefaultSelection(): Selection {
  return {
    cellLayer: null,
    colorBy: { kind: "none" },
    mask: "cells",
    maskStyle: "outline",
    outlineWidth: 1,
    maskOpacity: 1,
    maskVisible: true,
    palette: defaultPalette,
    range: null,
    hiddenCategories: [],
    images: {},
    transcripts: { genes: [], pointSize: 2, visible: true },
    overlays: {},
  };
}
