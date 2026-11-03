/**
 * The data providers the plugin registers with the TissUUmaps app, for the
 * data source types that `model.ts` uses and the app does not know
 *
 * The app's own providers read the other types (ome-zarr, zarr, parquet,
 * geojson). Two of the three providers here depend on the open sample, while
 * the app registers providers once, so they forward to the fork store's
 * current state instead of holding it themselves.
 */
import {
  type AnnotatedDataProviderLoadOptions,
  type PluginStores,
  type PointsDataProvider,
  type TableData,
  type TableDataProvider,
  type TableDataSource,
  createTable,
} from "@tissuumaps/core";

import { useAppStore as insitupyStore } from "@/state/store";
import {
  type TranscriptPointsData,
  TranscriptPointsDataProvider,
  type TranscriptPointsDataSource,
  transcriptPointsDataSourceType,
} from "@/transcripts/provider";
import {
  GrayscaleImageDataProvider,
  grayscaleImageDataSourceType,
} from "@/viewer/grayscaleImage";
import { virtualTableDataSourceType } from "@/viewer/loaders";

/**
 * Waits for a promise unless a signal is aborted first
 *
 * @param promise - The promise to wait for, which keeps running when aborted
 * @param signal - The signal that ends the wait, if any
 * @returns The promise's value
 * @throws The signal's reason once it is aborted, or the promise's rejection
 */
function raceAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason as Error);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

/**
 * Serves the transcripts of the open sample, through a provider for its
 * transcript source
 */
class CurrentTranscriptsProvider implements PointsDataProvider<
  TranscriptPointsDataSource,
  TranscriptPointsData
> {
  readonly name = "InSitUUmaps transcripts";
  readonly schema = {
    type: "object",
    properties: {
      source: { type: "string" },
      gene: { type: "string" },
      region: { type: "string" },
    },
    required: ["source", "gene", "region"],
  };
  readonly uischema = { type: "VerticalLayout", elements: [] };

  normalize(
    dataSource: TranscriptPointsDataSource,
  ): TranscriptPointsDataSource {
    return dataSource;
  }

  async load(
    dataSource: TranscriptPointsDataSource,
    options?: AnnotatedDataProviderLoadOptions,
  ): Promise<TranscriptPointsData> {
    const transcriptSource = insitupyStore.getState().transcriptSource;
    if (transcriptSource === null) {
      throw new Error("No sample with transcripts is open.");
    }
    const provider = new TranscriptPointsDataProvider(
      transcriptSource,
      (info) =>
        insitupyStore.setState((state) => ({
          transcriptInfo: { ...state.transcriptInfo, [info.gene]: info },
        })),
    );
    // The transcript index reader shares its reads between callers and keeps
    // the first caller's abort signal in them, so an aborted load would fail
    // every later load of the gene. As the standalone app's loaders do, the
    // load runs without the app's signal, which only ends the wait for it
    // (decision D15).
    const { signal, ...loadOptions } = options ?? {
      tableDataPromise: undefined,
    };
    return await raceAbortSignal(
      provider.load(dataSource, loadOptions),
      signal,
    );
  }
}

/**
 * Table data that forwards to another table data, except for `close`
 *
 * The fork store's loaders own the forwarded table and close it themselves,
 * while the app closes the table data it loaded once it no longer needs it.
 */
class UnclosableTableData implements TableData {
  private readonly _inner: TableData;

  constructor(inner: TableData) {
    this._inner = inner;
  }

  getIds() {
    return this._inner.getIds();
  }

  getSize() {
    return this._inner.getSize();
  }

  getNames() {
    return this._inner.getNames?.();
  }

  suggestColumnQueries(...args: Parameters<TableData["suggestColumnQueries"]>) {
    return this._inner.suggestColumnQueries(...args);
  }

  resolveColumnQuery(...args: Parameters<TableData["resolveColumnQuery"]>) {
    return this._inner.resolveColumnQuery(...args);
  }

  loadValues<T>(
    column: string,
    options?: Parameters<TableData["loadValues"]>[1],
  ) {
    return this._inner.loadValues<T>(column, options);
  }

  close(): void {}
}

/**
 * Serves the tables that the fork store builds in memory (the remapped nucleus
 * table), from the fork store's loaders
 */
class VirtualTableProvider implements TableDataProvider<
  TableDataSource,
  TableData
> {
  readonly name = "InSitUUmaps virtual table";
  readonly schema = {
    type: "object",
    properties: { source: { type: "string" } },
    required: ["source"],
  };
  readonly uischema = { type: "VerticalLayout", elements: [] };

  normalize(dataSource: TableDataSource): TableDataSource {
    return dataSource;
  }

  async load(
    dataSource: TableDataSource,
    options?: { signal?: AbortSignal },
  ): Promise<TableData> {
    const loaders = insitupyStore.getState().loaders;
    if (loaders === null) {
      throw new Error("No sample is open.");
    }
    const table = createTable({ id: "virtual", name: "virtual", dataSource });
    return new UnclosableTableData(await loaders.loadTable(table, options));
  }
}

/**
 * Registers the plugin's data providers with the app
 *
 * Registering is not undone: the app has no action for unregistering data
 * providers, and the providers only serve objects the plugin created.
 *
 * @param stores - The stores the app hands to the plugin
 */
export function registerDataProviders({ appStore }: PluginStores): void {
  const app = appStore.getState();
  app.registerImageDataProvider(
    grayscaleImageDataSourceType,
    new GrayscaleImageDataProvider(),
  );
  app.registerPointsDataProvider(
    transcriptPointsDataSourceType,
    new CurrentTranscriptsProvider(),
  );
  app.registerTableDataProvider(
    virtualTableDataSourceType,
    new VirtualTableProvider(),
  );
}
