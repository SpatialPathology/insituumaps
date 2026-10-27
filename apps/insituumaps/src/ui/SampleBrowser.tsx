import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/state/store";

import { Button, TextInput } from "./controls";

type SortState = { column: string; direction: "asc" | "desc" } | null;

type Cell = string | number | boolean | null | undefined;

function compareValues(a: Cell, b: Cell): number {
  if (a === null || a === undefined)
    return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function SampleBrowser() {
  const experiment = useAppStore((s) => s.experiment);
  const open = useAppStore((s) => s.sampleBrowserOpen);
  const sampleIndex = useAppStore((s) => s.sampleIndex);
  const project = useAppStore((s) => s.project);
  const setOpen = useAppStore((s) => s.setSampleBrowserOpen);
  const selectSample = useAppStore((s) => s.selectSample);
  const sampleInfoVersion = useAppStore((s) => s.sampleInfoVersion);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState>(null);

  const rows = useMemo(() => {
    if (experiment === null) {
      return [];
    }
    const q = filter.trim().toLowerCase();
    let filtered = experiment.samples;
    if (q !== "") {
      filtered = filtered.filter((sample) =>
        [sample.name, sample.path, ...Object.values(sample.metadata)].some(
          (v) => v !== null && String(v).toLowerCase().includes(q),
        ),
      );
    }
    if (sort !== null) {
      const { column, direction } = sort;
      filtered = filtered.toSorted((a, b) => {
        const av =
          column === "__name"
            ? a.name
            : column === "__path"
              ? a.path
              : a.metadata[column];
        const bv =
          column === "__name"
            ? b.name
            : column === "__path"
              ? b.path
              : b.metadata[column];
        const c = compareValues(av, bv);
        return direction === "asc" ? c : -c;
      });
    }
    return filtered;
    // sampleInfoVersion: the sample ids arrive after the experiment opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experiment, filter, sort, sampleInfoVersion]);

  if (experiment === null || !open) {
    return null;
  }
  const columns = experiment.metadata.columns;
  const toggleSort = (column: string) =>
    setSort((s) =>
      s?.column === column
        ? s.direction === "asc"
          ? { column, direction: "desc" }
          : null
        : { column, direction: "asc" },
    );

  return (
    <div
      className="absolute inset-0 z-20 flex items-start justify-center bg-black/30 p-6"
      onClick={() => project !== null && setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Samples"
        className="flex max-h-full w-full max-w-5xl flex-col rounded-xl border border-zinc-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3">
          <h2 className="text-base font-semibold">
            {experiment.name || "Experiment"}: {experiment.samples.length}{" "}
            samples
          </h2>
          <div className="relative ml-auto w-64">
            <Search className="pointer-events-none absolute top-2 left-2 size-4 text-zinc-400" />
            <TextInput
              value={filter}
              onChange={setFilter}
              placeholder="Filter samples"
              ariaLabel="Filter samples"
              className="pl-8"
              autoFocus
            />
          </div>
          {project !== null && (
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              title="Close"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
        <div className="min-h-0 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-left text-xs text-zinc-600">
              <tr>
                <th
                  className="cursor-pointer px-3 py-2 font-medium select-none"
                  onClick={() => toggleSort("__path")}
                >
                  Folder <SortIcon sort={sort} column="__path" />
                </th>
                <th
                  className="cursor-pointer px-3 py-2 font-medium select-none"
                  onClick={() => toggleSort("__name")}
                >
                  Sample <SortIcon sort={sort} column="__name" />
                </th>
                {columns.map((column) => (
                  <th
                    key={column}
                    className="cursor-pointer px-3 py-2 font-medium select-none"
                    onClick={() => toggleSort(column)}
                  >
                    {column} <SortIcon sort={sort} column={column} />
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((sample) => (
                <tr
                  key={sample.index}
                  className={cn(
                    "cursor-pointer border-t border-zinc-100 hover:bg-sky-50",
                    sample.index === sampleIndex && "bg-sky-100",
                  )}
                  onClick={() => void selectSample(sample.index)}
                >
                  <td className="px-3 py-1.5 font-mono text-xs text-zinc-500">
                    {sample.path}
                  </td>
                  <td className="px-3 py-1.5 font-medium">
                    {sample.name === sample.path ? "" : sample.name}
                  </td>
                  {columns.map((column) => (
                    <td key={column} className="px-3 py-1.5 whitespace-nowrap">
                      {String(sample.metadata[column] ?? "")}
                    </td>
                  ))}
                  <td
                    className="px-3 py-1.5 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant={
                        sample.index === sampleIndex ? "default" : "primary"
                      }
                      onClick={() => void selectSample(sample.index)}
                    >
                      {sample.index === sampleIndex ? "Shown" : "Open"}
                    </Button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length + 3}
                    className="px-3 py-6 text-center text-zinc-500"
                  >
                    No sample matches the filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SortIcon({ sort, column }: { sort: SortState; column: string }) {
  if (sort?.column !== column) {
    return null;
  }
  return sort.direction === "asc" ? (
    <ArrowUp className="ml-1 inline size-3" />
  ) : (
    <ArrowDown className="ml-1 inline size-3" />
  );
}
