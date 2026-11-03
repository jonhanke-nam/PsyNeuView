/**
 * Opening another PsyNeuView window from the page (#172).
 *
 * In a browser that's a new tab or window. The Mac app's web view ignores
 * `window.open`, so there it goes through a bridge (PsyNeuView-MacApp#40), and
 * an app too old to have the bridge can't do it at all: callers ask first, and
 * don't offer the choice.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const webkit = () => (window as any).webkit?.messageHandlers;
const bridge = () => webkit()?.pnvOpenWindow;

export function canOpenAppWindow(): boolean {
  return !webkit() || !!bridge();
}

/** Opens `search` (`?tour=ddm`) on this page's address. False if nothing opened. */
export function openAppWindow(search: string): boolean {
  const url = `${window.location.origin}${window.location.pathname}${search}`;
  const b = bridge();
  if (b) {
    b.postMessage({ url });
    return true;
  }
  return window.open(url, "_blank") !== null;
}

/** What a new window was opened to do, from its address. */
export function windowRequest(search: string): { path?: string; model?: string; newModel?: boolean } | null {
  const p = new URLSearchParams(search);
  const path = p.get("open");
  if (path) return { path };
  const model = p.get("openModel");
  if (model) return { model };
  return p.has("newModel") ? { newModel: true } : null;
}
