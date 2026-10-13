/**
 * The order of the Open menu's catalog sections. (#1135)
 *
 * Its own module because two components need it — the menu, where you drag a
 * heading, and Settings, where you move rows and can reset. Keeping it in
 * Toolbar and importing from there worked, but made Toolbar and SettingsPanel
 * import each other, which is the kind of cycle that survives until the day it
 * doesn't.
 *
 * Stored per browser rather than on the server, for the same reason the
 * keyboard overrides are (#1112): `hosted` is one backend shared by several
 * people, so a server-side preference would rearrange the menu for everyone on
 * the demo.
 */

import { recordSettingChanged } from "@/utils/activityLog";

export const SECTION_ORDER_KEY = "psyneuview.openMenu.sectionOrder";
export const COLLAPSED_SECTIONS_KEY = "psyneuview.openMenu.collapsedSections";

/**
 * Your models first, then PsyNeuLink's.
 *
 * "Recent" is deliberately absent: it lives under its own History zone header
 * (#350). "Go back to something recent" is a different question from "pick
 * from a set", and folding it in here would lose that.
 */
export const DEFAULT_SECTION_ORDER = [
  "myModels",
  "library",
  "examples",
  "references",
  "demos",
] as const;

export type SectionId = (typeof DEFAULT_SECTION_ORDER)[number];

/** What each section is called, for anywhere listing them outside the menu. */
export const SECTION_LABELS: Record<SectionId, string> = {
  myModels: "My Project Folder",
  library: "PsyNeuLink Library",
  examples: "PsyNeuLink Examples (under development)",
  references: "★ Reference Models (under development)",
  demos: "Demo Models (under development)",
};

/**
 * Catalogs still under development (#1228).
 *
 * Only My Project Folder and the PsyNeuLink Library are for everyday use. The rest are
 * hidden unless something asks for them: developer mode, the user switching
 * one on in Settings, or a running walkthrough (two open their model from
 * Demo or Reference Models, and a learner has to be able to find it).
 */
export const DEV_SECTIONS: readonly SectionId[] = ["examples", "references", "demos"];
export const SHOWN_DEV_SECTIONS_KEY = "psyneuview.openMenu.shownDevSections";

/** An everyday section: My Project Folder, the Library, or one of the user's catalogs. */
export function isEverydaySection(id: string): boolean {
  return !(DEV_SECTIONS as readonly string[]).includes(id);
}

/**
 * The catalogs under development always sit below the everyday sections
 * (#1295 review). They can be reordered among themselves, never above My
 * Project Folder, the Library or a user catalog. A stored order that breaks
 * the rule — from before it, or from a hand edit — is put right here, keeping
 * the relative order within each half.
 */
export function normalizeSectionOrder(order: readonly string[]): string[] {
  return [...order.filter(isEverydaySection), ...order.filter((id) => !isEverydaySection(id))];
}

/** Whether moving the section at `from` to `to` keeps the rule above. */
export function canMoveSection(order: readonly string[], from: number, to: number): boolean {
  if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return false;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.every((id, i) => id === normalizeSectionOrder(next)[i]);
}

export function getShownDevSections(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SHOWN_DEV_SECTIONS_KEY) || "[]");
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

export function persistShownDevSections(ids: Set<string>): void {
  try {
    localStorage.setItem(SHOWN_DEV_SECTIONS_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Storage blocked: the choice lasts this session only.
  }
  recordSettingChanged("open-menu-shown-dev-sections", Array.from(ids));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SECTION_ORDER_CHANGED));
  }
}

export interface SectionVisibility {
  developerMode: boolean;
  tourRunning: boolean;
  shown: Set<string>;
}

/** Whether a catalog shows in the Open menu. */
export function isSectionVisible(id: string, opts: SectionVisibility): boolean {
  if (!(DEV_SECTIONS as readonly string[]).includes(id)) return true;
  return opts.developerMode || opts.tourRunning || opts.shown.has(id);
}

/**
 * Whether a catalog is on the menu only because developer mode is on. (#1291)
 *
 * Such a section gets the Developer badge: a regular user wouldn't see it. One
 * the user switched on in Settings, or one a running walkthrough opened, is
 * shown for a different reason and is not marked, even with developer mode on.
 */
export function isShownOnlyByDeveloperMode(id: string, opts: SectionVisibility): boolean {
  if (!(DEV_SECTIONS as readonly string[]).includes(id)) return false;
  return opts.developerMode && !opts.tourRunning && !opts.shown.has(id);
}

/** Fired when the order changes, so the menu and Settings stay in step. */
export const SECTION_ORDER_CHANGED = "psyneuview:openMenu-order-changed";

/**
 * The id of a user-added catalog's section (#1229). Namespaced so it can sit in
 * the same order and fold set as the built-in sections without colliding.
 */
export function catalogSectionId(catalogId: string): string {
  return `catalog:${catalogId}`;
}

/**
 * The stored order, reconciled against what actually exists.
 *
 * A stored order can be stale — a section added since it was written would be
 * missing, one removed would linger. Take the stored ids that are still real
 * and append anything new in its default position, so a new section appears
 * rather than silently never rendering.
 *
 * `catalogIds` are the sections of the user's own catalogs (#1229), which
 * exist only while the catalog does; a new one goes after the everyday
 * sections, and the catalogs under development stay below them all.
 */
export function getSectionOrder(catalogIds: string[] = []): string[] {
  let stored: unknown = [];
  try {
    stored = JSON.parse(localStorage.getItem(SECTION_ORDER_KEY) || "[]");
  } catch {
    stored = [];
  }
  const all = defaultOrder(catalogIds);
  const known = new Set<string>(all);
  const kept = Array.isArray(stored)
    ? (stored.filter((id) => typeof id === "string" && known.has(id)) as string[])
    : [];
  const seen = new Set(kept);
  return normalizeSectionOrder([...kept, ...all.filter((id) => !seen.has(id))]);
}

export function persistSectionOrder(order: string[]): void {
  try {
    localStorage.setItem(SECTION_ORDER_KEY, JSON.stringify(order));
  } catch {
    // Storage blocked: the order lasts this session only.
  }
  recordSettingChanged("open-menu-sections", order);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SECTION_ORDER_CHANGED));
  }
}

/** The order with no rearranging: the everyday sections, your catalogs as added, then the ones under development. */
export function defaultOrder(catalogIds: string[] = []): string[] {
  return normalizeSectionOrder([...DEFAULT_SECTION_ORDER, ...catalogIds]);
}

export function isDefaultOrder(order: string[], catalogIds: string[] = []): boolean {
  const def = defaultOrder(catalogIds);
  return order.length === def.length && order.every((id, i) => id === def[i]);
}

export function getCollapsedSections(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLLAPSED_SECTIONS_KEY) || "[]");
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

export function persistCollapsedSections(ids: Set<string>): void {
  localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify(Array.from(ids)));
}

/**
 * Sections start folded, so the menu opens short. (#1135)
 *
 * "Never chosen" is told apart from "chose to expand everything" by whether the
 * key exists at all — an empty stored array is a deliberate choice and must not
 * be re-folded next session.
 */
export function getCollapsedSectionsDefaultingToFolded(): Set<string> {
  if (localStorage.getItem(COLLAPSED_SECTIONS_KEY) === null) {
    return new Set(DEFAULT_SECTION_ORDER);
  }
  return getCollapsedSections();
}
