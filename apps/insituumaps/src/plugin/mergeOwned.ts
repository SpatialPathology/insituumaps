/**
 * Merges the objects the plugin builds into the app's project, leaving the
 * objects the user added in the generic panels alone
 */
import type { Project } from "@tissuumaps/core";

/** The collections of a project that the plugin writes */
export type OwnedCollections = Pick<
  Project,
  | "layers"
  | "images"
  | "labels"
  | "points"
  | "shapes"
  | "tables"
  | "colorMaps"
  | "visibilityMaps"
>;

/** The keys of {@link OwnedCollections} */
export const ownedCollectionKeys = [
  "layers",
  "images",
  "labels",
  "points",
  "shapes",
  "tables",
  "colorMaps",
  "visibilityMaps",
] as const satisfies readonly (keyof OwnedCollections)[];

/** The object IDs `model.ts` assigns, matched exactly */
const ownedIds = new Set([
  "sample",
  "cells",
  "nuclei",
  "mask",
  "categories",
  "category-visibility",
]);

/** The object ID prefixes `model.ts` assigns */
const ownedIdPrefixes = [
  "image:",
  "mask-outlines:",
  "transcripts:",
  "overlay:",
];

/**
 * Returns whether an object ID is one the plugin assigns (see `model.ts`),
 * i.e. whether the plugin owns the object and rewrites it on every change
 *
 * @param id - The ID of a layer, data object, table or map
 * @returns Whether the plugin owns the object
 */
export function isOwnedId(id: string): boolean {
  return (
    ownedIds.has(id) || ownedIdPrefixes.some((prefix) => id.startsWith(prefix))
  );
}

/**
 * Replaces the owned objects of each collection by those of the next model
 *
 * Each merged collection lists the owned objects of `next`, in its order,
 * followed by the objects of `current` that are not owned, in their order. The
 * user's objects are thereby kept and drawn above the plugin's. Owned objects
 * that `next` no longer has are dropped, also if the user changed them.
 *
 * @param current - The collections as they are in the project now
 * @param next - The collections of the plugin's next model
 * @param isOwned - Whether the plugin owns the object with an ID
 * @returns The merged collections
 */
export function mergeOwned(
  current: OwnedCollections,
  next: OwnedCollections,
  isOwned: (id: string) => boolean = isOwnedId,
): OwnedCollections {
  const merge = <T extends { id: string }>(
    currentItems: readonly T[],
    nextItems: readonly T[],
  ): T[] => [
    ...nextItems.filter((item) => isOwned(item.id)),
    ...currentItems.filter((item) => !isOwned(item.id)),
  ];
  return {
    layers: merge(current.layers, next.layers),
    images: merge(current.images, next.images),
    labels: merge(current.labels, next.labels),
    points: merge(current.points, next.points),
    shapes: merge(current.shapes, next.shapes),
    tables: merge(current.tables, next.tables),
    colorMaps: merge(current.colorMaps, next.colorMaps),
    visibilityMaps: merge(current.visibilityMaps, next.visibilityMaps),
  };
}
