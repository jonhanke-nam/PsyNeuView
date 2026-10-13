/**
 * The sections of Settings, in sidebar order. (#1290, #1295)
 *
 * One section shows at a time. The order is the rule from the redesign: a new
 * user meets the simplest, most useful things first — About, then General —
 * and Developer is last, labelled "(advanced)". It sits in the list right
 * after Problem reports rather than pinned to the bottom, so a short window
 * still shows it. It is always listed, whether or not developer mode is on,
 * because its first item is the developer-mode switch itself.
 *
 * Appearance (#1301) follows General: how the app looks and feels, the
 * pointer in the graph view first. Tutorials and Voice (#1404, #1407) comes
 * next: how narration sounds, and the walkthrough choices. Folders (#1295) holds every folder and
 * source with its path; Problem reports is the Mac app's and is listed only
 * inside it (`macAppOnly`). A
 * remembered or requested section that isn't available — Problem reports in
 * a browser, an id from an older build — falls back to About.
 *
 * Settings reopens on the section shown last. That is per browser, like the
 * Open menu's order (#1135): the hosted PsyNeuView is one backend shared by
 * several people.
 *
 * `openSettings(section)` is how anything else in the app opens Settings at a
 * section — the Developer indicator in the toolbar (#1291), Report a Problem
 * at About. The Mac app's own ⌘, flow (`pnv:open-settings`,
 * utils/macAppSettings.ts) still works and opens the last section.
 */

export const SETTINGS_SECTIONS = [
  { id: "about", label: "About" },
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "tutorials-voice", label: "Tutorials and Voice" },
  { id: "open-menu", label: "Open menu" },
  { id: "folders", label: "Folders" },
  { id: "shortcuts", label: "Keyboard shortcuts" },
  { id: "reports", label: "Problem reports", macAppOnly: true },
  { id: "developer", label: "Developer (advanced)" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = SETTINGS_SECTIONS.map((s) => s.id);

/** The sections to list: all of them inside the Mac app, the browser's elsewhere. */
export function availableSections(inMacApp: boolean) {
  return SETTINGS_SECTIONS.filter((s) => inMacApp || !("macAppOnly" in s && s.macAppOnly));
}

/** `id` when it is listed, otherwise About. */
export function availableSectionOrDefault(id: SettingsSectionId | null, inMacApp: boolean): SettingsSectionId {
  if (id && availableSections(inMacApp).some((s) => s.id === id)) return id;
  return DEFAULT_SETTINGS_SECTION;
}

/** The section a new browser lands on. */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "about";

export const LAST_SECTION_KEY = "psyneuview.settings.lastSection";

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === "string" && (SETTINGS_SECTION_IDS as readonly string[]).includes(value);
}

/** The section shown last, or About when there is none (or storage is blocked). */
export function loadLastSection(): SettingsSectionId {
  try {
    const stored = localStorage.getItem(LAST_SECTION_KEY);
    return isSettingsSectionId(stored) ? stored : DEFAULT_SETTINGS_SECTION;
  } catch {
    return DEFAULT_SETTINGS_SECTION;
  }
}

export function persistLastSection(id: SettingsSectionId): void {
  try {
    localStorage.setItem(LAST_SECTION_KEY, id);
  } catch {
    // Storage blocked: Settings opens on About next time. Nothing else to do.
  }
}

/** Fired to open Settings; `detail.section` names a section, or is null for the last one. */
export const OPEN_SETTINGS_EVENT = "psyneuview:open-settings";

/** Open Settings, at `section` or on the section shown last. */
export function openSettings(section?: SettingsSectionId): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { section: section ?? null } }));
}

/** Call `open` whenever something asks for Settings. Returns the unsubscribe. */
export function onOpenSettings(open: (section: SettingsSectionId | null) => void): () => void {
  const handler = (e: Event) => {
    const section = (e as CustomEvent).detail?.section;
    open(isSettingsSectionId(section) ? section : null);
  };
  window.addEventListener(OPEN_SETTINGS_EVENT, handler);
  return () => window.removeEventListener(OPEN_SETTINGS_EVENT, handler);
}
