/**
 * Loads the data behind the TissUUmaps objects that `model.ts` builds, with
 * one shared, cached data instance per data source (renderers compare data by
 * identity to decide what to re-upload).
 */
import type {
  AnnotatedDataProvider,
  AnnotatedDataSource,
  Data,
  DataProvider,
  DataSource,
  Image,
  ImageData,
  Labels,
  LabelsData,
  Points,
  PointsData,
  Shapes,
  ShapesData,
  Table,
  TableData,
} from "@tissuumaps/core";
import {
  GeoJSONShapesDataProvider,
  OMEZarrImageDataProvider,
  OMEZarrLabelsDataProvider,
  ParquetTableDataProvider,
  ZarrTableDataProvider,
  geoJSONShapesDataSourceType,
  omeZarrImageDataSourceType,
  omeZarrLabelsDataSourceType,
  parquetTableDataSourceType,
  zarrTableDataSourceType,
} from "@tissuumaps/storage";

import {
  GrayscaleImageDataProvider,
  grayscaleImageDataSourceType,
} from "./grayscaleImage";

/** Data source type of tables that `loaders` build in memory */
export const virtualTableDataSourceType = "insituumaps-virtual-table";

type CacheEntry<TData extends Data> = {
  promise: Promise<TData>;
  data?: TData;
};

/**
 * Loaders for a project: the `load*` methods match the `ViewerAdapter`
 */
export class ViewerDataLoaders {
  readonly workspace: FileSystemDirectoryHandle | null;
  private readonly _imageProviders = new Map<
    string,
    DataProvider<DataSource, ImageData>
  >();
  private readonly _labelsProviders = new Map<
    string,
    AnnotatedDataProvider<AnnotatedDataSource, LabelsData>
  >();
  private readonly _pointsProviders = new Map<
    string,
    AnnotatedDataProvider<AnnotatedDataSource, PointsData>
  >();
  private readonly _shapesProviders = new Map<
    string,
    AnnotatedDataProvider<AnnotatedDataSource, ShapesData>
  >();
  private readonly _tableProviders = new Map<
    string,
    DataProvider<DataSource, TableData>
  >();
  private readonly _virtualTables = new Map<
    string,
    (options?: { signal?: AbortSignal }) => Promise<TableData>
  >();
  private readonly _images = new Map<string, CacheEntry<ImageData>>();
  private readonly _labels = new Map<string, CacheEntry<LabelsData>>();
  private readonly _points = new Map<string, CacheEntry<PointsData>>();
  private readonly _shapes = new Map<string, CacheEntry<ShapesData>>();
  private readonly _tables = new Map<string, CacheEntry<TableData>>();
  private _closed = false;

  constructor(workspace: FileSystemDirectoryHandle | null) {
    this.workspace = workspace;
    this._imageProviders.set(
      omeZarrImageDataSourceType,
      new OMEZarrImageDataProvider(),
    );
    this._imageProviders.set(
      grayscaleImageDataSourceType,
      new GrayscaleImageDataProvider(),
    );
    this._labelsProviders.set(
      omeZarrLabelsDataSourceType,
      new OMEZarrLabelsDataProvider(),
    );
    this._shapesProviders.set(
      geoJSONShapesDataSourceType,
      new GeoJSONShapesDataProvider(),
    );
    this._tableProviders.set(
      zarrTableDataSourceType,
      new ZarrTableDataProvider(),
    );
    this._tableProviders.set(
      parquetTableDataSourceType,
      new ParquetTableDataProvider(),
    );
  }

  /** Registers a points provider (e.g. the transcript index provider) */
  registerPointsProvider(
    type: string,
    provider: AnnotatedDataProvider<AnnotatedDataSource, PointsData>,
  ): void {
    this._pointsProviders.set(type, provider);
  }

  /**
   * Registers a table that is built in memory rather than loaded from a
   * source; referenced by `{ type: virtualTableDataSourceType, source: id }`
   */
  registerVirtualTable(
    id: string,
    load: (options?: { signal?: AbortSignal }) => Promise<TableData>,
  ): void {
    this._virtualTables.set(id, load);
    this._tables.delete(virtualTableKey(id));
  }

  loadImage = (
    image: Image,
    options?: { signal?: AbortSignal },
  ): Promise<ImageData> =>
    this._load(this._images, this._imageProviders, image.dataSource, options);

  loadLabels = (
    labels: Labels,
    options?: { signal?: AbortSignal },
  ): Promise<LabelsData> =>
    this._loadAnnotated(
      this._labels,
      this._labelsProviders,
      labels.dataSource,
      options,
    );

  loadPoints = (
    points: Points,
    options?: { signal?: AbortSignal },
  ): Promise<PointsData> =>
    this._loadAnnotated(
      this._points,
      this._pointsProviders,
      points.dataSource,
      options,
    );

  loadShapes = (
    shapes: Shapes,
    options?: { signal?: AbortSignal },
  ): Promise<ShapesData> =>
    this._loadAnnotated(
      this._shapes,
      this._shapesProviders,
      shapes.dataSource,
      options,
    );

  loadTable = (
    table: Table,
    options?: { signal?: AbortSignal },
  ): Promise<TableData> => this._loadTableSource(table.dataSource, options);

  /** Loaded table data, if the table has finished loading */
  peekTable(table: Table): TableData | undefined {
    return this._tables.get(this._key(table.dataSource))?.data;
  }

  /** Releases all loaded data */
  close(): void {
    this._closed = true;
    for (const cache of [
      this._images,
      this._labels,
      this._points,
      this._shapes,
      this._tables,
    ] as Map<string, CacheEntry<Data>>[]) {
      for (const entry of cache.values()) {
        entry.promise.then((data) => data.close()).catch(() => {});
      }
      cache.clear();
    }
  }

  private _loadTableSource(
    dataSource: DataSource,
    options?: { signal?: AbortSignal },
  ): Promise<TableData> {
    if (dataSource.type === virtualTableDataSourceType) {
      const id = dataSource.source ?? "";
      const key = virtualTableKey(id);
      let entry = this._tables.get(key);
      if (entry === undefined) {
        const load = this._virtualTables.get(id);
        if (load === undefined) {
          return Promise.reject(new Error(`Unknown virtual table: ${id}`));
        }
        entry = this._createEntry(this._tables, key, () => load());
      }
      return raceSignal(entry.promise, options?.signal);
    }
    return this._load(this._tables, this._tableProviders, dataSource, options);
  }

  private _load<TData extends Data>(
    cache: Map<string, CacheEntry<TData>>,
    providers: Map<string, DataProvider<DataSource, TData>>,
    dataSource: DataSource,
    options?: { signal?: AbortSignal },
  ): Promise<TData> {
    const key = this._key(dataSource);
    let entry = cache.get(key);
    if (entry === undefined) {
      entry = this._createEntry(cache, key, async () => {
        const provider = providers.get(dataSource.type);
        if (provider === undefined) {
          throw new Error(`No data provider for type ${dataSource.type}`);
        }
        const normalized = provider.normalize(dataSource, this.workspace, null);
        return await provider.load(normalized, { workspace: this.workspace });
      });
    }
    return raceSignal(entry.promise, options?.signal);
  }

  private _loadAnnotated<TData extends Data>(
    cache: Map<string, CacheEntry<TData>>,
    providers: Map<string, AnnotatedDataProvider<AnnotatedDataSource, TData>>,
    dataSource: AnnotatedDataSource,
    options?: { signal?: AbortSignal },
  ): Promise<TData> {
    const key = this._key(dataSource);
    let entry = cache.get(key);
    if (entry === undefined) {
      entry = this._createEntry(cache, key, async () => {
        const provider = providers.get(dataSource.type);
        if (provider === undefined) {
          throw new Error(`No data provider for type ${dataSource.type}`);
        }
        const normalized = provider.normalize(dataSource, this.workspace, null);
        const tableDataPromise =
          dataSource.table !== undefined
            ? this._loadTableSource(this._tableSourceById(dataSource.table))
            : undefined;
        tableDataPromise?.catch(() => {});
        return await provider.load(normalized, {
          workspace: this.workspace,
          tableDataPromise,
        });
      });
    }
    return raceSignal(entry.promise, options?.signal);
  }

  private readonly _tableSourcesById = new Map<string, DataSource>();

  /** Registers the data source of a table ID, for annotated data sources */
  registerTable(table: Table): void {
    this._tableSourcesById.set(table.id, table.dataSource);
  }

  private _tableSourceById(tableId: string): DataSource {
    const dataSource = this._tableSourcesById.get(tableId);
    if (dataSource === undefined) {
      throw new Error(`Unknown table: ${tableId}`);
    }
    return dataSource;
  }

  private _createEntry<TData extends Data>(
    cache: Map<string, CacheEntry<TData>>,
    key: string,
    load: () => Promise<TData>,
  ): CacheEntry<TData> {
    const entry: CacheEntry<TData> = { promise: load() };
    entry.promise.then(
      (data) => {
        if (this._closed || cache.get(key) !== entry) {
          data.close();
        } else {
          entry.data = data;
        }
      },
      () => {
        if (cache.get(key) === entry) {
          cache.delete(key);
        }
      },
    );
    cache.set(key, entry);
    return entry;
  }

  private _key(dataSource: DataSource): string {
    const rest: Record<string, unknown> = { ...dataSource };
    delete rest["table"];
    return JSON.stringify(rest, Object.keys(rest).toSorted());
  }
}

function virtualTableKey(id: string): string {
  return `virtual:${id}`;
}

function raceSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason as Error);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason as Error);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}
