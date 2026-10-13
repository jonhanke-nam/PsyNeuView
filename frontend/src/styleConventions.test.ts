/**
 * The palette and the button kinds, held across the whole frontend. (#1302)
 *
 * docs/ui-style-conventions.md: colours are palette tokens (styles/palette.css)
 * and buttons are the Button component's kinds. scripts/style-report.mjs
 * lists, per file, the colour literals and inline-styled <button>s that
 * remain. Every file is swept now, so this test takes the same scan and
 * fails for:
 *
 *  - any file that writes a colour by hand, except the exceptions the report
 *    allows (ALLOWED_COLOURS in scripts/style-report.mjs, each with why);
 *  - any file whose number of inline-styled <button>s changes — those that
 *    remain are controls that are not one of the kinds (a sidebar item, a
 *    fold heading, a listbox row, a chip, the ×, a toolbar toggle or menu
 *    row), listed below with what they are, so a new one has to be named
 *    here;
 *  - a token any file uses that palette.css does not define (a typo would
 *    otherwise fall back to no colour at all, silently).
 *
 * A source check, not a render: e2e/style-conventions.spec.ts checks the
 * computed styles in a browser against the tokens.
 */
import { describe, expect, it } from "vitest";
import { ALLOWED_COLOURS, paletteTokens, scan, unallowedColours } from "../scripts/style-report.mjs";
import { CHART_SERIES } from "./utils/paletteColor";
import { ALL_PNL_DEFS, ROLE_TOKENS } from "./constants/pnlTypes";

/**
 * The inline-styled <button>s a file still has, each a control that is not
 * one of the five kinds. The count must match exactly: one fewer means a row
 * here is stale, one more means a new raw button. A file not listed has none.
 */
const REMAINING_RAW_BUTTONS: Record<string, { count: number; what: string }> = {
  "components/common/SettingsPanel.tsx": { count: 1, what: "the sidebar's section items" },
  "components/common/settings/shared.tsx": { count: 1, what: "a group's fold heading" },
  "components/common/settings/InstallControls.tsx": { count: 1, what: "the Switch to trigger, drawn like a select" },
  "components/common/settings/OpenMenuSection.tsx": { count: 1, what: "the ▲ ▼ reorder arrows" },
  "components/common/settings/ShortcutsSection.tsx": { count: 1, what: "a shortcut's key chip, which records when pressed" },
  "components/common/settings/SwitchListbox.tsx": { count: 3, what: "a group heading, an option row, Show older" },
  "components/common/FileBrowserModal.tsx": { count: 2, what: "a root folder chip, ↑ Up" },
  "components/common/HistoryPanel.tsx": { count: 2, what: "the History toggle in the editor header; a save marker row (#1349)" },
  "components/common/ValueGrid.tsx": { count: 1, what: "the list / grid segments beside a layer's values (#1387)" },
  "components/common/dialog/DialogHeader.tsx": { count: 2, what: "the × at its full/compact size, and inline" },
  "components/layout/AutosaveStatus.tsx": { count: 1, what: "the autosave status beside the model name, which opens Settings" },
  "components/inspector/InspectorPanel.tsx": { count: 1, what: "the STANDARD / EXACT_TIME scheduler-mode badge, a toggle drawn as a pill" },
  "components/inspector/RunPanel.tsx": {
    count: 7,
    what:
      "the Node / Trial grouping segments; the Export JSON and YAML segments; the Δ diff on/off toggle; " +
      "the Show N warnings fold on a failed run; a trial card's ×N steps fold; a debugger-snapshot category chip",
  },
  "components/layout/Toolbar.tsx": {
    count: 35,
    what:
      "toolbar-sized buttons and menu triggers (⚙, Open ▾, Save, Save a copy as…, Layout ▾, Tutorials ▾: 6); " +
      "the Open menu's rows (actions, catalog models, a folder heading, recent files: 14) and a section's fold heading and ⇅ reorder (2); " +
      "the Layout and Tutorials menus' rows (6) and a Tutorials section's fold heading (1); the tags beside the model name (the unsaved dot, view only, the checkout tag, Reset to Original for a demo and for a reference model: 5); " +
      "the reminder's quiet Don't remind me (1)",
  },
  "components/layout/DeveloperModeIndicator.tsx": { count: 3, what: "the Developer badge that opens its menu, and that menu's two rows" },
  "components/graph/GraphToolbar.tsx": {
    count: 6,
    what: "the palette ◧ toggle, Layout: Auto/Custom, Reset Custom Layout, a display toggle (Roles, Names, Ports…), More ▾ and a More row",
  },
  "components/editor/CodeEditor.tsx": {
    count: 6,
    what:
      "the header's font size A- and A+ (2), and the narrow header's − and + (2), smaller than a small button; " +
      "the + Snippet menu trigger and a snippet menu row (2)",
  },
  "components/editor/SidecarVariantPicker.tsx": {
    count: 4,
    what: "the Layout / Labels trigger, drawn like a select; a variant's name row, + Add variant, and a row's ↑ ↓ ↺ ✎ ⧉ ✕ icons",
  },
  "components/editor/SidecarPlacementPicker.tsx": { count: 2, what: "the Files: trigger, drawn like a select; a placement row" },
  "components/scheduler/SchedulerPanel.tsx": { count: 2, what: "the font size A- and A+, the editor header's size" },
  "components/graph/MechanismNode.tsx": { count: 1, what: "a collapsed composition's + on the node" },
  "components/graph/CompositionNode.tsx": { count: 3, what: "a frame's ⛶ focus, ▣ inset toggle and − collapse" },
  "components/graph/GSCLegend.tsx": { count: 1, what: "the Legend button that shows a hidden legend" },
  "components/graph/GraphCanvas.tsx": { count: 1, what: "Compare with that version, in the stale-graph banner" },
  "components/graph/TraceControls.tsx": {
    count: 8,
    what: "the trace bar's ⏮ ◀ ▶ ⏭ (4), its run / trial segments (2), autoplay ⏵⏵ (1) and ✕ clear (1), at the bar's size",
  },
  "App.tsx": { count: 2, what: "a bottom-panel tab, and the ⌄ that collapses the panel" },
  "components/graph/PaletteSidebar.tsx": {
    count: 5,
    what:
      "a category's fold heading; the header's ◀ / ✕ icon squares; the compact flyout's breadcrumb segments, " +
      "its ✕ and a sub-category row",
  },
  "components/common/DiagnosticPanel.tsx": { count: 2, what: "the quiet collapse; the auto-conversion's Undo chip, 10px in a line of 11px text" },
  "components/common/TourBar.tsx": {
    count: 8,
    what:
      "the walkthrough bar's buttons at the bar's size and in its blue (Open the model, fit the graph, Next, " +
      "Pause, Replay, Skip, Narration, End); kept as they were while the walkthroughs are being written",
  },
  "components/inspector/ShowGraphPanel.tsx": { count: 5, what: "Refresh among the option checkboxes; the zoom bar's −, +, Fit and 100% (22px)" },
  "components/graph/GraphStylePanel.tsx": { count: 2, what: "Apply and Reset, 12px text on 4×14, a size no kind has" },
  "components/common/UndoRedoButtons.tsx": { count: 2, what: "the toolbar's ↩ ↪ pair, joined, at the toolbar's size" },
  "components/graph/ValidationPanel.tsx": { count: 3, what: "the list's fold heading; a projection's name, which jumps to its line, for an unconnected and for a refused connection" },
  "components/graph/FocusBreadcrumb.tsx": { count: 2, what: "the breadcrumb's ⌂ Full model and a parent composition's crumb" },
  "components/graph/NodeContextMenu.tsx": { count: 1, what: "a menu row" },
  "components/graph/OffscreenNodesIndicator.tsx": { count: 1, what: "the off-screen notice over the canvas, which fits the graph" },
  "components/common/Combobox.tsx": { count: 1, what: "the ▼ inside the field that opens its list" },
};

const rows = scan();
const byFile = new Map(rows.map((r) => [r.file, r]));

describe("style conventions (#1302)", () => {
  it("lists only files that exist", () => {
    for (const f of Object.keys(REMAINING_RAW_BUTTONS)) expect(byFile.has(f), `${f} is not under src/`).toBe(true);
    for (const f of Object.keys(ALLOWED_COLOURS)) expect(byFile.has(f), `${f} is not under src/`).toBe(true);
  });

  it("writes no colour by hand, anywhere, beyond the allowed exceptions", () => {
    for (const r of rows) {
      expect(unallowedColours(r), `${r.file} writes colours itself; use a palette token (styles/palette.css)`).toEqual([]);
    }
  });

  it("allows only exceptions that are still used", () => {
    for (const [f, { literals }] of Object.entries(ALLOWED_COLOURS)) {
      expect([...byFile.get(f)!.colours].sort(), `${f}: ALLOWED_COLOURS is stale`).toEqual([...literals].sort());
    }
  });

  it("keeps each file's inline-styled <button>s to the ones named here", () => {
    for (const r of rows) {
      const allowed = REMAINING_RAW_BUTTONS[r.file]?.count ?? 0;
      expect(
        r.buttons,
        `${r.file}: ${r.buttons} inline-styled <button>s, ${allowed} expected (${REMAINING_RAW_BUTTONS[r.file]?.what ?? "none"}); use Button, or name the new one in REMAINING_RAW_BUTTONS`,
      ).toBe(allowed);
    }
  });

  it("uses only tokens palette.css defines", () => {
    const defined = paletteTokens();
    expect(defined.size).toBeGreaterThan(20);
    for (const r of rows) {
      for (const t of r.tokens) expect(defined.has(t), `${r.file} uses ${t}, which styles/palette.css does not define`).toBe(true);
    }
  });

  it("defines the chart series colours that paletteColor() reads", () => {
    // Charts take their colours through paletteColor(), not var(), so the
    // check above cannot see them.
    const defined = paletteTokens();
    for (const t of CHART_SERIES) expect(defined.has(t), `styles/palette.css does not define ${t}`).toBe(true);
  });

  it("defines a token for every component type and node role", () => {
    const defined = paletteTokens();
    for (const d of ALL_PNL_DEFS) {
      const m = /^var\((--pnv-type-[a-z0-9-]+)\)$/.exec(d.color);
      expect(m, `${d.type}'s colour should be a --pnv-type-* token, not ${d.color}`).not.toBeNull();
      expect(defined.has(m![1]), `styles/palette.css does not define ${m![1]}`).toBe(true);
    }
    for (const t of Object.values(ROLE_TOKENS)) expect(defined.has(t), `styles/palette.css does not define ${t}`).toBe(true);
  });

  it("defines nothing twice in palette.css", () => {
    const names = [...paletteTokens()];
    expect(new Set(names).size).toBe(names.length);
  });
});
