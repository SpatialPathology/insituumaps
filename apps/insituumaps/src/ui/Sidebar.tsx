import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Palette,
  X,
} from "lucide-react";
import { useState } from "react";

import { continuousColorPalettes } from "@tissuumaps/core";

import type { ImageEntry } from "@/insitupy";
import { formatNumber } from "@/lib/utils";
import { getObsColumn, useAppStore } from "@/state/store";
import type { ImageSettings } from "@/viewer/selection";

import { GeneSearch } from "./GeneSearch";
import { CategoricalLegend, NumericLegend } from "./Legend";
import {
  Button,
  Hint,
  Label,
  Section,
  SegmentedControl,
  Select,
  Slider,
  Spinner,
  Switch,
  TextInput,
} from "./controls";

export function Sidebar() {
  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-zinc-200 bg-white">
      <SampleSection />
      <CellLayerSection />
      <ColorSection />
      <OutlineSection />
      <ImagesSection />
      <TranscriptsSection />
      <OverlaysSection />
      <IssuesSection />
    </aside>
  );
}

function SampleSection() {
  const experiment = useAppStore((s) => s.experiment);
  const sampleIndex = useAppStore((s) => s.sampleIndex);
  const selectSample = useAppStore((s) => s.selectSample);
  const setSampleBrowserOpen = useAppStore((s) => s.setSampleBrowserOpen);
  if (experiment === null) {
    return null;
  }
  return (
    <Section
      title="Sample"
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSampleBrowserOpen(true)}
        >
          Browse
        </Button>
      }
    >
      <Select
        value={sampleIndex !== null ? String(sampleIndex) : ""}
        onChange={(v) => v !== "" && void selectSample(Number(v))}
        options={[
          ...(sampleIndex === null
            ? [{ value: "", label: "Choose a sample", disabled: true }]
            : []),
          ...experiment.samples.map((s) => ({
            value: String(s.index),
            label: s.name === s.path ? s.path : `${s.name} (${s.path})`,
          })),
        ]}
      />
    </Section>
  );
}

function CellLayerSection() {
  const project = useAppStore((s) => s.project);
  const selection = useAppStore((s) => s.selection);
  const status = useAppStore((s) => s.cellLayerStatus);
  const selectCellLayer = useAppStore((s) => s.selectCellLayer);
  if (project === null) {
    return null;
  }
  if (project.cellLayers.length === 0) {
    return (
      <Section title="Cell layer">
        <Hint>This sample has no cell segmentation.</Hint>
      </Section>
    );
  }
  return (
    <Section
      title="Cell layer"
      actions={status.phase === "loading" ? <Spinner /> : undefined}
    >
      {project.cellLayers.length <= 3 ? (
        <SegmentedControl
          ariaLabel="Cell layer"
          value={selection.cellLayer ?? ""}
          onChange={(key) => void selectCellLayer(key)}
          options={project.cellLayers.map((key) => ({
            value: key,
            label: key === project.mainCellLayer ? `${key} (main)` : key,
          }))}
        />
      ) : (
        <Select
          value={selection.cellLayer ?? ""}
          onChange={(key) => void selectCellLayer(key)}
          options={project.cellLayers.map((key) => ({
            value: key,
            label: key === project.mainCellLayer ? `${key} (main)` : key,
          }))}
        />
      )}
      {status.phase === "error" && (
        <p className="mt-2 text-xs text-red-700">{status.message}</p>
      )}
    </Section>
  );
}

type ColorMode = "none" | "gene" | "obs";

function ColorSection() {
  const cellLayer = useAppStore((s) => s.cellLayer);
  const selection = useAppStore((s) => s.selection);
  const legend = useAppStore((s) => s.legend);
  const legendStatus = useAppStore((s) => s.legendStatus);
  const experiment = useAppStore((s) => s.experiment);
  const setColorBy = useAppStore((s) => s.setColorBy);
  const setPalette = useAppStore((s) => s.setPalette);
  const setRange = useAppStore((s) => s.setRange);
  const toggleCategory = useAppStore((s) => s.toggleCategory);
  const setCategoriesHidden = useAppStore((s) => s.setCategoriesHidden);
  const [mode, setMode] = useState<ColorMode>(selection.colorBy.kind);
  const [lastGene, setLastGene] = useState<string | null>(
    selection.colorBy.kind === "gene" ? selection.colorBy.gene : null,
  );
  const [lastSource, setLastSource] = useState<string | null>(
    selection.colorBy.kind === "gene" ? selection.colorBy.source : null,
  );
  const [lastColumn, setLastColumn] = useState<string | null>(
    selection.colorBy.kind === "obs" ? selection.colorBy.column : null,
  );
  // follow the store when a sample switch or a link changes the colouring
  const storeMode = selection.colorBy.kind;
  const [seenMode, setSeenMode] = useState(storeMode);
  if (storeMode !== seenMode) {
    setSeenMode(storeMode);
    setMode(storeMode);
    if (selection.colorBy.kind === "gene") {
      setLastGene(selection.colorBy.gene);
      setLastSource(selection.colorBy.source);
    } else if (selection.colorBy.kind === "obs") {
      setLastColumn(selection.colorBy.column);
    }
  }

  if (cellLayer === null) {
    return null;
  }
  const table = cellLayer.table;
  const sources = table.expressionSources;
  const activeSource =
    (selection.colorBy.kind === "gene"
      ? selection.colorBy.source
      : lastSource) ??
    sources[0]?.name ??
    null;
  const activeGene =
    selection.colorBy.kind === "gene" ? selection.colorBy.gene : lastGene;
  const activeColumn =
    selection.colorBy.kind === "obs" ? selection.colorBy.column : lastColumn;
  const obsColumn = getObsColumn(cellLayer, selection.colorBy);

  const changeMode = (next: ColorMode) => {
    setMode(next);
    if (next === "none") {
      setColorBy({ kind: "none" });
    } else if (next === "gene") {
      if (
        activeGene !== null &&
        activeSource !== null &&
        table.genes.includes(activeGene)
      ) {
        setColorBy({ kind: "gene", source: activeSource, gene: activeGene });
      } else {
        setColorBy({ kind: "none" });
      }
    } else if (next === "obs") {
      const column = activeColumn ?? table.obsColumns[0]?.name ?? null;
      if (column !== null) {
        setLastColumn(column);
        setColorBy({ kind: "obs", column });
      }
    }
  };

  const range: [number, number] | null =
    selection.range ?? (legend?.kind === "numeric" ? legend.autoRange : null);

  return (
    <Section
      title="Colour cells by"
      actions={legendStatus.phase === "loading" ? <Spinner /> : undefined}
    >
      <SegmentedControl<ColorMode>
        ariaLabel="Colour by"
        value={mode}
        onChange={changeMode}
        options={[
          { value: "gene", label: "Gene", disabled: sources.length === 0 },
          {
            value: "obs",
            label: "Cell property",
            disabled: table.obsColumns.length === 0,
          },
          { value: "none", label: "None" },
        ]}
      />
      {mode === "gene" && (
        <div className="mt-3 space-y-2">
          {sources.length > 1 ? (
            <div>
              <Label htmlFor="expression-source">Expression values</Label>
              <Select
                id="expression-source"
                value={activeSource ?? ""}
                onChange={(name) => {
                  setLastSource(name);
                  if (activeGene !== null) {
                    setColorBy({
                      kind: "gene",
                      source: name,
                      gene: activeGene,
                    });
                  }
                }}
                options={sources.map((s) => ({
                  value: s.name,
                  label: s.name === "X" ? "X (normalised)" : s.name,
                }))}
              />
            </div>
          ) : (
            sources.length === 1 && (
              <Hint>
                Expression values: {sources[0]!.name}
                {sources[0]!.name === "X" &&
                  " (the AnnData .X matrix; layers such as counts are not in the viewer table)"}
              </Hint>
            )
          )}
          <div>
            <Label>Gene</Label>
            <GeneSearch
              genes={table.genes}
              value={activeGene}
              onSelect={(gene) => {
                setLastGene(gene);
                if (activeSource !== null) {
                  setColorBy({ kind: "gene", source: activeSource, gene });
                }
              }}
            />
            <Hint>
              {table.genes.length.toLocaleString()} genes. Type to search, Enter
              to select.
            </Hint>
          </div>
        </div>
      )}
      {mode === "obs" && (
        <div className="mt-3">
          <Label htmlFor="obs-column">Property</Label>
          <Select
            id="obs-column"
            value={activeColumn ?? ""}
            onChange={(column) => {
              setLastColumn(column);
              setColorBy({ kind: "obs", column });
            }}
            options={table.obsColumns.map((c) => ({
              value: c.name,
              label: c.kind === "numeric" ? c.name : `${c.name} (categories)`,
            }))}
          />
        </div>
      )}
      {legendStatus.phase === "error" && (
        <p className="mt-2 text-xs text-red-700">{legendStatus.message}</p>
      )}
      {legend !== null && legend.kind === "numeric" && range !== null && (
        <div className="mt-3 space-y-2">
          <NumericLegend
            title={legend.title}
            palette={selection.palette}
            range={range}
            note={
              selection.mask === "nuclei"
                ? "Nucleus outlines show the value of the cell they belong to."
                : undefined
            }
          />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="range-min">Min</Label>
              <RangeInput
                id="range-min"
                value={range[0]}
                onCommit={(v) => setRange([v, range[1]])}
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="range-max">Max</Label>
              <RangeInput
                id="range-max"
                value={range[1]}
                onCommit={(v) => setRange([range[0], v])}
              />
            </div>
            <Button
              variant="ghost"
              onClick={() => setRange(null)}
              disabled={selection.range === null}
              title={`Reset to the automatic range (${formatNumber(legend.autoRange[0])} to ${formatNumber(legend.autoRange[1])}; data range ${formatNumber(legend.fullRange[0])} to ${formatNumber(legend.fullRange[1])})`}
            >
              Auto
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Palette className="size-4 text-zinc-500" />
            <Select
              value={selection.palette}
              onChange={setPalette}
              options={continuousColorPalettes.map((p) => ({
                value: p.id,
                label: p.name,
              }))}
              className="flex-1"
            />
          </div>
        </div>
      )}
      {legend !== null && legend.kind === "categorical" && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-700">
              {legend.title}: {legend.categories.length} categories
            </span>
            <span className="flex gap-1">
              <Button
                variant="ghost"
                onClick={() => setCategoriesHidden(false)}
              >
                All
              </Button>
              <Button variant="ghost" onClick={() => setCategoriesHidden(true)}>
                None
              </Button>
            </span>
          </div>
          <CategoricalLegend
            categories={legend.categories}
            hidden={selection.hiddenCategories}
            presetColors={
              obsColumn !== null
                ? experiment?.colors[obsColumn.name]
                : undefined
            }
            onToggle={toggleCategory}
          />
          {selection.mask === "nuclei" && (
            <Hint>
              Nucleus outlines show the category of the cell they belong to.
            </Hint>
          )}
        </div>
      )}
    </Section>
  );
}

function RangeInput({
  id,
  value,
  onCommit,
}: {
  id: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(formatNumber(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(formatNumber(value));
  }
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v !== value) {
      onCommit(v);
    } else {
      setText(formatNumber(value));
    }
  };
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
        }
      }}
      className="h-8 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm shadow-xs focus:border-sky-500 focus:ring-2 focus:ring-sky-200 focus:outline-none"
    />
  );
}

function OutlineSection() {
  const cellLayer = useAppStore((s) => s.cellLayer);
  const selection = useAppStore((s) => s.selection);
  const setMask = useAppStore((s) => s.setMask);
  const setMaskStyle = useAppStore((s) => s.setMaskStyle);
  const setOutlineWidth = useAppStore((s) => s.setOutlineWidth);
  const setMaskOpacity = useAppStore((s) => s.setMaskOpacity);
  const setMaskVisible = useAppStore((s) => s.setMaskVisible);
  if (cellLayer === null) {
    return null;
  }
  const { cells, nuclei } = cellLayer.masks;
  if (cells === undefined && nuclei === undefined) {
    return null;
  }
  return (
    <Section
      title="Outlines"
      actions={
        <Switch checked={selection.maskVisible} onChange={setMaskVisible} />
      }
    >
      <div className="space-y-3">
        <div>
          <Label>Draw values on</Label>
          <SegmentedControl<"cells" | "nuclei">
            ariaLabel="Draw values on"
            value={selection.mask}
            onChange={setMask}
            options={[
              {
                value: "cells",
                label: "Cell boundaries",
                disabled: cells === undefined,
                title:
                  cells === undefined
                    ? "This layer has no cell mask"
                    : undefined,
              },
              {
                value: "nuclei",
                label: "Nucleus boundaries",
                disabled: nuclei === undefined,
                title:
                  nuclei === undefined
                    ? "This layer has no nucleus mask"
                    : undefined,
              },
            ]}
          />
        </div>
        <div>
          <Label>Style</Label>
          <SegmentedControl<"outline" | "fill">
            ariaLabel="Style"
            value={selection.maskStyle}
            onChange={setMaskStyle}
            options={[
              { value: "outline", label: "Outline" },
              { value: "fill", label: "Filled" },
            ]}
          />
        </div>
        {selection.maskStyle === "outline" ? (
          <div>
            <Label>Line width: {selection.outlineWidth} px</Label>
            <Slider
              ariaLabel="Outline width"
              min={1}
              max={4}
              step={1}
              value={selection.outlineWidth}
              onChange={setOutlineWidth}
            />
          </div>
        ) : (
          <div>
            <Label>Opacity: {Math.round(selection.maskOpacity * 100)}%</Label>
            <Slider
              ariaLabel="Fill opacity"
              min={0.1}
              max={1}
              step={0.05}
              value={selection.maskOpacity}
              onChange={setMaskOpacity}
            />
          </div>
        )}
      </div>
    </Section>
  );
}

function ImagesSection() {
  const project = useAppStore((s) => s.project);
  const selection = useAppStore((s) => s.selection);
  const setImage = useAppStore((s) => s.setImage);
  if (project === null || project.images.length === 0) {
    return null;
  }
  return (
    <Section title="Images">
      <ul className="space-y-2">
        {project.images.map((image) => {
          const settings = selection.images[image.name] ?? {
            visible: true,
            opacity: 1,
          };
          return (
            <li key={image.name}>
              <div className="flex items-center justify-between">
                <Switch
                  checked={settings.visible}
                  onChange={(visible) => setImage(image.name, { visible })}
                  label={
                    <span>
                      {image.name}
                      <span className="ml-1 text-xs text-zinc-400">
                        {image.rgb ? "RGB" : "grayscale"}
                      </span>
                    </span>
                  }
                />
                <span className="w-10 text-right text-xs text-zinc-400">
                  {Math.round(settings.opacity * 100)}%
                </span>
              </div>
              {settings.visible && (
                <Slider
                  ariaLabel={`${image.name} opacity`}
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.opacity}
                  onChange={(opacity) => setImage(image.name, { opacity })}
                  className="mt-1"
                />
              )}
              {settings.visible && !image.rgb && (
                <GrayscaleControls image={image} settings={settings} />
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function GrayscaleControls({
  image,
  settings,
}: {
  image: ImageEntry;
  settings: ImageSettings;
}) {
  const setImage = useAppStore((s) => s.setImage);
  const max =
    image.dtypeMax ??
    (image.window !== undefined ? image.window[1] * 4 : 65535);
  const [black, white] = settings.contrast ?? image.window ?? [0, max];
  return (
    <div className="mt-1 space-y-1 pl-1">
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`Colour of ${image.name}`}
          value={settings.color ?? "#ffffff"}
          onChange={(e) => setImage(image.name, { color: e.target.value })}
          className="size-6 cursor-pointer rounded border border-zinc-300 bg-transparent p-0"
        />
        <span className="text-xs text-zinc-500">
          Levels {formatNumber(black)} to {formatNumber(white)}
        </span>
        <button
          type="button"
          onClick={() =>
            setImage(image.name, { contrast: undefined, color: undefined })
          }
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-800"
        >
          Reset
        </button>
      </div>
      <Slider
        ariaLabel={`${image.name} black level`}
        min={0}
        max={max}
        step={Math.max(1, Math.round(max / 1000))}
        value={black}
        onChange={(v) =>
          setImage(image.name, { contrast: [Math.min(v, white - 1), white] })
        }
      />
      <Slider
        ariaLabel={`${image.name} white level`}
        min={1}
        max={max}
        step={Math.max(1, Math.round(max / 1000))}
        value={white}
        onChange={(v) =>
          setImage(image.name, { contrast: [black, Math.max(v, black + 1)] })
        }
      />
    </div>
  );
}

function TranscriptsSection() {
  const project = useAppStore((s) => s.project);
  const selection = useAppStore((s) => s.selection);
  const genes = useAppStore((s) => s.transcriptGenes);
  const info = useAppStore((s) => s.transcriptInfo);
  const transcriptSource = useAppStore((s) => s.transcriptSource);
  const addGene = useAppStore((s) => s.addTranscriptGene);
  const removeGene = useAppStore((s) => s.removeTranscriptGene);
  const setColor = useAppStore((s) => s.setTranscriptColor);
  const setPointSize = useAppStore((s) => s.setTranscriptPointSize);
  const setVisible = useAppStore((s) => s.setTranscriptsVisible);
  if (project === null || project.transcripts === null) {
    return null;
  }
  const { transcripts } = selection;
  const hasIndex = transcriptSource?.hasIndex ?? false;
  return (
    <Section
      title="Transcripts"
      actions={<Switch checked={transcripts.visible} onChange={setVisible} />}
    >
      <GeneSearch
        genes={genes}
        value={null}
        onSelect={addGene}
        placeholder="Add a gene"
        clearOnSelect
      />
      {!hasIndex && (
        <Hint>
          No transcript index: the whole Parquet file is read once, which is
          slow for large samples. Run the InSitUUmaps converter to add the
          index.
        </Hint>
      )}
      {transcripts.genes.length > 0 && (
        <>
          <ul className="mt-2 space-y-1">
            {transcripts.genes.map(({ gene, color }) => {
              const geneInfo = info[gene];
              return (
                <li key={gene} className="flex items-center gap-2 text-sm">
                  <input
                    type="color"
                    aria-label={`Colour of ${gene}`}
                    value={color}
                    onChange={(e) => setColor(gene, e.target.value)}
                    className="size-6 cursor-pointer rounded border border-zinc-300 bg-transparent p-0"
                  />
                  <span className="flex-1 truncate">{gene}</span>
                  {geneInfo !== undefined && (
                    <span
                      className="text-xs text-zinc-400"
                      title={
                        geneInfo.subsampled
                          ? `Showing ${geneInfo.loaded.toLocaleString()} of ${geneInfo.total.toLocaleString()} points in view (subsampled)`
                          : `${geneInfo.loaded.toLocaleString()} points in view`
                      }
                    >
                      {geneInfo.loaded.toLocaleString()}
                      {geneInfo.subsampled && "*"}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${gene}`}
                    onClick={() => removeGene(gene)}
                    className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2">
            <Label>Point size: {transcripts.pointSize} µm</Label>
            <Slider
              ariaLabel="Transcript point size"
              min={0.25}
              max={5}
              step={0.25}
              value={transcripts.pointSize}
              onChange={setPointSize}
            />
          </div>
          <Hint>
            Only the genes above and only the area in view are loaded.
          </Hint>
        </>
      )}
    </Section>
  );
}

function OverlaysSection() {
  const project = useAppStore((s) => s.project);
  const selection = useAppStore((s) => s.selection);
  const toggleOverlay = useAppStore((s) => s.toggleOverlay);
  if (project === null) {
    return null;
  }
  const entries = [...project.annotations, ...project.regions];
  if (entries.length === 0) {
    return null;
  }
  return (
    <Section title="Annotations and regions">
      <ul className="space-y-1">
        {entries.map((entry) => {
          const key = `${entry.kind}:${entry.key}`;
          return (
            <li key={key}>
              <Switch
                checked={selection.overlays[key] === true}
                onChange={() => toggleOverlay(key)}
                label={
                  <span>
                    {entry.key}
                    <span className="ml-1 text-xs text-zinc-400">
                      {entry.kind}
                    </span>
                  </span>
                }
              />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function IssuesSection() {
  const issues = useAppStore((s) => s.issues);
  const [open, setOpen] = useState(false);
  if (issues.length === 0) {
    return null;
  }
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  return (
    <Section
      title="Data notes"
      actions={
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800"
        >
          {errors > 0 && <AlertTriangle className="size-3.5 text-red-600" />}
          {issues.length}{" "}
          {warnings + errors > 0 ? `(${warnings + errors} to check)` : ""}
          {open ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </button>
      }
      className="border-b-0"
    >
      {open && (
        <ul className="space-y-2 text-xs">
          {issues.map((issue, i) => (
            <li
              key={i}
              className={
                issue.severity === "error"
                  ? "text-red-700"
                  : issue.severity === "warning"
                    ? "text-amber-700"
                    : "text-zinc-600"
              }
            >
              <span className="font-medium">{issue.subject}: </span>
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export { TextInput };
