/**
 * Separates control probes and codewords from genes in a transcript gene list
 *
 * Xenium writes negative controls and unused codewords into the transcripts
 * next to the genes; they measure background, not expression. They are
 * recognised by their name prefix, and, when the cell table's genes are known,
 * by being absent from it (the table holds genes only).
 */

/** Name prefixes of Xenium control probes and codewords (case-insensitive) */
const controlPrefixes = [
  "negcontrolprobe_",
  "negcontrolcodeword_",
  "negcontrol",
  "unassignedcodeword_",
  "deprecatedcodeword_",
  "intergenicregion_",
  "genomiccontrol",
  "blank_",
];

export function isControlProbeName(name: string): boolean {
  const lower = name.toLowerCase();
  return controlPrefixes.some((prefix) => lower.startsWith(prefix));
}

/**
 * Splits names into genes and control probes, keeping their order
 *
 * @param names - The transcript gene names
 * @param tableGenes - The genes of the cell table, if known; names missing
 * from it are treated as controls too
 */
export function splitControlProbes(
  names: readonly string[],
  tableGenes?: readonly string[],
): { genes: string[]; controls: string[] } {
  const inTable =
    tableGenes !== undefined && tableGenes.length > 0
      ? new Set(tableGenes)
      : null;
  const genes: string[] = [];
  const controls: string[] = [];
  for (const name of names) {
    if (isControlProbeName(name) || (inTable !== null && !inTable.has(name))) {
      controls.push(name);
    } else {
      genes.push(name);
    }
  }
  return { genes, controls };
}
