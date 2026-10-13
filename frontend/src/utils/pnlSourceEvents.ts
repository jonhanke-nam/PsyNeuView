/**
 * "The active PsyNeuLink install changed" (#1253).
 *
 * Switching the PsyNeuLink source in Settings uninstalls one copy and installs
 * another, so every path the Open menu got from the old one (the Library, the
 * examples) now points at files that are gone. Apply & restart restarts the
 * model runner, not the page, so nothing else would tell the menu. Settings
 * announces a successful install here, and the menu refetches what came from
 * PsyNeuLink.
 */

export const PNL_SOURCE_CHANGED = "psyneuview:pnl-source-changed";

export function announcePnlSourceChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PNL_SOURCE_CHANGED));
}

/** Call `listener` on each announcement. Returns the unsubscribe. */
export function onPnlSourceChanged(listener: () => void): () => void {
  window.addEventListener(PNL_SOURCE_CHANGED, listener);
  return () => window.removeEventListener(PNL_SOURCE_CHANGED, listener);
}
