/**
 * Single-channel OME-Zarr images (DAPI and other fluorescence channels) as
 * one-channel multi-channel images, so that the TissUUmaps renderer applies
 * contrast limits and a colour through its data transfer (no re-download when
 * they change) instead of drawing the tiles as rendered by ome-zarr.js.
 */
import {
  type Color,
  type CustomTileSource,
  type DataProvider,
  type DataProviderLoadOptions,
  type DataSource,
  type ImageChannelHistogram,
  type ImageData,
  MathUtils,
  type TileSourceConfig,
  type TypedArray,
} from "@tissuumaps/core";
import {
  OMEZarrImageDataProvider,
  type OMEZarrImageDataSource,
} from "@tissuumaps/storage";

export const grayscaleImageDataSourceType = "insituumaps-grayscale";

const numHistogramPixels = 512 * 512;

type TileInvalidatedEvent = Parameters<
  NonNullable<ImageData["getTileData"]>
>[0];

/** The part of an `OMEZarrTileSource` this module reads */
type PlaneLoader = {
  maxLevel: number;
  /** Omero contrast windows of the rendered channels */
  ranges?: ([number, number] | undefined)[];
  loaded: { arrays: { dtype: string }[] };
  getWidth(level: number): number;
  getHeight(level: number): number;
  loadChunks(
    level: number,
    tile: undefined,
    options?: { signal?: AbortSignal },
  ): Promise<{ data: unknown }[]>;
};

/** A one-channel view on single-channel image data */
export class SingleChannelImageData implements ImageData {
  private readonly _inner: ImageData;
  private readonly _histogram: ImageChannelHistogram | undefined;
  private readonly _contrastLimits: [number, number] | undefined;
  private readonly _dataTypeRange: [number, number] | undefined;

  constructor(
    inner: ImageData,
    options: {
      histogram: ImageChannelHistogram | undefined;
      contrastLimits: [number, number] | undefined;
      dataTypeRange: [number, number] | undefined;
    },
  ) {
    this._inner = inner;
    this._histogram = options.histogram;
    this._contrastLimits = options.contrastLimits;
    this._dataTypeRange = options.dataTypeRange;
  }

  getSizeC(): number {
    return 1;
  }

  getTileSource(c?: number): string | TileSourceConfig | CustomTileSource {
    if (c !== undefined && c !== 0) {
      throw new Error(`Channel index ${c} is out of bounds`);
    }
    return this._inner.getTileSource();
  }

  getTileData(
    event: TileInvalidatedEvent,
  ): Promise<{ values: TypedArray; width: number; height: number }> {
    if (this._inner.getTileData === undefined) {
      throw new Error("The image data does not expose tile values");
    }
    return this._inner.getTileData(event);
  }

  getChannelName(): string | undefined {
    return undefined;
  }

  getChannelHistogram(): ImageChannelHistogram | undefined {
    return this._histogram;
  }

  getChannelDataTypeRange(): [number, number] | undefined {
    return this._dataTypeRange;
  }

  getChannelContrastLimits(): [number, number] | undefined {
    return this._contrastLimits;
  }

  getChannelColor(): Color | undefined {
    return undefined;
  }

  close(): void {
    this._inner.close();
  }
}

/**
 * Loads single-channel OME-Zarr images as {@link SingleChannelImageData};
 * multi-channel (RGB) images pass through unchanged
 */
export class GrayscaleImageDataProvider implements DataProvider<
  DataSource,
  ImageData
> {
  readonly name = "InSitUUmaps grayscale image";
  private readonly _inner = new OMEZarrImageDataProvider();

  get schema() {
    return this._inner.schema;
  }

  get uischema() {
    return this._inner.uischema;
  }

  normalize(
    dataSource: DataSource,
    workspace: FileSystemDirectoryHandle | null,
    projectSource: string | null,
  ): DataSource {
    return this._inner.normalize(
      { ...dataSource, type: "ome-zarr" } as OMEZarrImageDataSource,
      workspace,
      projectSource,
    );
  }

  async load(
    normalizedDataSource: DataSource,
    options?: DataProviderLoadOptions,
  ): Promise<ImageData> {
    const data = await this._inner.load(
      normalizedDataSource as OMEZarrImageDataSource,
      options,
    );
    if (data.getSizeC() !== undefined) {
      return data;
    }
    const tileSource = data.getTileSource() as unknown as PlaneLoader;
    let histogram: ImageChannelHistogram | undefined;
    try {
      histogram = await computeHistogram(tileSource, options);
    } catch (error) {
      options?.signal?.throwIfAborted();
      console.warn("Could not compute the image histogram:", error);
    }
    const window = tileSource.ranges?.[0];
    const contrastLimits: [number, number] | undefined =
      window !== undefined && window[0] < window[1] ? window : undefined;
    const bits = /^u?int(8|16|32)$/.exec(
      tileSource.loaded.arrays[0]?.dtype ?? "",
    );
    const signed =
      tileSource.loaded.arrays[0]?.dtype.startsWith("int") ?? false;
    const dataTypeRange: [number, number] | undefined =
      bits !== null
        ? signed
          ? [-(2 ** (Number(bits[1]) - 1)), 2 ** (Number(bits[1]) - 1) - 1]
          : [0, 2 ** Number(bits[1]) - 1]
        : undefined;
    return new SingleChannelImageData(data, {
      histogram,
      contrastLimits,
      dataTypeRange,
    });
  }
}

async function computeHistogram(
  tileSource: PlaneLoader,
  options?: { signal?: AbortSignal },
): Promise<ImageChannelHistogram | undefined> {
  const { signal } = options ?? {};
  let level = 0; // OpenSeadragon level 0 is the lowest resolution
  while (
    level < tileSource.maxLevel &&
    tileSource.getWidth(level) * tileSource.getHeight(level) <
      numHistogramPixels
  ) {
    level++;
  }
  const planes = await tileSource.loadChunks(level, undefined, { signal });
  const data = planes[0]?.data;
  if (
    !ArrayBuffer.isView(data) ||
    data instanceof BigInt64Array ||
    data instanceof BigUint64Array ||
    data instanceof DataView
  ) {
    return undefined;
  }
  const values = data as TypedArray;
  const [vmin, vmax] = await MathUtils.computeRange(values, { signal });
  if (!(vmin < vmax)) {
    return undefined;
  }
  return MathUtils.computeHistogram(values, [vmin, vmax], {
    signal,
    sample: numHistogramPixels,
  });
}
