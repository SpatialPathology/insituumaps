/**
 * The rows of the gene picker (`GeneSearch`): genes, control probes and the
 * control probe group
 */
import { rankGenes } from "./rankGenes";

/** A row of the list: a gene (or control probe), or the control probe group */
export type GeneRow =
  | { kind: "gene"; name: string; control: boolean }
  | { kind: "group"; count: number; expanded: boolean };

/** The string value of the group row, never a gene name */
export const groupValue = "\u0000control-probes";

export function rowValue(row: GeneRow): string {
  return row.kind === "gene" ? row.name : groupValue;
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

/**
 * The rows for a query: browsing lists all genes A-Z and the control group
 * (expanded or not); searching lists the matching genes, then the matching
 * control probes
 */
export function buildGeneRows(
  genes: readonly string[],
  controls: readonly string[],
  query: string,
  controlsExpanded: boolean,
): GeneRow[] {
  const gene = (name: string, control: boolean): GeneRow => ({
    kind: "gene",
    name,
    control,
  });
  if (query.trim() === "") {
    const rows = [...genes].sort(compareNames).map((g) => gene(g, false));
    if (controls.length > 0) {
      rows.push({
        kind: "group",
        count: controls.length,
        expanded: controlsExpanded,
      });
      if (controlsExpanded) {
        rows.push(
          ...[...controls].sort(compareNames).map((c) => gene(c, true)),
        );
      }
    }
    return rows;
  }
  return [
    ...rankGenes([...genes], query, Infinity).map((g) => gene(g, false)),
    ...rankGenes([...controls], query, Infinity).map((c) => gene(c, true)),
  ];
}
