/**
 * Ranks gene names for a search query: exact matches, then prefix matches,
 * then substring matches, case-insensitive
 */
export function rankGenes(
  genes: string[],
  query: string,
  limit: number,
): string[] {
  const q = query.trim().toLowerCase();
  if (q === "") {
    return genes.slice(0, limit);
  }
  const exact: string[] = [];
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const gene of genes) {
    const g = gene.toLowerCase();
    if (g === q) {
      exact.push(gene);
    } else if (g.startsWith(q)) {
      prefix.push(gene);
    } else if (g.includes(q)) {
      contains.push(gene);
    }
    if (exact.length + prefix.length + contains.length >= limit * 4) {
      break;
    }
  }
  return [...exact, ...prefix, ...contains].slice(0, limit);
}
