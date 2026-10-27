/**
 * A gene picker on the TissUUmaps autocomplete: the full gene list can be
 * browsed (virtualized, A-Z) or searched (case-insensitive, prefix matches
 * first, then substring matches). Control probes, if given, follow the genes:
 * in a collapsed group while browsing, after the gene matches while searching.
 *
 * Built like `TableColumnInput` of the TissUUmaps app (virtualized list,
 * matched text in bold, group rows that reopen the list).
 */
import type { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import {
  type Ref,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
  AutocompleteStatus,
  AutocompleteTrigger,
} from "@/components/common/autocomplete";
import { InputGroupAddon } from "@/components/ui/input-group";
import { useCompressedRowVirtualizer } from "@/hooks/useCompressedRowVirtualizer";
import { cn } from "@/lib/utils";

import { type GeneRow, buildGeneRows, groupValue, rowValue } from "./geneRows";

/** The height of a row, in pixels */
const rowHeight = 28;

/** The largest height of the list (`max-h-72`), in pixels */
const maxListHeight = 288;

/** Rows rendered beyond each end of the visible range */
const overscan = 5;

function MatchText({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  const index = q !== "" ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (index === -1) {
    return <span className="truncate">{text}</span>;
  }
  return (
    <span className="truncate">
      {text.slice(0, index)}
      <span className="font-semibold">
        {text.slice(index, index + q.length)}
      </span>
      {text.slice(index + q.length)}
    </span>
  );
}

type RowListHandle = { scrollRowIntoView: (index: number) => void };

/** Renders only the rows within the visible range of the list */
function RowList({
  rows,
  query,
  ref,
}: {
  rows: GeneRow[];
  query: string;
  ref: Ref<RowListHandle>;
}) {
  const {
    containerRef,
    firstIndex,
    lastIndex,
    layoutRowsHeight,
    rowShift,
    scrollRowIntoView,
  } = useCompressedRowVirtualizer(
    rows.length,
    rowHeight,
    Math.min(rows.length * rowHeight, maxListHeight),
    overscan,
  );
  useImperativeHandle(ref, () => ({ scrollRowIntoView }));

  // base-ui leaves the scrolling of a virtualized list to its owner
  const searching = query.trim() !== "";
  useLayoutEffect(() => {
    if (searching) {
      containerRef.current?.scrollTo({ top: 0 });
    }
  }, [containerRef, query, searching]);

  return (
    <div
      ref={containerRef}
      role="presentation"
      className="max-h-72 min-h-0 overflow-y-auto"
      style={{ height: `${rows.length * rowHeight}px` }}
    >
      <div
        role="presentation"
        className="relative"
        style={{ height: `${layoutRowsHeight}px` }}
      >
        {rows.slice(firstIndex, lastIndex).map((row, i) => {
          const index = firstIndex + i;
          return (
            <AutocompleteItem
              key={rowValue(row)}
              index={index}
              value={row}
              aria-setsize={rows.length}
              aria-posinset={index + 1}
              className={cn(
                "absolute inset-x-0 top-0 py-0",
                row.kind === "group" &&
                  "border-t border-zinc-200 text-xs font-medium text-zinc-500",
                row.kind === "gene" && row.control && "pl-7 text-zinc-500",
              )}
              style={{
                height: `${rowHeight}px`,
                transform: `translateY(${index * rowHeight - rowShift}px)`,
              }}
            >
              {row.kind === "group" ? (
                <>
                  {row.expanded ? (
                    <ChevronDown className="size-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0" />
                  )}
                  <span>Control probes ({row.count.toLocaleString()})</span>
                </>
              ) : (
                <MatchText text={row.name} query={query} />
              )}
            </AutocompleteItem>
          );
        })}
      </div>
    </div>
  );
}

export function GeneSearch({
  genes,
  controls = [],
  value,
  onSelect,
  placeholder,
  clearOnSelect,
  disabled,
}: {
  genes: readonly string[];
  /** Control probes, listed after the genes (see `splitControlProbes`) */
  controls?: readonly string[];
  /** The selected gene, shown when the box is not being edited */
  value: string | null;
  onSelect: (gene: string) => void;
  placeholder?: string;
  /** Clear the box after a selection (for adding to a list) */
  clearOnSelect?: boolean;
  disabled?: boolean;
}) {
  const shown = value ?? "";
  const [text, setText] = useState(shown);
  const [open, setOpen] = useState(false);
  const [controlsExpanded, setControlsExpanded] = useState(false);

  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [prevShown, setPrevShown] = useState(shown);
  if (shown !== prevShown) {
    setPrevShown(shown);
    setText(shown);
  }

  // while a gene is shown, the list browses everything instead of matching it
  const query = text === shown && !clearOnSelect ? "" : text;
  const rows = useMemo(
    () => (open ? buildGeneRows(genes, controls, query, controlsExpanded) : []),
    [open, genes, controls, query, controlsExpanded],
  );

  const highlightedRef = useRef<GeneRow | undefined>(undefined);
  const rowListRef = useRef<RowListHandle>(null);
  // base-ui closes the popup after any item press; a pressed group row
  // reopens it instead (as in TissUUmaps' TableColumnInput)
  const reopenRef = useRef(false);

  const choose = (gene: string) => {
    onSelect(gene);
    setText(clearOnSelect ? "" : gene);
  };

  const findExact = (name: string) => {
    const q = name.trim().toLowerCase();
    return (
      genes.find((g) => g.toLowerCase() === q) ??
      controls.find((c) => c.toLowerCase() === q)
    );
  };

  function handleTextChange(
    newText: string,
    details: AutocompletePrimitive.Root.ChangeEventDetails,
  ) {
    // base-ui clears the input on Escape when the popup is closed
    if (details.reason === "escape-key") {
      details.cancel();
      setText(shown);
      return;
    }
    if (details.reason === "item-press") {
      if (newText === groupValue) {
        setControlsExpanded((expanded) => !expanded);
        reopenRef.current = true;
      } else {
        choose(newText);
      }
      return;
    }
    if (details.reason === "clear-press") {
      setText("");
      return;
    }
    setText(newText);
  }

  function handleOpenChange(newOpen: boolean) {
    setOpen(newOpen);
    if (!newOpen) {
      highlightedRef.current = undefined;
    }
  }

  function handleOpenChangeComplete(newOpen: boolean) {
    if (!newOpen && reopenRef.current) {
      reopenRef.current = false;
      setOpen(true);
    }
  }

  const status =
    open && rows.length === 0
      ? query.trim() === ""
        ? "No genes"
        : `No gene matches "${query.trim()}"`
      : null;

  return (
    <Autocomplete
      value={text}
      onValueChange={handleTextChange}
      mode="none"
      items={rows}
      virtualized
      itemToStringValue={rowValue}
      openOnInputClick
      open={open}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={handleOpenChangeComplete}
      disabled={disabled}
      onItemHighlighted={(row, { reason, index }) => {
        highlightedRef.current = row;
        // base-ui cannot scroll to a row that is not rendered, e.g. when the
        // highlight wraps around the list
        if (row !== undefined && reason === "keyboard") {
          rowListRef.current?.scrollRowIntoView(index);
        }
      }}
    >
      <AutocompleteInputGroup className="h-8 border-zinc-300 bg-white">
        <InputGroupAddon align="inline-start">
          <Search className="text-zinc-400" />
        </InputGroupAddon>
        <AutocompleteInput
          placeholder={placeholder ?? "Type or browse a gene"}
          className="h-8 text-sm"
          onKeyDown={(event) => {
            if (event.key === "Enter" && highlightedRef.current === undefined) {
              const exact = findExact(text);
              if (exact !== undefined) {
                event.preventDefault();
                choose(exact);
                setOpen(false);
              }
            }
          }}
          // an unfinished query is dropped; a chosen gene arrives as the new
          // value and is shown from there
          onBlur={() => setText(clearOnSelect ? "" : shown)}
        />
        <InputGroupAddon align="inline-end">
          {text !== "" && <AutocompleteClear label="Clear" />}
          <AutocompleteTrigger label="Browse all genes" />
        </InputGroupAddon>
      </AutocompleteInputGroup>
      <AutocompletePopup className="flex flex-col overflow-hidden border-zinc-200">
        <AutocompleteStatus>{status}</AutocompleteStatus>
        <AutocompleteList className="flex min-h-0 flex-col">
          {rows.length > 0 && (
            <RowList ref={rowListRef} rows={rows} query={query} />
          )}
        </AutocompleteList>
      </AutocompletePopup>
    </Autocomplete>
  );
}
