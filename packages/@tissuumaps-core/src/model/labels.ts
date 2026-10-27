import {
  type AnnotatedDataSource,
  type RawAnnotatedDataSource,
  type RawRenderedRasterDataObject,
  type RenderedRasterDataObject,
  createAnnotatedDataSource,
  createRenderedRasterDataObject,
} from "./base";
import type { ColorConfig, OpacityConfig, VisibilityConfig } from "./configs";
import {
  defaultLabelColorPalette,
  defaultLabelOpacity,
  defaultLabelVisibility,
} from "./constants";

/**
 * Default values for {@link RawLabels}
 */
export const labelsDefaults = {
  labelColor: { random: { palette: defaultLabelColorPalette } },
  labelVisibility: { constant: { value: defaultLabelVisibility } },
  labelOpacity: { constant: { value: defaultLabelOpacity } },
  labelRenderMode: "fill",
  labelOutlineWidth: 1,
} as const satisfies Partial<RawLabels>;

/**
 * How the pixels of a label are drawn
 *
 * - `fill`: every pixel of a label is drawn in the label's color
 * - `outline`: only the pixels along the boundary of a label are drawn, i.e.
 *   those with a 4-neighbor holding another label (or the background); the
 *   inside of the label stays transparent
 */
export const LabelRenderMode = {
  fill: "fill",
  outline: "outline",
} as const;

/** One of the render modes of the {@link LabelRenderMode} object */
export type LabelRenderMode =
  (typeof LabelRenderMode)[keyof typeof LabelRenderMode];

/**
 * A two-dimensional label mask
 */
export interface RawLabels extends RawRenderedRasterDataObject<
  RawLabelsDataSource<string>
> {
  /**
   * Label color
   *
   * @defaultValue {@link labelsDefaults.labelColor}
   */
  labelColor?: ColorConfig;

  /**
   * Label visibility
   *
   * @defaultValue {@link labelsDefaults.labelVisibility}
   */
  labelVisibility?: VisibilityConfig;

  /**
   * Label opacity
   *
   * @defaultValue {@link labelsDefaults.labelOpacity}
   */
  labelOpacity?: OpacityConfig;

  /**
   * Whether labels are drawn filled or as outlines
   *
   * @defaultValue {@link labelsDefaults.labelRenderMode}
   */
  labelRenderMode?: LabelRenderMode;

  /**
   * Width of the outlines in pixels of the drawn resolution level, for
   * {@link LabelRenderMode.outline}
   *
   * Boundaries are detected per tile, so a boundary that coincides with a
   * tile edge is not drawn on that edge.
   *
   * @defaultValue {@link labelsDefaults.labelOutlineWidth}
   */
  labelOutlineWidth?: number;
}

/**
 * A {@link RawLabels} with {@link labelsDefaults} applied
 */
export type Labels = RenderedRasterDataObject<LabelsDataSource<string>> &
  Required<Pick<RawLabels, keyof typeof labelsDefaults>> &
  Omit<RawLabels, keyof typeof labelsDefaults>;

/**
 * Creates a {@link Labels} from a {@link RawLabels} by applying {@link labelsDefaults}
 *
 * @param rawLabels - The raw labels
 * @returns The complete labels with default values applied
 */
export function createLabels(rawLabels: RawLabels): Labels {
  return {
    ...createRenderedRasterDataObject(rawLabels),
    ...structuredClone(labelsDefaults),
    ...structuredClone(rawLabels),
    dataSource: createLabelsDataSource(rawLabels.dataSource),
  };
}

/**
 * Default values for {@link RawLabelsDataSource}
 */
export const labelsDataSourceDefaults = {} as const satisfies Partial<
  RawLabelsDataSource<string>
>;

/**
 * A data source for two-dimensional label masks
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RawLabelsDataSource<
  TType extends string = string,
> extends RawAnnotatedDataSource<TType> {}

/**
 * A {@link RawLabelsDataSource} with {@link labelsDataSourceDefaults} applied
 */
export type LabelsDataSource<TType extends string = string> =
  AnnotatedDataSource<TType> &
    Required<
      Pick<RawLabelsDataSource<TType>, keyof typeof labelsDataSourceDefaults>
    > &
    Omit<RawLabelsDataSource<TType>, keyof typeof labelsDataSourceDefaults>;

/**
 * Creates a {@link LabelsDataSource} from a {@link RawLabelsDataSource} by applying {@link labelsDataSourceDefaults}
 *
 * @param rawLabelsDataSource - The raw labels data source
 * @returns The complete labels data source with default values applied
 */
export function createLabelsDataSource<TType extends string>(
  rawLabelsDataSource: RawLabelsDataSource<TType>,
): LabelsDataSource<TType> {
  return {
    ...createAnnotatedDataSource(rawLabelsDataSource),
    ...structuredClone(labelsDataSourceDefaults),
    ...structuredClone(rawLabelsDataSource),
  };
}
