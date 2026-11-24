/**
 * The assistant's page secret (#381): proof that a request comes from this
 * page, not from another program on the machine.
 *
 * The backend makes a secret each launch and requires it, in the
 * `X-PsyNeuView-Session` header, on every assistant route. No HTTP route
 * serves it. It reaches the page one of two ways, both outside HTTP:
 *
 * - **The Mac app** writes it into `sessionStorage` with a user script before
 *   the page's own scripts run.
 * - **A browser** opens the one-time link the server printed at start,
 *   `…/#pnv-session=<secret>`. A fragment is never sent to a server; this
 *   module moves it into `sessionStorage` and takes it out of the address
 *   bar, so it isn't left in history, bookmarks or a shared screenshot.
 *
 * `sessionStorage` is per tab: a new tab needs the link again.
 */

/** Where the secret is kept; the Mac app's user script writes the same key. */
export const PAGE_SECRET_KEY = "psyneuview.pageSecret";
export const PAGE_SECRET_HEADER = "X-PsyNeuView-Session";
/** The fragment key in the printed link (backend `page_secret.FRAGMENT_KEY`). */
export const PAGE_SECRET_FRAGMENT = "pnv-session";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type LocationLike = Pick<Location, "hash" | "pathname" | "search">;
type HistoryLike = Pick<History, "replaceState" | "state">;

function session(): StorageLike | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Take `#pnv-session=<secret>` out of the address: keep the secret in
 * `storage`, and put the address back without it (other fragment parts are
 * kept). Returns whether a secret was taken.
 */
export function takePageSecretFromUrl(
  loc: LocationLike = window.location,
  hist: HistoryLike = window.history,
  storage: StorageLike | null = session(),
): boolean {
  const hash = loc.hash.startsWith("#") ? loc.hash.slice(1) : loc.hash;
  if (!hash) return false;
  const parts = hash.split("&");
  let secret: string | null = null;
  const rest: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    const key = eq < 0 ? part : part.slice(0, eq);
    if (key === PAGE_SECRET_FRAGMENT) {
      try {
        secret = decodeURIComponent(eq < 0 ? "" : part.slice(eq + 1)).trim();
      } catch {
        secret = "";
      }
    } else if (part) {
      rest.push(part);
    }
  }
  if (secret === null) return false;
  // Strip it from the address bar whatever happens next.
  const clean = loc.pathname + loc.search + (rest.length ? `#${rest.join("&")}` : "");
  try {
    hist.replaceState(hist.state, "", clean);
  } catch {
    // An address that can't be rewritten still mustn't stop the page.
  }
  if (!secret || !storage) return false;
  try {
    storage.setItem(PAGE_SECRET_KEY, secret);
    return true;
  } catch {
    return false;
  }
}

/** This tab's page secret, or null when it has none. */
export function pageSecret(storage: StorageLike | null = session()): string | null {
  try {
    return storage?.getItem(PAGE_SECRET_KEY) || null;
  } catch {
    return null;
  }
}

/** `init` with the page secret header added (when there is one). */
export function withPageSecret(init: RequestInit = {}, secret: string | null = pageSecret()): RequestInit {
  if (!secret) return init;
  const headers = new Headers(init.headers);
  headers.set(PAGE_SECRET_HEADER, secret);
  return { ...init, headers };
}

/** `fetch` for an assistant route: the same, with the page secret. */
export function assistantFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, withPageSecret(init));
}

/** The backend's reasons for refusing a request without the right secret. */
export const PAGE_SECRET_REASONS = ["page_secret_missing", "page_secret_wrong", "no_origin"] as const;

/**
 * When `body` (a 403's JSON) is a page-secret refusal, its plain-English
 * message; otherwise null.
 */
export function pageSecretRefusal(body: Record<string, unknown>): string | null {
  const detail = body.detail as { reason?: unknown; message?: unknown } | undefined;
  if (!detail || typeof detail !== "object") return null;
  if (!PAGE_SECRET_REASONS.includes(detail.reason as (typeof PAGE_SECRET_REASONS)[number])) return null;
  return typeof detail.message === "string" ? detail.message : "Refused: this page doesn't hold the assistant's secret.";
}
