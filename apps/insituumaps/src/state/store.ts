/**
 * Application state: the opened source, the selected sample, cell layer and
 * colouring, the view, and the derived TissUUmaps model. Plain zustand
 * (no immer): updates spread the previous state.
 */
import { create } from "zustand";

import { type TableData, TableUtils } from "@tissuumaps/core";

import {
  type CellLayer,
  type DataIssue,
  DirectorySource,
  type InSituExperiment,
  type InSituProject,
  type InSituSource,
  type ObsColumn,
  type OpenedSource,
  URLSource,
  openSource,
} from "@/insitupy";
import type { RegionUm } from "@/transcripts/indexFormat";
import {
  type TranscriptLoadInfo,
  TranscriptPointsDataProvider,
  TranscriptSource,
  transcriptPointsDataSourceType,
} from "@/transcripts/provider";
import { ViewerDataLoaders } from "@/viewer/loaders";
import {
  type TranscriptRegion,
  type ViewerModel,
  buildViewerModel,
  cellTableId,
  emptyViewerModel,
  nucleusTableId,
} from "@/viewer/model";
import { RemappedTableData } from "@/viewer/remappedTable";
import {
  type ColorBy,
  type ImageSettings,
  type OutlineChoice,
  type Selection,
  createDefaultSelection,
  transcriptColorCycle,
} from "@/viewer/selection";

import { readStateFromUrl, writeStateToUrl } from "./url";

export type Status =
  | { phase: "idle" }
  | { phase: "loading"; message: string }
  | { phase: "ready" }
  | { phase: "error"; message: string };

/** A transient message shown to the user */
export type Notice = {
  id: number;
  severity: "info" | "warning" | "error";
  message: string;
};

/** The colour legend of the current colouring */
export type Legend =
  | {
      kind: "numeric";
      /** Name shown in the legend */
      title: string;
      /** The automatic range (min, high percentile) */
      autoRange: [number, number];
      /** The full value range */
      fullRange: [number, number];
    }
  | {
      kind: "categorical";
      title: string;
      categories: { name: string; count: number }[];
    };

/** What the inspector shows about a cell */
export type Inspection = {
  /** Position in µm */
  x: number;
  y: number;
  /** Raster label under the cursor, 0 for background */
  label: number;
  cellName: string | null;
  /** Values by display name (gene or obs column) */
  values: { name: string; value: string }[];
  status: "loading" | "ready";
};

/** Fallback tile size for the transcript region when no index is loaded */
const defaultTranscriptTileSize = 500;

/** High percentile for the automatic upper range of numeric colourings */
const expressionPercentile = 0.995;

export type AppState = {
  source: InSituSource | null;
  opened: OpenedSource | null;
  openStatus: Status;
  experiment: InSituExperiment | null;
  sampleIndex: number | null;
  project: InSituProject | null;
  projectStatus: Status;
  cellLayer: CellLayer | null;
  cellLayerStatus: Status;
  loaders: ViewerDataLoaders | null;
  transcriptSource: TranscriptSource | null;
  transcriptTileSize: number;
  selection: Selection;
  legend: Legend | null;
  legendStatus: Status;
  model: ViewerModel;
  /** Changes whenever a different project is shown; resets the viewport */
  projectInstanceId: string;
  viewport: RegionUm | null;
  containerWidth: number;
  transcriptRegion: TranscriptRegion | null;
  transcriptInfo: Record<string, TranscriptLoadInfo>;
  inspection: Inspection | null;
  issues: DataIssue[];
  notices: Notice[];
  sampleBrowserOpen: boolean;
  /** Candidate gene names for the transcript search */
  transcriptGenes: string[];
  /** All names in the transcript index (control probes included), if any */
  transcriptIndexGenes: string[] | null;
  /** Bumped when the sample ids of the experiment have been read */
  sampleInfoVersion: number;

  openUrl: (url: string) => Promise<void>;
  openDirectory: (handle: FileSystemDirectoryHandle) => Promise<void>;
  closeSource: () => void;
  selectSample: (index: number) => Promise<void>;
  setSampleBrowserOpen: (open: boolean) => void;
  selectCellLayer: (key: string) => Promise<void>;
  setColorBy: (colorBy: ColorBy) => void;
  setMask: (mask: "cells" | "nuclei") => void;
  setFillOpacity: (opacity: number) => void;
  setOutlinesVisible: (visible: boolean) => void;
  setOutlines: (outlines: OutlineChoice) => void;
  setOutlineWidth: (width: number) => void;
  setOutlineOpacity: (opacity: number) => void;
  setPalette: (palette: string) => void;
  setRange: (range: [number, number] | null) => void;
  toggleCategory: (category: string) => void;
  setCategoriesHidden: (hidden: boolean) => void;
  setImage: (name: string, settings: Partial<ImageSettings>) => void;
  addTranscriptGene: (gene: string) => void;
  removeTranscriptGene: (gene: string) => void;
  setTranscriptColor: (gene: string, color: string) => void;
  setTranscriptPointSize: (size: number) => void;
  setTranscriptsVisible: (visible: boolean) => void;
  toggleOverlay: (key: string) => void;
  setViewport: (viewport: RegionUm, containerWidth: number) => void;
  inspectAt: (x: number, y: number) => Promise<void>;
  clearInspection: () => void;
  dismissNotice: (id: number) => void;
};

let noticeCounter = 0;
/** The URL state captured when a source is opened, consumed by the first project shown */
let pendingUrlState: ReturnType<typeof readStateFromUrl> | null = null;
let openAbort: AbortController | null = null;
let sampleAbort: AbortController | null = null;
let layerAbort: AbortController | null = null;
let legendAbort: AbortController | null = null;
let inspectAbort: AbortController | null = null;

export const useAppStore = create<AppState>()((set, get) => {
  const notify = (severity: Notice["severity"], message: string) => {
    const id = ++noticeCounter;
    set((state) => ({
      notices: [...state.notices, { id, severity, message }],
    }));
    if (severity !== "error") {
      setTimeout(() => get().dismissNotice(id), 8000);
    }
  };

  const collectIssues = () => {
    const { opened, project, cellLayer } = get();
    const issues: DataIssue[] = [];
    if (opened?.kind === "experiment") {
      issues.push(...opened.experiment.issues);
    }
    if (project !== null) {
      issues.push(...project.issues);
    }
    if (cellLayer !== null) {
      issues.push(...cellLayer.issues);
    }
    return issues;
  };

  /** Rebuilds the TissUUmaps model from the current state */
  const rebuild = () => {
    const state = get();
    if (state.project === null || state.loaders === null) {
      set({ model: emptyViewerModel() });
      return;
    }
    const selection = state.selection;
    const obsColumn =
      selection.colorBy.kind === "obs" && state.cellLayer !== null
        ? (state.cellLayer.table.obsColumns.find(
            (c) => c.name === (selection.colorBy as { column: string }).column,
          ) ?? null)
        : null;
    const effectiveSelection: Selection =
      selection.range === null && state.legend?.kind === "numeric"
        ? { ...selection, range: state.legend.autoRange }
        : selection;
    const presetColors =
      obsColumn !== null && state.experiment !== null
        ? state.experiment.colors[obsColumn.name]
        : undefined;
    const model = buildViewerModel({
      project: state.project,
      cellLayer: state.cellLayer,
      selection: effectiveSelection,
      obsColumn,
      presetCategoryColors: presetColors,
      transcriptRegion:
        selection.transcripts.genes.length > 0 ? state.transcriptRegion : null,
    });
    for (const table of model.tables) {
      state.loaders.registerTable(table);
    }
    set({ model, issues: collectIssues() });
  };

  const updateSelection = (update: Partial<Selection>) => {
    set((state) => ({ selection: { ...state.selection, ...update } }));
    rebuild();
    writeStateToUrl(get());
  };

  /** Loads the legend (value range or categories) of the current colouring */
  const loadLegend = async () => {
    legendAbort?.abort();
    const abort = new AbortController();
    legendAbort = abort;
    const { cellLayer, loaders, selection, model } = get();
    const colorBy = selection.colorBy;
    if (cellLayer === null || loaders === null || colorBy.kind === "none") {
      set({ legend: null, legendStatus: { phase: "idle" } });
      rebuild();
      return;
    }
    const table = model.tables.find((t) => t.id === cellTableId);
    if (table === undefined) {
      set({ legend: null, legendStatus: { phase: "idle" } });
      return;
    }
    set({ legendStatus: { phase: "loading", message: "Loading values" } });
    try {
      const tableData = await loaders.loadTable(table, {
        signal: abort.signal,
      });
      let legend: Legend;
      if (colorBy.kind === "gene") {
        const source = cellLayer.table.expressionSources.find(
          (s) => s.name === colorBy.source,
        );
        if (source === undefined) {
          throw new Error(`Unknown expression source ${colorBy.source}`);
        }
        const query = cellLayer.table.geneColumnQuery(source, colorBy.gene);
        const values = await tableData.loadValues<number>(query, {
          signal: abort.signal,
        });
        legend = {
          kind: "numeric",
          title: `${colorBy.gene} (${source.name})`,
          ...computeRanges(values, expressionPercentile),
        };
      } else {
        const column = cellLayer.table.obsColumns.find(
          (c) => c.name === colorBy.column,
        );
        const query = cellLayer.table.obsColumnQuery(colorBy.column);
        if (column === undefined || column.kind === "numeric") {
          const values = await tableData.loadValues<number>(query, {
            signal: abort.signal,
          });
          legend = {
            kind: "numeric",
            title: colorBy.column,
            ...computeRanges(values, 1),
          };
        } else {
          const counts = await TableUtils.loadGroupCounts(tableData, query, {
            signal: abort.signal,
          });
          const known = column.categories ?? [];
          const categories = [
            ...known.map((name) => ({ name, count: counts.get(name) ?? 0 })),
            ...[...counts.entries()]
              .filter(([name]) => !known.includes(name))
              .map(([name, count]) => ({ name, count })),
          ];
          // string columns without stored categories: list what the data holds
          if (known.length === 0) {
            column.categories = categories.map((c) => c.name);
          }
          legend = { kind: "categorical", title: colorBy.column, categories };
        }
      }
      if (abort.signal.aborted) {
        return;
      }
      set({ legend, legendStatus: { phase: "ready" } });
      rebuild();
    } catch (error) {
      if (abort.signal.aborted) {
        return;
      }
      set({
        legend: null,
        legendStatus: { phase: "error", message: describeError(error) },
      });
      notify("error", `Could not load the values: ${describeError(error)}`);
    }
  };

  const openCellLayer = async (key: string) => {
    layerAbort?.abort();
    const abort = new AbortController();
    layerAbort = abort;
    const { project, loaders } = get();
    if (project === null || loaders === null) {
      return;
    }
    set({
      cellLayer: null,
      legend: null,
      cellLayerStatus: {
        phase: "loading",
        message: `Loading cell layer ${key}`,
      },
      selection: { ...get().selection, cellLayer: key },
    });
    rebuild();
    try {
      const cellLayer = await project.openCellLayer(key, {
        signal: abort.signal,
      });
      if (abort.signal.aborted) {
        return;
      }
      // the nucleus mask may need a remapped table
      const nuclei = cellLayer.masks.nuclei;
      if (nuclei !== undefined && nuclei.labelMapping.kind === "mapped") {
        const labelToRow = nuclei.labelMapping.labelToRow;
        loaders.registerVirtualTable(nucleusTableId, async (options) => {
          const cellTable = get().model.tables.find(
            (t) => t.id === cellTableId,
          );
          if (cellTable === undefined) {
            throw new Error("The cell table is not part of the model");
          }
          const base = await loaders.loadTable(cellTable, options);
          return RemappedTableData.fromLabelToRow(base, labelToRow);
        });
      }
      const selection = get().selection;
      // keep the user's choices where they still apply
      const colorBy = validateColorBy(selection.colorBy, cellLayer);
      const mask =
        cellLayer.masks[selection.mask] !== undefined
          ? selection.mask
          : cellLayer.masks.cells !== undefined
            ? "cells"
            : "nuclei";
      // outline what the layer has: "both" or a missing mask falls back to
      // the mask that exists
      const hasCells = cellLayer.masks.cells !== undefined;
      const hasNuclei = cellLayer.masks.nuclei !== undefined;
      const outlines: OutlineChoice =
        hasCells && hasNuclei
          ? selection.outlines
          : selection.outlines === "nuclei" && hasNuclei
            ? "nuclei"
            : hasCells
              ? "cells"
              : "nuclei";
      set({
        cellLayer,
        cellLayerStatus: { phase: "ready" },
        selection: {
          ...selection,
          cellLayer: key,
          colorBy,
          mask,
          outlines,
        },
        // without a transcript index, the table's genes are the best guess
        transcriptGenes: get().transcriptIndexGenes ?? cellLayer.table.genes,
      });
      rebuild();
      writeStateToUrl(get());
      if (
        cellLayer.masks.cells === undefined &&
        cellLayer.masks.nuclei === undefined
      ) {
        notify(
          "warning",
          `Cell layer ${key} has no segmentation masks; values cannot be drawn as outlines.`,
        );
      }
      await loadLegend();
    } catch (error) {
      if (abort.signal.aborted) {
        return;
      }
      set({
        cellLayerStatus: { phase: "error", message: describeError(error) },
      });
      notify("error", describeError(error));
    }
  };

  const showProject = async (
    project: InSituProject,
    sampleIndex: number | null,
  ) => {
    const state = get();
    state.loaders?.close();
    const loaders = new ViewerDataLoaders(state.source?.workspace ?? null);
    const transcriptSource = new TranscriptSource(project);
    loaders.registerPointsProvider(
      transcriptPointsDataSourceType,
      new TranscriptPointsDataProvider(transcriptSource, (info) => {
        set((s) => ({
          transcriptInfo: { ...s.transcriptInfo, [info.gene]: info },
        }));
      }),
    );
    const urlState = pendingUrlState ?? {};
    pendingUrlState = null;
    const previous = state.selection;
    const images: Record<string, ImageSettings> = {};
    const hasRgb = project.images.some((i) => i.rgb);
    project.images.forEach((image, i) => {
      const visible = hasRgb ? image.rgb : i === 0;
      images[image.name] = previous.images[image.name] ?? {
        visible,
        opacity: 1,
      };
    });
    const selection: Selection = {
      ...createDefaultSelection(),
      // carry the colouring and style over between samples of an experiment
      colorBy: urlState.colorBy ?? previous.colorBy,
      mask: urlState.mask ?? previous.mask,
      fillOpacity: previous.fillOpacity,
      outlinesVisible: previous.outlinesVisible,
      outlines: previous.outlines,
      outlineWidth: previous.outlineWidth,
      outlineOpacity: previous.outlineOpacity,
      palette: previous.palette,
      images,
      transcripts: {
        ...previous.transcripts,
        genes: [...previous.transcripts.genes],
      },
      cellLayer: null,
    };
    let transcriptTileSize = defaultTranscriptTileSize;
    let transcriptIndexGenes: string[] | null = null;
    if (transcriptSource.hasIndex) {
      try {
        const reader = await transcriptSource.openIndex();
        transcriptTileSize = reader.index.tile_size;
        // every name in the transcripts, control probes included
        transcriptIndexGenes = reader.genes;
      } catch (error) {
        project.issues.push({
          severity: "warning",
          subject: "Transcripts",
          message: `The transcript index could not be read (${describeError(error)}); transcripts are loaded from the Parquet file instead.`,
        });
      }
    }
    set({
      project,
      sampleIndex,
      projectStatus: { phase: "ready" },
      loaders,
      transcriptSource,
      transcriptTileSize,
      transcriptIndexGenes,
      transcriptGenes: transcriptIndexGenes ?? [],
      selection,
      legend: null,
      cellLayer: null,
      inspection: null,
      transcriptInfo: {},
      transcriptRegion: null,
      projectInstanceId: crypto.randomUUID(),
      sampleBrowserOpen: false,
    });
    rebuild();
    const layer =
      urlState.cellLayer !== undefined &&
      project.cellLayers.includes(urlState.cellLayer)
        ? urlState.cellLayer
        : previous.cellLayer !== null &&
            project.cellLayers.includes(previous.cellLayer)
          ? previous.cellLayer
          : project.mainCellLayer;
    if (layer !== null) {
      await openCellLayer(layer);
    } else {
      set({ cellLayerStatus: { phase: "idle" } });
    }
    for (const issue of project.issues) {
      if (issue.severity === "error") {
        notify("error", `${issue.subject}: ${issue.message}`);
      }
    }
  };

  const open = async (source: InSituSource) => {
    openAbort?.abort();
    const abort = new AbortController();
    openAbort = abort;
    get().loaders?.close();
    // captured before the URL is rewritten below
    pendingUrlState = readStateFromUrl();
    set({
      source,
      opened: null,
      experiment: null,
      project: null,
      cellLayer: null,
      loaders: null,
      legend: null,
      model: emptyViewerModel(),
      issues: [],
      sampleIndex: null,
      openStatus: { phase: "loading", message: `Opening ${source.label}` },
      projectStatus: { phase: "idle" },
      cellLayerStatus: { phase: "idle" },
    });
    try {
      const opened = await openSource(source, { signal: abort.signal });
      if (abort.signal.aborted) {
        return;
      }
      set({ opened, openStatus: { phase: "ready" } });
      writeStateToUrl(get());
      if (opened.kind === "project") {
        await showProject(opened.project, null);
      } else {
        set({ experiment: opened.experiment, issues: collectIssues() });
        opened.experiment
          .loadSampleInfo({ signal: abort.signal })
          .then(() => {
            if (!abort.signal.aborted) {
              set((s) => ({ sampleInfoVersion: s.sampleInfoVersion + 1 }));
            }
          })
          .catch(() => {});
        const sample = pendingUrlState?.sample;
        const index =
          sample !== undefined &&
          opened.experiment.samples.some((s) => s.index === sample)
            ? sample
            : null;
        if (index !== null) {
          await get().selectSample(index);
        } else {
          set({ sampleBrowserOpen: true });
        }
      }
    } catch (error) {
      if (abort.signal.aborted) {
        return;
      }
      set({ openStatus: { phase: "error", message: describeError(error) } });
    }
  };

  const updateTranscriptRegion = () => {
    const { viewport, transcriptTileSize, transcriptRegion, selection } = get();
    if (viewport === null || selection.transcripts.genes.length === 0) {
      return;
    }
    const t = transcriptTileSize;
    // snap to the tile grid with one tile of margin, so panning within the
    // loaded tiles costs nothing
    const x0 = (Math.floor(viewport.x / t) - 1) * t;
    const y0 = (Math.floor(viewport.y / t) - 1) * t;
    const x1 = (Math.ceil((viewport.x + viewport.width) / t) + 1) * t;
    const y1 = (Math.ceil((viewport.y + viewport.height) / t) + 1) * t;
    const region = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    if (
      transcriptRegion === null ||
      transcriptRegion.x !== region.x ||
      transcriptRegion.y !== region.y ||
      transcriptRegion.width !== region.width ||
      transcriptRegion.height !== region.height
    ) {
      set({ transcriptRegion: region });
      rebuild();
    }
  };

  return {
    source: null,
    opened: null,
    openStatus: { phase: "idle" },
    experiment: null,
    sampleIndex: null,
    project: null,
    projectStatus: { phase: "idle" },
    cellLayer: null,
    cellLayerStatus: { phase: "idle" },
    loaders: null,
    transcriptSource: null,
    transcriptTileSize: defaultTranscriptTileSize,
    selection: createDefaultSelection(),
    legend: null,
    legendStatus: { phase: "idle" },
    model: emptyViewerModel(),
    projectInstanceId: crypto.randomUUID(),
    viewport: null,
    containerWidth: 0,
    transcriptRegion: null,
    transcriptInfo: {},
    inspection: null,
    issues: [],
    notices: [],
    sampleBrowserOpen: false,
    transcriptGenes: [],
    transcriptIndexGenes: null,
    sampleInfoVersion: 0,

    openUrl: (url) => open(new URLSource(url)),
    openDirectory: (handle) => open(new DirectorySource(handle)),
    closeSource: () => {
      openAbort?.abort();
      get().loaders?.close();
      set({
        source: null,
        opened: null,
        experiment: null,
        project: null,
        cellLayer: null,
        loaders: null,
        legend: null,
        model: emptyViewerModel(),
        issues: [],
        sampleIndex: null,
        openStatus: { phase: "idle" },
        projectStatus: { phase: "idle" },
        cellLayerStatus: { phase: "idle" },
        selection: createDefaultSelection(),
      });
      writeStateToUrl(get());
    },
    selectSample: async (index) => {
      const { experiment } = get();
      if (experiment === null) {
        return;
      }
      sampleAbort?.abort();
      const abort = new AbortController();
      sampleAbort = abort;
      const sample = experiment.samples.find((s) => s.index === index);
      set({
        sampleIndex: index,
        projectStatus: {
          phase: "loading",
          message: `Opening sample ${sample?.name ?? index}`,
        },
        sampleBrowserOpen: false,
      });
      try {
        const project = await experiment.openSample(index, {
          signal: abort.signal,
        });
        if (abort.signal.aborted) {
          return;
        }
        await showProject(project, index);
      } catch (error) {
        if (abort.signal.aborted) {
          return;
        }
        set({
          projectStatus: { phase: "error", message: describeError(error) },
        });
        notify("error", `Could not open the sample: ${describeError(error)}`);
      }
    },
    setSampleBrowserOpen: (open) => set({ sampleBrowserOpen: open }),
    selectCellLayer: (key) => openCellLayer(key),
    setColorBy: (colorBy) => {
      updateSelection({ colorBy, range: null, hiddenCategories: [] });
      set({ legend: null });
      void loadLegend();
    },
    setMask: (mask) => updateSelection({ mask }),
    setFillOpacity: (fillOpacity) => updateSelection({ fillOpacity }),
    setOutlinesVisible: (outlinesVisible) =>
      updateSelection({ outlinesVisible }),
    setOutlines: (outlines) => updateSelection({ outlines }),
    setOutlineWidth: (outlineWidth) => updateSelection({ outlineWidth }),
    setOutlineOpacity: (outlineOpacity) => updateSelection({ outlineOpacity }),
    setPalette: (palette) => updateSelection({ palette }),
    setRange: (range) => updateSelection({ range }),
    toggleCategory: (category) => {
      const hidden = get().selection.hiddenCategories;
      updateSelection({
        hiddenCategories: hidden.includes(category)
          ? hidden.filter((c) => c !== category)
          : [...hidden, category],
      });
    },
    setCategoriesHidden: (hidden) => {
      const legend = get().legend;
      updateSelection({
        hiddenCategories:
          hidden && legend?.kind === "categorical"
            ? legend.categories.map((c) => c.name)
            : [],
      });
    },
    setImage: (name, settings) => {
      const images = get().selection.images;
      updateSelection({
        images: {
          ...images,
          [name]: { visible: true, opacity: 1, ...images[name], ...settings },
        },
      });
    },
    addTranscriptGene: (gene) => {
      const { transcripts } = get().selection;
      if (transcripts.genes.some((g) => g.gene === gene)) {
        return;
      }
      const used = new Set(transcripts.genes.map((g) => g.color));
      const color =
        transcriptColorCycle.find((c) => !used.has(c)) ??
        transcriptColorCycle[
          transcripts.genes.length % transcriptColorCycle.length
        ]!;
      updateSelection({
        transcripts: {
          ...transcripts,
          genes: [...transcripts.genes, { gene, color }],
        },
      });
      updateTranscriptRegion();
    },
    removeTranscriptGene: (gene) => {
      const { transcripts } = get().selection;
      updateSelection({
        transcripts: {
          ...transcripts,
          genes: transcripts.genes.filter((g) => g.gene !== gene),
        },
      });
      set((s) => {
        const info = { ...s.transcriptInfo };
        delete info[gene];
        return { transcriptInfo: info };
      });
    },
    setTranscriptColor: (gene, color) => {
      const { transcripts } = get().selection;
      updateSelection({
        transcripts: {
          ...transcripts,
          genes: transcripts.genes.map((g) =>
            g.gene === gene ? { ...g, color } : g,
          ),
        },
      });
    },
    setTranscriptPointSize: (pointSize) => {
      const { transcripts } = get().selection;
      updateSelection({ transcripts: { ...transcripts, pointSize } });
    },
    setTranscriptsVisible: (visible) => {
      const { transcripts } = get().selection;
      updateSelection({ transcripts: { ...transcripts, visible } });
    },
    toggleOverlay: (key) => {
      const overlays = get().selection.overlays;
      updateSelection({
        overlays: { ...overlays, [key]: overlays[key] !== true },
      });
    },
    setViewport: (viewport, containerWidth) => {
      set({ viewport, containerWidth });
      updateTranscriptRegion();
    },
    inspectAt: async (x, y) => {
      inspectAbort?.abort();
      const abort = new AbortController();
      inspectAbort = abort;
      const { cellLayer, selection, loaders, model, legend } = get();
      if (cellLayer === null || loaders === null) {
        return;
      }
      const mask = cellLayer.masks[selection.mask] ?? cellLayer.masks.cells;
      if (mask === undefined) {
        return;
      }
      set({
        inspection: {
          x,
          y,
          label: 0,
          cellName: null,
          values: [],
          status: "loading",
        },
      });
      try {
        const label = await mask.readLabel(x, y, { signal: abort.signal });
        if (abort.signal.aborted) {
          return;
        }
        if (label === 0) {
          set({
            inspection: {
              x,
              y,
              label: 0,
              cellName: null,
              values: [],
              status: "ready",
            },
          });
          return;
        }
        const labelIds = await cellLayer.table.loadLabelIds({
          signal: abort.signal,
        });
        let row = -1;
        if (mask.labelMapping.kind === "mapped") {
          row = mask.labelMapping.labelToRow[label] ?? -1;
        } else {
          row = labelIds.indexOf(label);
        }
        const cellNames = await cellLayer.table.loadCellNames({
          signal: abort.signal,
        });
        const values: { name: string; value: string }[] = [];
        if (row >= 0) {
          const table = model.tables.find((t) => t.id === cellTableId);
          const tableData =
            table !== undefined ? await loaders.loadTable(table) : undefined;
          if (tableData !== undefined) {
            const columns: { name: string; query: string }[] = [];
            if (selection.colorBy.kind === "gene") {
              const source = cellLayer.table.expressionSources.find(
                (s) =>
                  s.name === (selection.colorBy as { source: string }).source,
              );
              if (source !== undefined) {
                columns.push({
                  name: legend?.title ?? selection.colorBy.gene,
                  query: cellLayer.table.geneColumnQuery(
                    source,
                    selection.colorBy.gene,
                  ),
                });
              }
            }
            for (const column of cellLayer.table.obsColumns) {
              columns.push({
                name: column.name,
                query: cellLayer.table.obsColumnQuery(column.name),
              });
            }
            const loaded = await Promise.all(
              columns.map(async ({ name, query }) => {
                try {
                  const data = await loadColumnCached(tableData, query);
                  return { name, value: formatValue(data[row]) };
                } catch {
                  return { name, value: "?" };
                }
              }),
            );
            values.push(...loaded);
          }
        }
        if (abort.signal.aborted) {
          return;
        }
        set({
          inspection: {
            x,
            y,
            label,
            cellName: row >= 0 ? (cellNames[row] ?? null) : null,
            values,
            status: "ready",
          },
        });
      } catch (error) {
        if (abort.signal.aborted) {
          return;
        }
        set({ inspection: null });
        notify(
          "warning",
          `Could not inspect the cell: ${describeError(error)}`,
        );
      }
    },
    clearInspection: () => {
      inspectAbort?.abort();
      set({ inspection: null });
    },
    dismissNotice: (id) =>
      set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),
  };
});

const columnCache = new WeakMap<
  TableData,
  Map<string, Promise<ArrayLike<unknown>>>
>();

function loadColumnCached(
  tableData: TableData,
  query: string,
): Promise<ArrayLike<unknown>> {
  let cache = columnCache.get(tableData);
  if (cache === undefined) {
    cache = new Map();
    columnCache.set(tableData, cache);
  }
  let promise = cache.get(query);
  if (promise === undefined) {
    promise = tableData.loadValues<unknown>(query);
    promise.catch(() => cache.delete(query));
    cache.set(query, promise);
  }
  return promise;
}

function formatValue(value: unknown): string {
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return String(value);
    }
    return value.toPrecision(4);
  }
  switch (typeof value) {
    case "string":
      return value;
    case "boolean":
    case "bigint":
      return value.toString();
    case "undefined":
      return "";
    default:
      return JSON.stringify(value) ?? "";
  }
}

function validateColorBy(colorBy: ColorBy, cellLayer: CellLayer): ColorBy {
  const table = cellLayer.table;
  if (colorBy.kind === "gene") {
    const source =
      table.expressionSources.find((s) => s.name === colorBy.source) ??
      table.expressionSources[0];
    if (source === undefined || !table.genes.includes(colorBy.gene)) {
      return { kind: "none" };
    }
    return { kind: "gene", source: source.name, gene: colorBy.gene };
  }
  if (colorBy.kind === "obs") {
    return table.obsColumns.some((c) => c.name === colorBy.column)
      ? colorBy
      : { kind: "none" };
  }
  return colorBy;
}

/**
 * The full range and the automatic range of numeric values; the upper end of
 * the automatic range is the given percentile, so that a few extreme cells do
 * not wash out the colouring of all others
 */
export function computeRanges(
  values: ArrayLike<number>,
  percentile: number,
): { fullRange: [number, number]; autoRange: [number, number] } {
  const finite: number[] = [];
  let vmin = Infinity;
  let vmax = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]);
    if (Number.isFinite(v)) {
      finite.push(v);
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
  }
  if (finite.length === 0) {
    return { fullRange: [0, 1], autoRange: [0, 1] };
  }
  if (vmin === vmax) {
    return { fullRange: [vmin, vmax], autoRange: [vmin, vmin + 1] };
  }
  let high = vmax;
  if (percentile < 1) {
    finite.sort((a, b) => a - b);
    high =
      finite[
        Math.min(
          finite.length - 1,
          Math.floor(percentile * (finite.length - 1)),
        )
      ]!;
    if (!(high > vmin)) {
      high = vmax;
    }
  }
  return { fullRange: [vmin, vmax], autoRange: [vmin, high] };
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function getObsColumn(
  cellLayer: CellLayer | null,
  colorBy: ColorBy,
): ObsColumn | null {
  if (cellLayer === null || colorBy.kind !== "obs") {
    return null;
  }
  return (
    cellLayer.table.obsColumns.find((c) => c.name === colorBy.column) ?? null
  );
}
