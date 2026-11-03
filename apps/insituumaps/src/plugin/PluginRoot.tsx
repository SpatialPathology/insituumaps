/**
 * The user interface of the TissUUmaps plugin: the start screen while nothing
 * is open, and the sidebar sections of the open sample once it is
 *
 * The app's viewer draws the sample (see `bridge.ts`), so the standalone app's
 * header and viewer panel are not used. The sample browser and the notices
 * cover the whole window rather than the narrow panel, through portals into
 * the document body.
 */
import { LayoutGrid, X } from "lucide-react";
import { createPortal } from "react-dom";

import { useAppStore } from "@/state/store";
import { Notices } from "@/ui/Notices";
import { SampleBrowser } from "@/ui/SampleBrowser";
import { CellLayerSection, ColorSection, SampleSection } from "@/ui/Sidebar";
import { StartScreen } from "@/ui/StartScreen";
import { Button, Spinner } from "@/ui/controls";

/** The bar above the sections: what is open, what is loading, and closing */
function PluginHeader() {
  const experiment = useAppStore((s) => s.experiment);
  const project = useAppStore((s) => s.project);
  const sampleIndex = useAppStore((s) => s.sampleIndex);
  const projectStatus = useAppStore((s) => s.projectStatus);
  const cellLayerStatus = useAppStore((s) => s.cellLayerStatus);
  const legendStatus = useAppStore((s) => s.legendStatus);
  const setSampleBrowserOpen = useAppStore((s) => s.setSampleBrowserOpen);
  const closeSource = useAppStore((s) => s.closeSource);

  const sample = experiment?.samples.find((s) => s.index === sampleIndex);
  const busy = [projectStatus, cellLayerStatus, legendStatus].find(
    (s) => s.phase === "loading",
  );
  const title =
    sample?.name ?? project?.sampleId ?? experiment?.name ?? "InSituPy";

  return (
    <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{title}</div>
        {project !== null && (
          <div className="truncate text-xs text-zinc-500">
            slide {project.slideId}
          </div>
        )}
      </div>
      {busy !== undefined && <Spinner />}
      {experiment !== null && (
        <Button
          variant="ghost"
          onClick={() => setSampleBrowserOpen(true)}
          title="Browse the samples of this experiment"
        >
          <LayoutGrid className="size-4" />
        </Button>
      )}
      <Button variant="ghost" onClick={closeSource} title="Close the dataset">
        <X className="size-4" />
      </Button>
    </div>
  );
}

/** The overlays drawn above the whole window rather than within the panel */
function WindowOverlays() {
  const sampleBrowserOpen = useAppStore((s) => s.sampleBrowserOpen);
  const experiment = useAppStore((s) => s.experiment);
  return createPortal(
    <>
      {sampleBrowserOpen && experiment !== null && (
        <div className="insitupy-plugin fixed inset-0 z-50 bg-transparent">
          <SampleBrowser />
        </div>
      )}
      <div className="insitupy-plugin pointer-events-none fixed inset-0 z-50 bg-transparent">
        <Notices />
      </div>
    </>,
    document.body,
  );
}

/** The root component of the plugin's panel */
export function PluginRoot() {
  const source = useAppStore((s) => s.source);
  const openStatus = useAppStore((s) => s.openStatus);
  const project = useAppStore((s) => s.project);

  // as in the standalone app (App.tsx)
  const showStart =
    source === null ||
    openStatus.phase === "error" ||
    (project === null && openStatus.phase !== "ready");

  return (
    <div className="insitupy-plugin flex min-h-full flex-col text-sm">
      {showStart ? (
        <StartScreen />
      ) : (
        <>
          <PluginHeader />
          <SampleSection />
          <CellLayerSection />
          <ColorSection />
        </>
      )}
      <WindowOverlays />
    </div>
  );
}
