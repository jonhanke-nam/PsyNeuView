// Native file-picker bridge to the macOS app (#347).
//
// The backend's open/save endpoints operate on absolute filesystem paths,
// which <input type="file"> can never provide inside the Mac app's WKWebView
// — so plain web falls back to typed-path prompts. The Mac app registers a
// WKScriptMessageHandlerWithReply named "pnvFile"
// (jonhanke-nam/PsyNeuView-MacApp#28) whose postMessage returns a Promise
// resolving to { path: string | null } (null = user cancelled the panel).
//
// Ops (the Mac app's half: Services/FileBridge.swift):
//   { op: "open", directories?, extensions?, message?, defaultDir? } -> { path }
//   { op: "saveAs", defaultName?, extensions?, message?, defaultDir? } -> { path }
//   { op: "reveal", path }  -> { revealed: true } once the folder or file is
//                              shown in Finder (#1295). Rejects with an Error
//                              whose message is for the user ("There's no
//                              folder at …"). An app from before this op
//                              (0.5.15 and earlier) doesn't know it: its reply
//                              carries no `revealed: true` (it may answer
//                              { path: null } or reject with an unknown-op
//                              message), and `revealInFinder` reports that as
//                              "not supported" so the page can fall back to
//                              copying the path (utils/revealPath.ts).

interface OpenOptions {
  /** Pick a directory instead of a file. */
  directories?: boolean;
  /** Allowed file extensions, without dots (e.g. ["py", "pnlproject"]). */
  extensions?: string[];
  /** Short instruction shown inside the panel. */
  message?: string;
  /** Initial directory; omit to let macOS remember the last-used one. */
  defaultDir?: string;
}

interface SaveOptions {
  /** Pre-filled filename in the save panel. */
  defaultName?: string;
  extensions?: string[];
  message?: string;
  defaultDir?: string;
}

const bridge = () => (window as any).webkit?.messageHandlers?.pnvFile;

export const hasFileBridge = (): boolean => !!bridge();

async function post(body: Record<string, unknown>): Promise<string | null> {
  const h = bridge();
  if (!h) return null;
  const reply = await h.postMessage(body);
  return typeof reply?.path === "string" && reply.path ? reply.path : null;
}

/** Native open panel → absolute path, or null if cancelled / no bridge. */
export const pickOpenPath = (opts: OpenOptions = {}) =>
  post({ op: "open", ...opts });

/** Native save panel → absolute destination path, or null if cancelled / no bridge. */
export const pickSavePath = (opts: SaveOptions = {}) =>
  post({ op: "saveAs", ...opts });

/** What the app said to a reveal: shown, or an app too old to know the op. */
export type RevealReply = "revealed" | "unsupported";

/**
 * Show `path` in Finder (#1295). Resolves "revealed" when the app did;
 * "unsupported" when there is no bridge or the app predates the op; rejects
 * with the app's own message when it refused (no such folder, say).
 */
export async function revealInFinder(path: string): Promise<RevealReply> {
  const h = bridge();
  if (!h) return "unsupported";
  let reply: any;
  try {
    reply = await h.postMessage({ op: "reveal", path });
  } catch (e: any) {
    const message = String(e?.message ?? e ?? "");
    // An older app rejects an op it doesn't know; a current one rejects a
    // reveal it couldn't do, with words for the user.
    if (/unknown op/i.test(message)) return "unsupported";
    throw new Error(message || "Couldn't show it in Finder.");
  }
  return reply?.revealed === true ? "revealed" : "unsupported";
}
