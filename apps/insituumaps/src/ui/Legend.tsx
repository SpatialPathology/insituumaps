import { ColorUtils } from "@tissuumaps/core";

import { formatNumber } from "@/lib/utils";
import { categoryColor } from "@/viewer/model";

import { paletteGradient } from "./paletteGradient";

export function NumericLegend({
  title,
  palette,
  range,
  note,
}: {
  title: string;
  palette: string;
  range: [number, number];
  note?: string;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-zinc-700">{title}</div>
      <div
        className="h-3 w-full rounded-sm border border-zinc-300"
        style={{ background: paletteGradient(palette) }}
      />
      <div className="mt-0.5 flex justify-between text-xs text-zinc-600">
        <span>{formatNumber(range[0])}</span>
        <span>{formatNumber(range[1])}</span>
      </div>
      {note !== undefined && (
        <p className="mt-1 text-xs text-zinc-500">{note}</p>
      )}
    </div>
  );
}

export function CategoricalLegend({
  categories,
  hidden,
  presetColors,
  onToggle,
}: {
  categories: { name: string; count: number }[];
  hidden: string[];
  presetColors: Record<string, string> | undefined;
  onToggle: (category: string) => void;
}) {
  return (
    <ul className="max-h-64 overflow-auto rounded-md border border-zinc-200 bg-white text-sm">
      {categories.map((category, i) => {
        const isHidden = hidden.includes(category.name);
        const color = ColorUtils.toHex(
          categoryColor(category.name, i, presetColors),
        );
        return (
          <li key={category.name}>
            <label className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-zinc-50">
              <input
                type="checkbox"
                checked={!isHidden}
                onChange={() => onToggle(category.name)}
                className="size-3.5 accent-sky-600"
              />
              <span
                className="inline-block size-3 shrink-0 rounded-sm border border-black/20"
                style={{ background: color }}
              />
              <span
                className={
                  isHidden
                    ? "flex-1 truncate text-zinc-400 line-through"
                    : "flex-1 truncate"
                }
              >
                {category.name === "" ? "(empty)" : category.name}
              </span>
              <span className="text-xs text-zinc-400">
                {category.count.toLocaleString()}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
