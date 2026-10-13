/**
 * Which saved positions to keep when writing the layout back (#1160).
 *
 * `save_layout` carries the position map forward wholesale, so a deleted node's
 * coordinates lived in the sidecar forever. Harmless until a later node reuses
 * the name, at which point it silently inherits a stranger's position and
 * nothing says that is what happened.
 *
 * Pulled out of the save handler because the interesting part is what it
 * *refuses* to drop, and that is much easier to state as tests than to read
 * inside a debounce.
 */

export interface PruneInput {
  /** Positions as they stand in the sidecar. */
  saved: Record<string, { x: number; y: number }>;
  /** Positions for what is on the canvas right now. */
  current: Record<string, { x: number; y: number }>;
  /** Every name the model declares — `lineMap` keys. */
  declared: Set<string>;
}

/**
 * The map to write.
 *
 * Drops a saved entry only when the model no longer declares that name. Two
 * refusals matter more than the pruning itself:
 *
 * - **Nothing declared** means we could not tell — an unbuilt or failed model
 *   has no names, and reading that as "everything was deleted" would discard a
 *   layout someone spent real time on.
 * - **Not on the canvas** is not the same as **not in the model**: collapsed
 *   compositions and the other view's nodes are absent from `current` and must
 *   survive, which is what #659 depends on.
 */
export function prunePositions({ saved, current, declared }: PruneInput): Record<
  string,
  { x: number; y: number }
> {
  if (declared.size === 0) return { ...saved, ...current };
  const kept = Object.fromEntries(
    Object.entries(saved).filter(([key]) => declared.has(key) || current[key] !== undefined),
  );
  return { ...kept, ...current };
}
