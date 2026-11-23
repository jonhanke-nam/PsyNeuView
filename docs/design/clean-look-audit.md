# A clean, Apple-like look: audit (#109)

An audit of the app against the principles in #109, taken on 2026-11-22
from `origin/devel` at 8cae2642 (version 0.6.15) in Chrome at 1440×900. It
covers the empty window, a reference model loaded (Stroop, basic), the
toolbar menus (Open, Layout, Tutorials, Help), the graph's Advanced Graph
View Options panel and node menu, the bottom panel's tabs (Inspector,
Scheduler, Run, Learn, Run State, show_graph, Style), the Components panel
and Settings.

The principles, from #109 and [the style conventions](../ui-style-conventions.md):

1. Fewer things visible by default, the rest one click away.
2. Generous spacing and type.
3. One obvious control for each thing.
4. Palette tokens and the five button kinds.
5. A native Mac feel.

## The first pieces: all on devel

| Piece | Issue | State on devel |
|---|---|---|
| The graph fills the window | #110 | Shipped. The window opens with the graph alone (#189); with the code editor shown it starts at about a quarter of the width, and the model is fitted (`graph-fills-window.spec.ts`). |
| A bigger font | #111 | Shipped. Text size 1.1× by default, one setting in Settings ▸ Appearance; every UI size is a `--pnv-fs-*` token. |
| Ports hidden, one Show ports switch | #112 | Shipped. No port dots and no Ports section in the Components panel by default; Show ports is a checkbox in Advanced Graph View Options. |
| The Components panel opens as the word list | #113 | Shipped (via #119, a setting). It opens as the full panel with its sections **folded**, as #113 asked. (#114, which opened the sections, was closed as a misreading.) |

Also shipped under #109: names only on nodes (#122), scheduling arrows
hidden and one Advanced Graph View Options panel (#123), arrowheads at the
end of each line (#121), the watching status in the diagnostics bar (#103).

## What this branch fixes

Low-risk changes that need no new design decision. Each keeps the layout:
the rows and the toolbar keep their heights, measured before and after.

| # | Finding | Principle | Fix | Measured before → after |
|---|---|---|---|---|
| 1 | The main toolbar's buttons came in three heights: Layout ▾, Tutorials ▾, Open ▾, Save, Help 27px; ⚙ and ↩ ↪ 21.4px; History 17px in 11px faint type. | 3, 5 | ⚙ and ↩ ↪ stretch to the bar's button height (glyphs unchanged); History is a menu trigger drawn like Layout ▾ beside it. | ⚙ ↩ ↪ 21.4 → 27px, History 17 → 27px (11 → 14.3px type); toolbar 44 → 44px. |
| 2 | Code type was the generic `monospace`, which is **Courier** on macOS (Chrome and the Mac app's web view): the code editor, the model name in the toolbar, the Run panel's element names, the STANDARD scheduler badge, paths in Settings. A typewriter face beside the system font. A few places already used SF Mono, so code type came in two faces. | 5, 4 | One token, `--pnv-font-mono` (SF Mono, then Menlo); `index.css` gives it to the code editor and `code`/`pre`/`kbd`. A test fails on a new bare `"monospace"`. | Editor lines 19.6 → 19.6px and wrap at the same places; `red_ink` 46.2 → 46.4px wide; badge 73.6×16 → 73.8×16. |
| 3 | The Scheduler tab drew its own A- A+, darker (`#f5f5f5` on `#ccc`) than the Inspector's one tab over (`#fafafa` on `#ddd`). | 3, 4 | The Inspector's small Buttons. | 19 → 19px; header row 23 → 23px. |
| 4 | A node's menu opened on the bottom row (the inputs' row, by convention) ran off the bottom of the window, items out of reach; the canvas menu did the same at the right edge. | 5 | Menus open upward / leftward near the window's edge, as macOS menus do (`useMenuInWindow`). | Node menu top 870px in a 900px window (only "Expand Node" visible) → 715px, all five items. |

Review sheets (before above, after below) were made for each.

## Proposals awaiting a decision

Ranked by how visible they are and how much they would do for a first
look. None is built; each changes what the app shows or names, so it is
yours to decide.

1. **Three things called "Layout".** The main toolbar's Layout ▾ (which
   panels show), the graph toolbar's Layout: Custom / Reset Custom Layout and
   the Like show_graph picker (where nodes go), and the code editor's
   Layout: Default (which saved layout variant). A new user meets all three
   at once. Proposal: the toolbar's menu becomes **View ▾** (panels, as
   in Mac apps); the graph's placement controls become one **Arrange ▾**
   (Like show_graph / Layered / Custom, Reset); the editor's picker is named
   for what it holds (Saved layouts ▾). Needs naming agreed with the
   PsyNeuLink vocabulary (no duplicate names).
2. **The code editor header is three rows of controls.** File picker, +2
   files, cursor position, − A +, +; then Layout: Default and Labels:
   Default; then Files: beside .py (default). That is the busiest corner of
   the window. Proposal: one row by default — the file name and − A + —
   with the variant pickers and file placement behind one **⋯** menu (or in
   Settings when they are rarely changed).
3. **Two different STANDARDs.** The toolbar's green STANDARD tag beside the
   model name means "the file is in the standard model format"; the
   Scheduler tab's blue STANDARD pill means "the scheduler's mode". Same
   word, two looks, two meanings. Proposal: drop the format tag unless the
   file is *not* standard (show only "free-form" or "converted", the cases
   that need attention), and keep the scheduler pill in the Scheduler tab.
4. **The diagnostics bar is always there and always amber when there is a
   note.** A full-width band under the toolbar with a count badge, a
   "click to expand" hint and Watching for changes. Proposal: no "click to
   expand" text (hover already says it), the neutral toolbar grey when the
   only notes are informational, amber only for something to act on.
5. **The Components panel has four show/hide controls.** ◧ in the graph
   toolbar, ◀ (collapse to the icon strip) and × in the panel's header, and
   Layout ▸ Components panel (⌘4). Proposal: keep ⌘4 / the menu item and
   one control in the panel (×); the icon strip becomes a setting only.
6. **Headings in letter-spaced capitals.** MECHANISMS, PRESETS, ACTIONS,
   CATALOGS, ABOUT PSYNEUVIEW, WHAT THE GRAPH SHOWS. Mac apps use small
   sentence-case grey headings (Finder's sidebar, System Settings).
   Proposal: sentence case at the same size and weight. Purely visual, but
   it touches every menu and panel, so it wants a yes first.
7. **Advanced Graph View Options opens over the Components panel.** It is
   anchored to the graph pane's left edge, not to its button, so it covers
   the panel and sits far from where the click was. Proposal: drop it from
   its button like the toolbar's menus.
8. **"..." and "…" side by side.** Open from path..., Import MDF..., New
   Model... use three dots; Save a copy as…, Rename…, Report a Problem…
   use the ellipsis character, as macOS does. Proposal: the ellipsis
   everywhere. Mechanical, but many specs select by these labels, so it is
   a sweep of its own.
9. **Settings is in the Layout menu.** ⚙ beside the app name, ⌘, and
   Layout ▸ Settings… all open it. A Mac app keeps Settings in the app menu
   only; in the browser the ⚙ is that place. Proposal: drop it from Layout
   (one obvious control); Help could carry it instead if a menu entry is
   wanted.
10. **Always-on legends.** The Inspector shows "customized · at default ·
    reset on hover" above every node's parameters; the undo pair shows a
    faint history count. Proposal: show the legend only when something is
    customized; drop the count (History says it).
11. **The graph's corner controls.** + − ⛶ 🔒 (React Flow's defaults) at
    the bottom left: zoom also lives in Layout ▾ and on the trackpad, and
    the lock's meaning isn't obvious. Proposal: keep Fit only, or hide them
    behind a setting.
12. **Run panel's Backend picker and Group by segments** are a native
    select and a home-made segmented control at different heights from the
    Run Model / Reset buttons. Proposal: a native-looking segmented control
    and a select at the row's height; wants a pass over the Run row with
    measurements.

Follow-ups that need no decision but were left out of this branch on
purpose:

- The graph canvas's own labels (edge labels, node tags, CIM and dangling
  nodes) still use the generic `monospace`. They are named in
  `styleConventions.test.ts` and move to `--pnv-font-mono` once the canvas
  work in flight lands.
- In a narrow code pane the file picker's text runs under its arrow
  ("stroop_referen▾").
- `e2e/style-conventions.spec.ts` (not in the CI list) expects 13px primary
  buttons and fails on devel since the 1.1× text size (#111): its numbers
  need the scale.
