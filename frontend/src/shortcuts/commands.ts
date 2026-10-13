/**
 * A tiny command bus, so a shortcut can reach an action that lives in a
 * component. (#1112)
 *
 * Saving belongs to the code editor and deleting a node belongs to the canvas;
 * neither is reachable from a hook mounted at the top of the tree. The
 * alternatives were a DOM CustomEvent, which is untyped and hard to trace, or
 * hoisting both actions out of their components, which is a much larger change
 * than migrating shortcuts warrants.
 *
 * A component registers while mounted and unregisters on the way out, so a
 * shortcut whose owner is not on screen does nothing rather than throwing.
 */

export type CommandId =
  | "model.save"
  | "graph.deleteSelection"
  | "inspector.focus";

const handlers = new Map<CommandId, () => void>();

/** Register a handler. Returns the unregister function, for effect cleanup. */
export function registerCommand(id: CommandId, handler: () => void): () => void {
  handlers.set(id, handler);
  return () => {
    // Only clear if it is still ours: a remount can register the replacement
    // before the old effect cleans up, and clearing then would leave the
    // command dead.
    if (handlers.get(id) === handler) handlers.delete(id);
  };
}

/** Run a command. Returns false when nothing is registered. */
export function runCommand(id: CommandId): boolean {
  const handler = handlers.get(id);
  if (!handler) return false;
  handler();
  return true;
}

/** Whether anything is currently listening. Used by tests and by Settings. */
export function hasCommand(id: CommandId): boolean {
  return handlers.has(id);
}

/** Test seam only. */
export function clearCommands(): void {
  handlers.clear();
}
