import { Home } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type InteractionMode, projectDefaults } from "@tissuumaps/core";
import { Viewer, type ViewerAdapter } from "@tissuumaps/react";
import type { OpenSeadragonContext } from "@tissuumaps/render";

import { formatLength } from "@/lib/utils";
import { useAppStore } from "@/state/store";

import { Spinner } from "./controls";

const backgroundColor = { r: 20, g: 20, b: 24 };
const osOptions = {
  ...projectDefaults.osOptions,
  viewerOptions: {
    ...projectDefaults.osOptions.viewerOptions,
    showNavigator: true,
    navigatorPosition: "BOTTOM_RIGHT" as const,
    navigatorSizeRatio: 0.15,
  },
};
const glOptions = {
  ...projectDefaults.glOptions,
  shapesRenderOptions: {
    ...projectDefaults.glOptions.shapesRenderOptions,
    strokeWidth: 2,
  },
};

export function ViewerPanel() {
  const model = useAppStore((s) => s.model);
  const loaders = useAppStore((s) => s.loaders);
  const projectInstanceId = useAppStore((s) => s.projectInstanceId);
  const setViewport = useAppStore((s) => s.setViewport);
  const inspectAt = useAppStore((s) => s.inspectAt);
  const clearInspection = useAppStore((s) => s.clearInspection);
  const viewerRef = useRef<OpenSeadragonContext>(null);
  const [osContext, setOSContext] = useState<OpenSeadragonContext | null>(null);
  const [scale, setScale] = useState<{ umPerPixel: number } | null>(null);

  const setViewerRef = useCallback((context: OpenSeadragonContext | null) => {
    viewerRef.current = context;
    setOSContext(context);
  }, []);

  const adapter: ViewerAdapter | null = useMemo(() => {
    if (loaders === null) {
      return null;
    }
    return {
      projectInstanceId,
      layers: model.layers,
      images: model.images,
      labels: model.labels,
      points: model.points,
      shapes: model.shapes,
      tables: model.tables,
      markerMaps: [],
      sizeMaps: [],
      colorMaps: model.colorMaps,
      visibilityMaps: model.visibilityMaps,
      opacityMaps: [],
      osOptions,
      glOptions,
      loadImage: loaders.loadImage,
      loadLabels: loaders.loadLabels,
      loadPoints: loaders.loadPoints,
      loadShapes: loaders.loadShapes,
      loadTable: loaders.loadTable,
      interactionMode: "pan" as InteractionMode,
    };
  }, [loaders, model, projectInstanceId]);

  // viewport in µm and scale bar
  useEffect(() => {
    if (osContext === null) {
      return;
    }
    const viewer = osContext.viewer;
    const update = () => {
      const bounds = viewer.viewport.getBounds(true);
      const container = viewer.viewport.getContainerSize();
      if (container.x > 0) {
        setViewport(
          {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          },
          container.x,
        );
        setScale({ umPerPixel: bounds.width / container.x });
      }
    };
    update();
    viewer.addHandler("viewport-change", update);
    viewer.addHandler("resize", update);
    const onClick = (event: OpenSeadragon.CanvasClickEvent) => {
      if (!event.quick) {
        return;
      }
      const point = viewer.viewport.pointFromPixel(event.position, true);
      void inspectAt(point.x, point.y);
    };
    viewer.addHandler("canvas-click", onClick);
    return () => {
      viewer.removeHandler("viewport-change", update);
      viewer.removeHandler("resize", update);
      viewer.removeHandler("canvas-click", onClick);
    };
  }, [osContext, setViewport, inspectAt]);

  if (adapter === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-zinc-500">
        <Spinner />
      </div>
    );
  }
  return (
    <div className="relative min-w-0 flex-1">
      <Viewer
        ref={setViewerRef}
        adapter={adapter}
        backgroundColor={backgroundColor}
        className="insituumaps-viewer absolute inset-0"
      />
      <div className="pointer-events-none absolute inset-0">
        <button
          type="button"
          title="Show the whole sample"
          onClick={() => viewerRef.current?.resetViewport()}
          className="pointer-events-auto absolute top-2 left-2 rounded-md bg-white/90 p-1.5 text-zinc-700 shadow hover:bg-white"
        >
          <Home className="size-4" />
        </button>
        {scale !== null && <ScaleBar umPerPixel={scale.umPerPixel} />}
        <Inspector onClose={clearInspection} />
        <LoadingBadge />
      </div>
    </div>
  );
}

const niceLengths = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000,
];

function ScaleBar({ umPerPixel }: { umPerPixel: number }) {
  if (!(umPerPixel > 0)) {
    return null;
  }
  const targetPx = 120;
  const targetUm = targetPx * umPerPixel;
  const length = niceLengths.reduce(
    (best, candidate) =>
      Math.abs(candidate - targetUm) < Math.abs(best - targetUm)
        ? candidate
        : best,
    niceLengths[0]!,
  );
  const px = length / umPerPixel;
  return (
    <div className="absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-xs text-white">
      <div
        className="h-1 border-x border-b-2 border-white"
        style={{ width: `${px}px` }}
      />
      <div className="mt-0.5 text-center">{formatLength(length)}</div>
    </div>
  );
}

function Inspector({ onClose }: { onClose: () => void }) {
  const inspection = useAppStore((s) => s.inspection);
  if (inspection === null) {
    return null;
  }
  return (
    <div className="pointer-events-auto absolute top-2 right-2 w-64 rounded-md border border-zinc-200 bg-white/95 p-3 text-sm shadow-lg">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium">
          {inspection.status === "loading"
            ? "Reading cell"
            : inspection.label === 0
              ? "No cell here"
              : `Cell ${inspection.cellName ?? inspection.label}`}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-zinc-500 hover:text-zinc-800"
        >
          Close
        </button>
      </div>
      <div className="text-xs text-zinc-500">
        x {inspection.x.toFixed(1)} µm, y {inspection.y.toFixed(1)} µm
        {inspection.label !== 0 && ` (label ${inspection.label})`}
      </div>
      {inspection.status === "loading" && <Spinner className="mt-2" />}
      {inspection.values.length > 0 && (
        <table className="mt-2 w-full text-xs">
          <tbody>
            {inspection.values.map((v) => (
              <tr key={v.name} className="border-t border-zinc-100">
                <td className="py-0.5 pr-2 text-zinc-600">{v.name}</td>
                <td className="py-0.5 text-right font-mono">{v.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function LoadingBadge() {
  const cellLayerStatus = useAppStore((s) => s.cellLayerStatus);
  const legendStatus = useAppStore((s) => s.legendStatus);
  const busy = [cellLayerStatus, legendStatus].find(
    (s) => s.phase === "loading",
  );
  if (busy === undefined || busy.phase !== "loading") {
    return null;
  }
  return (
    <div className="absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
      <Spinner className="border-white border-t-transparent" /> {busy.message}
    </div>
  );
}
