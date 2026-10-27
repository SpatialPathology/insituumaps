/**
 * A search box with autocomplete over gene names (case-insensitive, prefix
 * matches first, then substring matches)
 */
import { Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { rankGenes } from "./rankGenes";

export function GeneSearch({
  genes,
  value,
  onSelect,
  placeholder,
  clearOnSelect,
  disabled,
}: {
  genes: string[];
  /** The selected gene, shown when the box is not being edited */
  value: string | null;
  onSelect: (gene: string) => void;
  placeholder?: string;
  /** Clear the box after a selection (for adding to a list) */
  clearOnSelect?: boolean;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(value ?? "");
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery(value ?? "");
    }
  }, [value, editing]);

  const suggestions = useMemo(
    () => (open ? rankGenes(genes, query, 12) : []),
    [genes, query, open],
  );

  const choose = (gene: string) => {
    onSelect(gene);
    setOpen(false);
    setEditing(false);
    setQuery(clearOnSelect ? "" : gene);
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setEditing(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const exactMatch = genes.find(
    (g) => g.toLowerCase() === query.trim().toLowerCase(),
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute top-2 left-2 size-4 text-zinc-400" />
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          value={query}
          placeholder={placeholder ?? "Type a gene name"}
          onFocus={() => {
            setEditing(true);
            setOpen(true);
            setActive(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, suggestions.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const pick = suggestions[active] ?? exactMatch;
              if (pick !== undefined) {
                choose(pick);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
              setEditing(false);
              setQuery(value ?? "");
            }
          }}
          className="h-8 w-full rounded-md border border-zinc-300 bg-white pr-2 pl-8 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-200 focus:outline-none disabled:opacity-50"
        />
      </div>
      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg"
        >
          {suggestions.map((gene, i) => (
            <li
              key={gene}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(gene);
              }}
              className={cn(
                "cursor-pointer px-3 py-1",
                i === active ? "bg-sky-100 text-sky-900" : "text-zinc-800",
              )}
            >
              {gene}
            </li>
          ))}
        </ul>
      )}
      {open && query.trim() !== "" && suggestions.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-500 shadow-lg">
          No gene matches "{query}"
        </div>
      )}
    </div>
  );
}
