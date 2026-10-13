# UI style conventions

The palette, the five kinds of button, when to use each, and the rule for
Close ([#1302](https://github.com/jonhanke-nam/PsyNeuView/issues/1302)).
Short, because the point is that a component has nothing to decide: it
names what a colour is for and what a button is, and the look follows.

Companion docs: [how controls advertise themselves](ui-interaction-conventions.md)
(hover, the pointer), [how dialogs close](dialog-inventory.md), and
[the icon ontology](icon-ontology.md), whose node role colours are part of
the palette.

## The palette

Every colour is a CSS variable in
`frontend/src/styles/palette.css`,
imported once in `main.tsx`. A component writes `var(--pnv-text-muted)`,
never `#666`: the token says what the colour is *for*, and a colour that is
for the same thing is the same colour everywhere. Light values only; the
app has no dark theme, and when one comes it is a second block of the same
names.

| Group | Tokens | For |
|---|---|---|
| Text | `--pnv-text` `#222`, `--pnv-text-body` `#333`, `--pnv-text-secondary` `#555`, `--pnv-text-muted` `#666`, `--pnv-text-hint` `#888`, `--pnv-text-faint` `#999`, `--pnv-on-primary` `#fff` | headings and values; running text; labels and a secondary button; help text and the ×; hints and a disabled button's text; placeholders; text on the primary blue |
| Surfaces | `--pnv-surface` `#fff`, `--pnv-surface-muted` `#fafafa`, `--pnv-surface-sunken` `#f5f5f5`, `--pnv-surface-band` `#ececec`; `--pnv-text-selection` `#d4e4ff` | a dialog, an input, the page; a sidebar, a small button, a toolbar; a path box, a chip, a menu row under the pointer; the heading band across a menu (the Open menu's Actions / Catalogs / History); selected text |
| Borders | `--pnv-border` `#ccc`, `--pnv-border-light` `#ddd`, `--pnv-border-faint` `#e5e5e5`, `--pnv-disabled-bg` `#e0e0e0` | inputs and secondary buttons; small buttons and chips; dividers; a disabled filled button |
| Primary | `--pnv-primary` `#1a73e8`, `--pnv-primary-deep` `#1565c0`, `--pnv-primary-tint` `#e8f0fe`, `--pnv-primary-tint-border`, `--pnv-primary-text-on-tint`, `--pnv-primary-ring` | links, the one filled button, the selected row; text on a tint; the tint behind a selected item, a note or a condition; the glow round a focused field. There is one blue: the Inspector's `#2563eb` became this one |
| Status | `--pnv-success` `#2e7d32`, `--pnv-danger` `#c62828`, `--pnv-warning` `#b26a00`, each with a `-tint` (and `--pnv-success-border`, `--pnv-warning-border`, `--pnv-danger-border`); `--pnv-warning-text-on-tint` `#5a3e00`; `--pnv-warning-tag-text` `#8a6d00`, `--pnv-warning-tag-border` `#e0c060` | a status line, an error, a caution, and the box behind one; "placed by you" is success, the EXACT_TIME badge and the YAML-cursor row are warning; a note in an amber box (Save a copy's MDF warnings, the Tutorials reminder); an amber tag (view only, protected, read only beside the model name, and Reset to Original) |
| Marks | `--pnv-developer` `#7b1fa2`; `--pnv-unsaved` `#e65100`; `--pnv-favorite` `#f9a825`; `--pnv-code-bg`, `--pnv-code-text` | the Developer badge (#1291); the unsaved-changes dot beside the model name (#1348); a favourite's star in the Components palette; a terminal's output |
| Values | `--pnv-customized` `#9333ea` (+ `-tint`, `-border`); `--pnv-trace-value` `#1b5e20` (+ `-tint`, `-border`); `--pnv-trace-active` `#4caf50`, `--pnv-trace-glow`, `--pnv-trace-pill` `#e6f4e6` | a parameter changed from its default (the Inspector's purple bar and legend); a value at the current trace step (the value pill, Run State, "Value at this step"), the trial the trace is on in the Run panel (its card, its debugger-snapshot row, "● stepping"), and a node's output in a trial card; on the canvas, the node firing at the current step (its outline, count badge and glow) and the value pill on it |
| Value grid | `--pnv-grid-low` `#f4f6f9`, `--pnv-grid-high` `#1d3557`, `--pnv-grid-mid` `#a9b4c2`, `--pnv-grid-neg` `#fbe3c9` | a layer's values drawn as shaded cells (#1387: Run results, Run State, the value pill): low to high from light to dark; values that go negative are centred on 0 (`mid`), the negative side running to a pale warm tint. A cell's colour is a `color-mix` of two of these, from `utils/valueGrid.ts` |
| Charts | `--pnv-chart-1` … `--pnv-chart-8` | a chart's series in order: each node's line in the Run panel's trial-by-trial charts, the Learn panel's loss line (the first). Plotly cannot read `var()`, so a chart takes these through `paletteColor()` in `frontend/src/utils/paletteColor.ts` |
| Over the page | `--pnv-scrim`, `--pnv-shadow-dialog`, `--pnv-shadow-popover`, `--pnv-shadow-float`, `--pnv-shadow-flyout` | the dim behind a dialog; a dialog's and a pop-up's shadow (the node menu's too); a small thing floating over the page (a toast, a combobox's list, the focus breadcrumb, the dangling-projection list); the Components palette's flyout |
| Node roles | `--pnv-role-input` green, `--pnv-role-output` red, `--pnv-role-control` blue, `--pnv-role-learning` orange, `--pnv-role-probe` pink, `--pnv-role-internal` grey, `--pnv-role-singleton` brown, `--pnv-role-controller` purple, `--pnv-role-feedback-sender` orange, `--pnv-role-cycle` dark brown; `--pnv-role-no-gradient` brown (+ `-tint`, `-border`) | a mechanism's role, the colours PsyNeuLink's own `show_graph` uses ([icon ontology](icon-ontology.md)) — `ROLE_COLORS` in `constants/pnlTypes.ts` names them; a node the PyTorch view leaves out of the gradient |
| Graph conditions | `--pnv-gsc-before` blue, `--pnv-gsc-after` orange, `--pnv-gsc-add-edge` green, `--pnv-gsc-remove-edge` red, `--pnv-gsc-with` purple, `--pnv-gsc-other` grey; `--pnv-gsc-badge-edge`, `--pnv-gsc-badge-hover-ring` | the badge for each kind of graph-structure condition (Inspector, Scheduler tab) and its dashed edge on the canvas; the edge of the badge on the canvas and the ring round it under the pointer |
| Graph canvas | `--pnv-node-*` (border, tag, divider, three text greys), `--pnv-count-badge`, `--pnv-order-badge`; `--pnv-cursor-highlight` cyan (+ `-glow`); `--pnv-tooltip-bg`, `-text-muted`, `-accent`; `--pnv-port-input`, `-output`, `-parameter` (Okabe-Ito); `--pnv-composition*` (a frame's tag, edges, tints, and its ⛶ ▣ − controls); `--pnv-edge-default`, `-hover`, `-bend-forced`, `-label-bg`, `-legend`; `--pnv-projection-mapping`, `-control`, `-learning`, `-autoassociative`, `-inactive`, `-cim`, `-dangling`; `--pnv-gesture-condition`, `-projection`; `--pnv-shadow-node`, `-node-raised`, `-cim`, `-dangling`, `-frame`, `-badge`, `-tooltip`, `-chip`, `-banner` | the rest of what the canvas draws, each at the value it had when the graph was swept, so the canvas looks exactly as it did: a node's outline and badges, the node or edge the editor cursor is in, the dark port tooltip, port handles and an edge's ends, a composition's frame, an edge under the pointer and a bend the router placed, a projection's line and arrowhead by its type, the banner while you pick a node, and the canvas's shadows |
| Code editor | `--pnv-editor-node-tint` `#fef6e4`, `--pnv-editor-node-accent` `#e8a317` | the band behind the selected node's lines and its left edge (the selected parameter's line is the primary tint, an error's line the danger tint) |
| Walkthrough | `--pnv-walkthrough-bg`, `-border`, `-text`, `-label`, `-caption`, `-docs`; `--pnv-walkthrough-current` `#1565c0`, `-done` `#2e7d32`, `-todo`; `--pnv-shadow-pointer` | the guided walkthrough's bar, in its own pale blue, with its title, caption and "Based on:"; the step under way (its dot, the ring round what it points at, the pointer, Next ▸), a finished step, a step to come; the pointer's drop shadow (a `filter`, not a `box-shadow`) |
| Component types | `--pnv-type-*`, one per PsyNeuLink class: `--pnv-type-transfer-mechanism`, `--pnv-type-logistic`, … | a component's colour: its dot in the Components palette and its node's outline when nodes are coloured by type. `constants/pnlTypes.ts` names each class's token; the values are the ones the palette always had |

The node role colours are their own set: a button is never "INPUT green"
and a role is never "the primary blue", even where the hex values happen to
coincide today, so one can change without the other. The graph-condition
colours, the projection types and the component types are sets of their own
in the same way. White text on any filled
colour — the primary button, a condition badge — is `--pnv-on-primary`.

**A colour at an opacity.** Where code appended an alpha to a hex
(`${color}33`), it writes `color-mix(in srgb, ${color} 20%, transparent)`
instead, which works for a token as well as a hex. An SVG `fill` or
`stroke` goes in `style`, not an attribute: an attribute cannot read
`var()`.

**Where a library or an input needs a real colour.** Plotly and React
Flow's arrowhead markers cannot read `var()` (React Flow names a marker
after its colour string), and `<input type="color">` takes only a six-digit
hex. Such code asks for the token's value instead: `paletteColor(token)`
(Plotly's series, a projection's arrowhead, so the marker ids are the same
strings as before) or `paletteHex(token)` (Graph ▸ Style's colour pickers,
which start from the role and projection tokens), both in
`frontend/src/utils/paletteColor.ts`. A colour the user picks there is
theirs, kept as they chose it; it is data, not a colour the code writes.

**Adding a colour.** First look for the token that means the same thing; a
new grey between two existing greys is not a new meaning. If there is a
new meaning, add the token to `palette.css` with a comment saying what it is
for, and use it by name. A token a file uses that the palette does not
define fails `styleConventions.test.ts`, so a typo cannot silently fall
back to no colour.

## The five kinds of button

One component, `frontend/src/components/common/Button.tsx`,
with a `kind`. The size comes with the kind, or with a named `size` where a
place always had a different one (below): a file never writes a button's
padding, font size or colour of its own.

| Kind | Looks | Size | Use it for |
|---|---|---|---|
| `primary` | filled `--pnv-primary`, white text | 13px, 8×20 padding, radius 6 | the one action a dialog or a step is for: Save, Move, Apply & restart, Open, OK, Start part 1; in a panel, Run Model and Start Learning. **One per dialog.** |
| `secondary` | outlined `--pnv-border` on `--pnv-surface` | the same | Cancel, the other answer (Maybe later, Keep my changes), Choose… beside a path field in a form; Reset beside Run Model, Cancel while training |
| `small` | outlined `--pnv-border-light` on `--pnv-surface-muted` | 11px, 1×8 padding, radius 3 | an action in a row: Rename, Show in Finder, Copy path, Check now, Choose…, Reset…, Download diagnostics, Not now; + Add trial, Undo, Apply to cells, Import, Clear, Re-run |
| `link` | text only, `--pnv-primary`, no border | inherits | a cross-reference that acts: Change in Developer, Keep your checkouts current; a fold toggle written as a sentence |
| `danger` | outlined `--pnv-danger`, red text | as `small` | any button labelled Remove or Delete: Remove in Settings (a catalog, a known source, a managed copy, a kept release, and the confirming press), Remove Condition in the Inspector |

**Sizes.** A kind's own size is in the table. Where a swept place had
another size before its sweep, the button keeps it through `size`, which
changes only the box; the colours, border and radius stay the kind's:

| `size` | Text, padding | Height | Where |
|---|---|---|---|
| (none) | the kind's | 34px (primary, secondary), 17px (small, danger) | a dialog that always had 34px buttons (New model, Save a copy as…, Convert, the file-changed dialog); every row action |
| `compact` | 13px, 6×14 | 30px | Settings' Close and every Settings button that was 30px (Apply & restart, Choose…), Move…, the orientation offer, the file browser's Open and Cancel; Reset and Run Model; Remove Condition; the error page's Reload |
| `slim` | 13px, 3×14 | 24px | Start Learning and Cancel in Learn |
| `tall` | 11px, 3×10 | 21px | a row of actions under a list: + Add trial, Import, Clear, Re-run, + Add Execution / Graph / Termination Condition; the Inspector's inline Save and Cancel (primary and secondary at row size); the Mac app's Browse… and Apply & restart, beside a 22px field; Convert to Standard Format and Revert to Original in Model Diagnostics |
| `line` | 11px, line 18px, 0×6 | 20px | a button inside a condition's line (its ✕, Edit, a child's ✕) |
| `icon` | 11px, line-height 1, 0×5 | 13px | the row × or + on a line of 11–13px text: a port header's + and ×, a trial's ✕, a recent run's ✕, a termination condition's ✕ |

**A restyle keeps the old size: colour moves, size stays.** A sweep that
puts a place on the palette and the kinds keeps each row's and control's
height, font size and baseline, and keeps side-by-side things the same size
and in line. A kind's default size that would grow or shrink a row is the
wrong size for that place: give it the `size` it had (or add one to `Button`
if no size fits, rather than a one-off override). This is a strong
guideline, not an absolute rule; when a different size is genuinely better,
say so and why in the PR. `frontend/e2e/style-sizes.spec.ts` holds the
swept areas to their measured pre-sweep heights within 2px.

Disabled: a primary goes `--pnv-disabled-bg` with `--pnv-text-hint` text;
the others fade. Hover comes from `index.css`'s global `button:hover`, as
for every button (see the interaction conventions).

**Small or danger?** A button that says **Remove** or **Delete** is
`danger`, red, wherever it is: in Settings, in the Inspector, as the first
press or the confirming one. It doesn't matter whether the thing goes from
disk, from a list or from the model; a red Remove is the one signal a user
reads at a glance, and it means "pay attention". Warnings are red or orange
the same way, in `--pnv-danger` or `--pnv-warning`.

**The row ×.** A small icon-only × or ✕ that removes something from a row
(a port, an execution, graph or termination condition, a child of All/Any,
a trial in the Run panel's inputs, a run from Recent runs)
stays `small` and grey, with the `pnv-remove-x` class: it turns red when
pointed at (`index.css`). It is `size="icon"` (13px) on a line of text and
`size="line"` (20px) in a condition's line, so it is never taller than the
line it sits on. One per row would turn a panel red; red on hover
gives the warning when it counts.

A danger button at the regular size has no home yet; when it does, it is
the same kind. (The Learn panel's filled red button turned out to be
Cancel, shown while a job trains: not a Remove, so it is `secondary`, the
other answer to Start Learning.)

**Not a kind.** A control that happens to be a `<button>` but is not one of
these — a sidebar item, a fold heading, a listbox row, a chip, a key
recorder, a toolbar toggle, the segments of a segmented control (the Run
panel's Node / Trial grouping, Export JSON / YAML, a layer's list / grid), an
on/off toggle (Δ diff) — keeps its own style, written with tokens. The
report counts them (below), and the swept files list theirs by name.

**Toolbar toggles and menu rows.** The toolbars' own controls are not kinds
either: a toggle is on or off rather than an action, and a menu row is a
line in a list. What they share lives in
`frontend/src/components/common/toolbarStyles.ts`, so "on" looks the same
in both toolbars and their menus, while each control keeps the size it had:

- `toggleColours(on)`: on is blue-tinted with a blue edge
  (`--pnv-primary-tint`, `--pnv-primary`), off is white with a grey edge
  (`--pnv-surface`, `--pnv-border`). The graph toolbar's Roles, Dims,
  Names… and More ▾, Layout: Auto, the palette ◧, and the main toolbar's
  Layout ▾ and Tutorials ▾ while their menu is open (or a walkthrough runs).
- `menuRowColours(current)`: the current row of a menu (a visible panel,
  the running walkthrough, a More toggle that is on) is tinted, blue and
  bold; `MENU_ROW_HOVER` (`--pnv-surface-sunken`) is the grey under the
  pointer on any other row.

The toolbar's plain buttons (⚙, Open ▾, Save, Save a copy as…, Reset
Custom Layout) are toolbar-sized, smaller than `secondary`, and are not a
kind for the same reason: a kind would change the toolbar's height.

**The ×.** The icon-only close is `DialogCloseButton` in
`dialog/DialogHeader.tsx`, the one icon button, and every dialog gets it
from `DialogHeader`. Its colours are tokens (`--pnv-text-muted`), and it
keeps its own three sizes, which are not a Button kind's: **full** (28px,
a dialog's header), **compact** (22px, a pop-up panel such as History) and
**inline** (a 14px glyph inside a line of text: a toast, the legend, the
Open menu's note), the size those one-line boxes always had, so the × stays
centred on the line. A × that already looked right keeps its size; the
full-size × is for places that had none ([dialog inventory](dialog-inventory.md)).

## The Close rule

Follow macOS: a dialog has one default button, and Return presses it.

- **A dialog whose only way out is closing** — Settings, and About within
  it — makes **Close the default button: `primary`, blue**, with
  `isDefault`, so Return closes it. (This is the case that started it all:
  Settings' Close was grey, and a user asked why.)
- **A dialog with a real action** — Save, Move…, Apply & restart, Open,
  OK, Convert, Load from disk — makes **that action `primary`** and Close or
  Cancel **`secondary`**. The action is the default where the dialog
  already submits on Return (a prompt's field); nothing else gains Return
  by being primary.

`isDefault` is deliberately narrow: Return does not reach it from a text
field (a path being typed), from a focused control (Return on a focused
button presses that button), or while a dialog opened on top is still open
(Move… over Settings: Escape closes Move…, and only then does Return close
Settings). Escape and the × are the other way out, always
([dialog inventory](dialog-inventory.md)).

## Checks

- **`frontend/scripts/style-report.mjs`** (`node scripts/style-report.mjs`
  in `frontend/`) lists, per file, the colour literals and inline-styled
  `<button>`s outside the tokens and `Button`. Every file is swept now, so
  with `--check` it **fails** on any colour written by hand outside the
  allowed exceptions (below), and on a token `palette.css` does not define;
  the Frontend workflow runs it on every PR. An issue number is not a
  colour: `"#1234"`, and a bracketed `(#258)` in a tooltip, are skipped, and
  an apostrophe in JSX text ("PsyNeuLink's") does not start a string, so the
  comments after it are still stripped.
- **`frontend/src/styleConventions.test.ts`** (vitest) runs the same scan
  and fails for any file that writes a colour by hand again (bar the
  exceptions), for any file whose count of non-kind `<button>`s changes
  without the table there (`REMAINING_RAW_BUTTONS`) being updated, for any
  file using a token the palette does not define, and for a component type
  or node role without its token.
- **`frontend/e2e/style-sizes.spec.ts`** (Playwright, in the CI list) holds
  the heights of the swept areas' buttons and rows — Settings' footer,
  Move…, the file browser, the orientation offer, both toolbars, the
  Inspector's port header and condition line, the Run panel's Run row,
  trial × and Trial header, Learn's Start — to the numbers measured on the
  builds before each sweep, within 2px, and checks side-by-side buttons are
  level. A sweep that grows a row fails it.
- **`frontend/e2e/style-conventions.spec.ts`** (Playwright) opens Settings,
  Move…, New model and Open a model and reads the computed styles of
  primary, secondary, small and danger buttons and the × back against the
  values in `palette.css`, and checks the Close rule: Return closes
  Settings, but not from a field and not while Move… is open on top.

## Allowed exceptions

A colour a palette token cannot sensibly be, listed with its reason in
`ALLOWED_COLOURS` in `scripts/style-report.mjs`, the one place both checks
read:

- **`utils/graphCursor.ts`** (`#000`, `#fff`): the graph pointer is an
  image, an SVG drawn into a `data:` URL for `cursor: url(…)`, which cannot
  read a CSS variable; its black arrow with a white edge is the system
  pointer's look, not a palette colour.

Not exceptions, because the code writes no colour: the role and edge
colours a user picks in Graph ▸ Style (their data, kept as chosen), and
the SVG that PsyNeuLink's own `show_graph` returns, drawn in its colours.

## New code

Every area is swept (#1302): Settings and the dialogs, the Inspector, the
Run and Learn panels, the toolbars, the code editor's header, Run State,
the Scheduler tab, the graph, and the rest — the Components palette, Model
Diagnostics, Graph ▸ Style, show_graph, the walkthrough bar, toasts, the
combobox, the component types and projection edges, and `index.css`. In
new code: colours are tokens (add one, with its meaning, if none fits),
buttons are kinds at the size the place needs, and a control that is not a
kind keeps its own style on tokens and is named in `REMAINING_RAW_BUTTONS`
in `styleConventions.test.ts`.

**The Inspector's zoom.** The Inspector scales its text with A-/A+, and
its buttons scale with it: a `Button` there passes
`style={{ fontSize: s(11) }}` (row-sized kinds, and the `tall`, `line`
and `icon` sizes) or `s(13)` (primary and secondary, and `compact`) — the
size's own font times the zoom, so at 100% it is exactly the size. That is the one size a file may still write.
