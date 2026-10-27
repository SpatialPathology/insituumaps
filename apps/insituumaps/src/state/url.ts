/**
 * Shareable URL state: `?source=<url>&sample=<i>&layer=<key>&color=gene:EPCAM
 * or color=obs:leiden&mask=cells|nuclei`
 *
 * Links written before the fill/outline split may still carry `style=`; it is
 * ignored and dropped on the next write.
 */
import type { ColorBy } from "@/viewer/selection";

export type UrlState = {
  source?: string;
  sample?: number;
  cellLayer?: string;
  colorBy?: ColorBy;
  mask?: "cells" | "nuclei";
};

export function readStateFromUrl(): UrlState {
  const params = new URLSearchParams(window.location.search);
  const state: UrlState = {};
  const source = params.get("source");
  if (source !== null && source !== "") {
    state.source = source;
  }
  const sample = params.get("sample");
  if (sample !== null && /^\d+$/.test(sample)) {
    state.sample = Number(sample);
  }
  const layer = params.get("layer");
  if (layer !== null && layer !== "") {
    state.cellLayer = layer;
  }
  const color = params.get("color");
  if (color !== null) {
    const [kind, ...rest] = color.split(":");
    const value = rest.join(":");
    if (kind === "gene" && value !== "") {
      const [gene, source] = value.split("@");
      state.colorBy = { kind: "gene", gene: gene!, source: source ?? "X" };
    } else if (kind === "obs" && value !== "") {
      state.colorBy = { kind: "obs", column: value };
    } else if (kind === "none") {
      state.colorBy = { kind: "none" };
    }
  }
  const mask = params.get("mask");
  if (mask === "cells" || mask === "nuclei") {
    state.mask = mask;
  }
  return state;
}

/** Writes the shareable parts of the state into the URL (no reload) */
export function writeStateToUrl(state: {
  source: { kind: string; label: string } | null;
  sampleIndex: number | null;
  selection: {
    cellLayer: string | null;
    colorBy: ColorBy;
    mask: string;
  };
}): void {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  for (const key of ["source", "sample", "layer", "color", "mask", "style"]) {
    params.delete(key);
  }
  if (state.source?.kind === "url") {
    params.set("source", state.source.label);
    if (state.sampleIndex !== null) {
      params.set("sample", String(state.sampleIndex));
    }
    if (state.selection.cellLayer !== null) {
      params.set("layer", state.selection.cellLayer);
    }
    const colorBy = state.selection.colorBy;
    if (colorBy.kind === "gene") {
      params.set("color", `gene:${colorBy.gene}@${colorBy.source}`);
    } else if (colorBy.kind === "obs") {
      params.set("color", `obs:${colorBy.column}`);
    }
    params.set("mask", state.selection.mask);
  }
  window.history.replaceState({}, "", url);
}
