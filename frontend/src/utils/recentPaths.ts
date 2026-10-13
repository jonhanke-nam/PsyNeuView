/**
 * The Open menu's recent files, per browser.
 *
 * Lived inside Toolbar until the project folder could be moved (#1295): a
 * move leaves every recent path under the old folder pointing at nothing, so
 * Settings rewrites them here, and Toolbar reads the result. The key keeps
 * its historical spelling; existing browsers hold entries under it.
 */

export const RECENT_PATHS_KEY = "psynewview_recent_paths";
export const MAX_RECENT = 10;

export function getRecentPaths(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_PATHS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function addRecentPath(path: string): void {
  const recent = getRecentPaths().filter((p) => p !== path);
  recent.unshift(path);
  try {
    localStorage.setItem(RECENT_PATHS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
  } catch {
    // Storage blocked: the list lasts this session only.
  }
}

/** `path` with `from` swapped for `to` when it is `from` or inside it. */
export function rewriteUnder(path: string, from: string, to: string): string {
  const base = from.replace(/\/+$/, "");
  if (path === base) return to;
  if (path.startsWith(base + "/")) return to.replace(/\/+$/, "") + path.slice(base.length);
  return path;
}

/** After the project folder moved from `from` to `to`: every recent path follows. */
export function rewriteRecentPaths(from: string, to: string): string[] {
  const next = getRecentPaths().map((p) => rewriteUnder(p, from, to));
  try {
    localStorage.setItem(RECENT_PATHS_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: nothing to rewrite.
  }
  return next;
}

/** Fired after a rewrite, so an open Open menu shows the new paths. */
export const RECENT_PATHS_CHANGED = "psyneuview:recent-paths-changed";

export function announceRecentPathsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(RECENT_PATHS_CHANGED));
}
