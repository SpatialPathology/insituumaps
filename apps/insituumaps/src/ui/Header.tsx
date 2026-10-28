import { FolderOpen, LayoutGrid, X } from "lucide-react";

import { useAppStore } from "@/state/store";

import { Wordmark } from "./Wordmark";
import { Button, Spinner } from "./controls";

export function Header() {
  const source = useAppStore((s) => s.source);
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

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-3">
      <div className="shrink-0 text-base leading-none">
        <Wordmark />
      </div>
      {source !== null && (
        <>
          <span className="text-zinc-300">|</span>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            {experiment !== null && (
              <Button
                variant="ghost"
                onClick={() => setSampleBrowserOpen(true)}
                title="Browse the samples of this experiment"
              >
                <LayoutGrid className="size-4" />
                {experiment.name || "Experiment"}
              </Button>
            )}
            {project !== null && (
              <span
                className="truncate font-medium text-zinc-800"
                title={project.source.label}
              >
                {sample?.name ?? project.sampleId ?? project.source.label}
                {project.slideId !== "" && (
                  <span className="ml-1 font-normal text-zinc-500">
                    slide {project.slideId}
                  </span>
                )}
              </span>
            )}
          </div>
          {busy !== undefined && busy.phase === "loading" && (
            <span className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Spinner /> {busy.message}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              onClick={closeSource}
              title="Close and open another project or experiment"
            >
              <FolderOpen className="size-4" /> Open
            </Button>
            <Button variant="ghost" onClick={closeSource} title="Close">
              <X className="size-4" />
            </Button>
          </div>
        </>
      )}
    </header>
  );
}
