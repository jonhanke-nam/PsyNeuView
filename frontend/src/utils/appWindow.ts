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

const PATH_REQUEST_KEY = "pnv-window-open-path:";

/**
 * The address that opens a file in a new window. A model file is a program and
 * opening one runs it, so the path can't be in the address: any site could then
 * link to this server and have a file on this machine run. It waits in storage,
 * which only this origin's pages can write, under an id the address carries.
 * The key is outside the prefixes the Mac app keeps across launches.
 */
export function openPathAddress(path: string): string {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(PATH_REQUEST_KEY + id, path);
  return `?open=${id}`;
}

/** Takes the path an address asks for. Once only, so a reload can't repeat it. */
function takeRequestedPath(id: string): string | null {
  const path = localStorage.getItem(PATH_REQUEST_KEY + id);
  if (path !== null) localStorage.removeItem(PATH_REQUEST_KEY + id);
  return path;
}

/** What a new window was opened to do, from its address. */
export function windowRequest(search: string): { path?: string; model?: string; newModel?: boolean } | null {
  const p = new URLSearchParams(search);
  const id = p.get("open");
  const path = id && takeRequestedPath(id);
  if (path) return { path };
  const model = p.get("openModel");
  if (model) return { model };
  return p.has("newModel") ? { newModel: true } : null;
}
