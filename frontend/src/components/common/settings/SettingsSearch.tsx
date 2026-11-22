/**
 * The search field at the top of Settings, and its results (#271).
 *
 * Typing replaces the sidebar's sections with the settings that match, each
 * with the section it is in. Choosing one opens that section and takes you to
 * the control (`revealSettingControl`). Esc clears the field; with it empty,
 * Esc closes Settings as before. ⌘F (Ctrl+F) focuses it while Settings is open.
 */
import { forwardRef, useEffect, type RefObject } from "react";
import { searchSettings, type SettingsSearchEntry } from "./settingsSearchIndex";
import { REVEAL_SETTING_EVENT } from "./shared";

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  inMacApp: boolean;
  /** Whether this deployment has the AI assistant (#179); its settings are found only then. */
  assistant?: boolean;
  onChoose: (entry: SettingsSearchEntry) => void;
}

export const SettingsSearchField = forwardRef<HTMLInputElement, Props>(function SettingsSearchField(
  { query, onQueryChange, inMacApp, assistant = false, onChoose },
  ref,
) {
  return (
    <input
      ref={ref}
      type="search"
      value={query}
      placeholder="Search settings"
      aria-label="Search settings"
      data-testid="settings-search"
      onChange={(e) => onQueryChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && query) {
          // Clear first; the next Esc closes Settings (useDismiss).
          e.preventDefault();
          e.stopPropagation();
          onQueryChange("");
        } else if (e.key === "Enter") {
          // Return takes you to the best match, not to the Close button.
          e.preventDefault();
          e.stopPropagation();
          const best = searchSettings(query, { inMacApp, assistant }).matches[0];
          if (best) onChoose(best);
        }
      }}
      style={{
        width: "100%",
        boxSizing: "border-box",
        marginBottom: 8,
        padding: "5px 8px",
        fontSize: "var(--pnv-fs-13)",
        color: "var(--pnv-text-body)",
        background: "var(--pnv-surface)",
        border: "1px solid var(--pnv-border)",
        borderRadius: 6,
      }}
    />
  );
});

export function SettingsSearchResults({ query, inMacApp, assistant = false, onChoose }: Omit<Props, "onQueryChange">) {
  const { matches, closest } = searchSettings(query, { inMacApp, assistant });
  const item = (e: SettingsSearchEntry) => (
    <button
      key={e.id}
      type="button"
      onClick={() => onChoose(e)}
      data-testid="settings-search-result"
      data-setting={e.id}
      className="pnv-settings-search-result"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 1,
        textAlign: "left",
        padding: "5px 10px",
        border: "none",
        borderRadius: 6,
        background: "transparent",
        cursor: "pointer",
      }}
    >
      <span style={{ fontSize: "var(--pnv-fs-13)", color: "var(--pnv-text-body)" }}>{e.name}</span>
      <span style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-secondary)" }}>
        {e.where}
        {e.shownWhen && <span data-testid="settings-search-shown-when"> · shown when {e.shownWhen}</span>}
      </span>
    </button>
  );
  if (matches.length) {
    return (
      <div role="list" aria-label="Matching settings" style={{ display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
        {matches.map(item)}
      </div>
    );
  }
  return (
    <div data-testid="settings-search-none" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-secondary)", padding: "4px 10px" }}>
        No setting matches “{query.trim()}”.
        {closest.length > 0 && " Closest:"}
      </div>
      {closest.map(item)}
    </div>
  );
}

/** ⌘F (Ctrl+F) focuses the search field while Settings is open. */
export function useFindFocuses(field: RefObject<HTMLInputElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        field.current?.focus();
        field.current?.select();
      }
    };
    // Capture, so the editor's own Find doesn't take it while Settings is up.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [field, active]);
}

const FLASH_MS = 1600;

/**
 * The whole setting around a control: its name and description too. The
 * widest block around it that holds no other setting's control and isn't a
 * whole group.
 */
function settingRow(control: HTMLElement, root: HTMLElement): HTMLElement {
  let row = control;
  for (let p = control.parentElement; p && p !== root; p = p.parentElement) {
    const others = Array.from(p.querySelectorAll('[data-testid^="setting-"]')).some(
      (c) => c !== control && !control.contains(c) && !c.contains(control),
    );
    if (others || p.tagName === "DETAILS" || p.tagName === "SECTION" || p.offsetHeight > 260) break;
    row = p;
  }
  return row;
}

/**
 * Bring a setting's control into view and flash it. The section has just been
 * switched to, so the control may not be rendered yet (or may wait on data the
 * section fetches); look for it for a few seconds, then call `onMissing` (a
 * control shown only sometimes, or a simple view that isn't). Returns a
 * cancel function.
 */
export function revealSettingControl(
  root: HTMLElement | null,
  control: string,
  onMissing?: () => void,
): () => void {
  let cancelled = false;
  const started = Date.now();
  // A folded group that holds it unfolds first.
  window.dispatchEvent(new CustomEvent(REVEAL_SETTING_EVENT, { detail: control }));
  const look = () => {
    if (cancelled || !root) return;
    const el = root.querySelector<HTMLElement>(`[data-testid="${control}"]`);
    if (!el) {
      if (Date.now() - started < 2500) requestAnimationFrame(look);
      else onMissing?.();
      return;
    }
    // Open any folded group it is in.
    for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
    const row = settingRow(el, root);
    row.scrollIntoView({ block: "center" });
    row.classList.remove("pnv-setting-flash");
    void row.offsetWidth; // restart the animation if it is already running
    row.classList.add("pnv-setting-flash");
    row.setAttribute("data-search-target", "");
    window.setTimeout(() => {
      row.classList.remove("pnv-setting-flash");
      row.removeAttribute("data-search-target");
    }, FLASH_MS);
  };
  requestAnimationFrame(look);
  return () => {
    cancelled = true;
  };
}
