/**
 * Settings search (#271): find a setting without knowing its section.
 *
 * The index is docs/settings-inventory.yaml, the list of every setting that
 * settingsInventory.test.ts already keeps in step with the controls. It is
 * bundled with the page, so a setting is searchable as soon as it is
 * inventoried. A setting matches on its name, the section and groups above
 * it, its `keywords` (the other words people use: "auto-eval" for the live
 * preview) and, weakly, its notes.
 */
import yaml from "js-yaml";
import inventoryText from "../../../../../docs/settings-inventory.yaml?raw";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./sections";

interface InventoryEntry {
  id: string;
  label: string;
  home: string;
  section: SettingsSectionId;
  control: string;
  simple_control?: string;
  simple_section?: SettingsSectionId;
  keywords?: string[];
  shown_when?: string;
  notes?: string;
}

export interface SettingsSearchEntry {
  id: string;
  /** What Settings calls it: the last part of the inventory label. */
  name: string;
  /** Where it is: the section's name, then the groups above it. */
  where: string;
  /** The section to open and the control to take you to. */
  section: SettingsSectionId;
  control: string;
  macAppOnly: boolean;
  /** For a control that isn't always shown: when it is. */
  shownWhen?: string;
  /** Where to go if the control isn't shown: a simple view's full form. */
  fallback?: { section: SettingsSectionId; control: string };
  keywords: string[];
  notes: string;
}

const sectionLabel = (id: string) => SETTINGS_SECTIONS.find((s) => s.id === id)?.label ?? id;

/** One entry per inventoried setting. */
export function buildSettingsIndex(text: string = inventoryText): SettingsSearchEntry[] {
  const doc = yaml.load(text) as { settings: InventoryEntry[] };
  return doc.settings.map((e) => {
    const parts = e.label.split("▸").map((p) => p.trim());
    // A setting with a simple view for everyone (#1295) is found there; the
    // full form stays in Developer for those who need it.
    const section = (e.simple_control && e.simple_section) || e.section;
    const control = (e.simple_control && e.simple_section && e.simple_control) || e.control;
    const groups = parts.length > 1 ? parts.slice(1, -1) : [];
    return {
      id: e.id,
      name: parts[parts.length - 1],
      where: [sectionLabel(section), ...groups].join(" ▸ "),
      section,
      control,
      macAppOnly: e.home === "settings:mac-app",
      shownWhen: e.shown_when,
      fallback: control !== e.control ? { section: e.section, control: e.control } : undefined,
      keywords: e.keywords ?? [],
      notes: (e.notes ?? "").replace(/#\d+/g, " "),
    };
  });
}

export const SETTINGS_INDEX = buildSettingsIndex();

const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();

/** How well one term matches an entry; 0 for not at all. */
function termScore(e: SettingsSearchEntry, term: string): number {
  const atWordStart = (text: string) => new RegExp(`(^|\\W)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text);
  const name = norm(e.name);
  if (name.includes(term)) return atWordStart(name) ? 100 : 70;
  if (e.keywords.some((k) => norm(k).includes(term))) return 60;
  const where = norm(e.where);
  if (where.includes(term)) return atWordStart(where) ? 40 : 30;
  if (norm(e.notes).includes(term)) return 10;
  return 0;
}

export interface SettingsSearchResult {
  /** Settings that match every word of the query, best first. */
  matches: SettingsSearchEntry[];
  /** With no match: those that match some of the words, as "closest". */
  closest: SettingsSearchEntry[];
}

export function searchSettings(
  query: string,
  opts: { inMacApp: boolean; index?: SettingsSearchEntry[] },
): SettingsSearchResult {
  const index = (opts.index ?? SETTINGS_INDEX).filter((e) => opts.inMacApp || !e.macAppOnly);
  const terms = norm(query).split(" ").filter(Boolean);
  if (terms.length === 0) return { matches: [], closest: [] };
  const scored = index.map((e) => {
    const per = terms.map((t) => termScore(e, t));
    return { e, all: per.every((s) => s > 0), total: per.reduce((a, b) => a + b, 0) };
  });
  const byScore = (a: { total: number }, b: { total: number }) => b.total - a.total;
  const matches = scored.filter((s) => s.all).sort(byScore).map((s) => s.e);
  const closest = matches.length
    ? []
    : scored.filter((s) => s.total > 0).sort(byScore).slice(0, 3).map((s) => s.e);
  return { matches, closest };
}
