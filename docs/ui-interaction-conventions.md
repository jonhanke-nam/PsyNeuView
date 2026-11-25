# UI interaction conventions

How interactive elements advertise themselves. Short, because there is really
only one rule with three consequences.

## The rule

**If a press at position X does something, hovering X must say so.**

Three consequences, all worth checking when you add a control:

1. **Actionable implies highlighted.** Hover feedback does not wait for the
   parent to be selected. A control that only changes appearance once you have
   already committed to it cannot be discovered, only stumbled upon.
2. **The reveal region contains the action region.** Never the reverse. If the
   grab target is 24px wide, the highlight must not be triggered by a 20px one —
   the difference is a band where the control works but looks inert.
3. **The reveal survives the approach.** Once shown, hovering the control keeps
   it shown. A highlight that retracts as the pointer travels toward what it
   revealed makes the target flicker in and out from under the cursor.

## Why this needs saying at all

`index.css` carries a global rule:

```css
button:hover { filter: brightness(0.97); }
```

Every real `<button>` therefore gets hover feedback whether or not anyone
thought about it. **Nothing else does.** A `<div onClick>`, a clickable `<span>`,
an SVG affordance on the canvas — all get nothing unless someone wires it by
hand.

That asymmetry is the whole problem. Compliance across the app currently
correlates with element type rather than with intent, which means the codebase
looks well-behaved right up until someone adds a clickable div, and then it
silently is not. An audit under #984 found the app almost entirely compliant —
because it mostly uses `<button>`, not because the rule was being applied.

**So: prefer `<button>` for anything clickable.** You get the affordance, plus
keyboard focus and screen-reader semantics, for free. Reach for a div only when
you genuinely cannot use a button, and then wire hover deliberately.

## What already counts as compliant

Not every interactive element needs a hand-written hover state.

- **Native controls** — `<button>`, `<select>`, `<summary>`, a `<label>` wrapping
  a checkbox. The browser supplies the affordance.
- **Drag surfaces signalled by cursor** — a pannable canvas with
  `cursor: "grab"` that flips to `"grabbing"` on press. The cursor *is* the
  hover feedback, and this is the conventional treatment. `ShowGraphPanel`'s pan
  container and the GSC legend both work this way.

What is *not* compliant is a `div` with `onClick` and `cursor: "pointer"` and
nothing else. That is a control wearing a costume.

## The pointer in the graph view (#1301)

Over the **canvas, nodes and edges** the pointer is the **arrow**, whose tip
is the exact point that clicks. React Flow's stylesheet puts a grab hand on
the pane and a pointer or grab hand on nodes and edges; `index.css`
overrides those under `.graph-pointer-image`, with the image coming from
`utils/graphCursor.ts` at the size chosen in Settings ▸ Appearance. The
**grabbing hand** shows only while a drag is in progress — the canvas being
panned, a node being moved — which is when it carries meaning. Settings ▸
Appearance also offers **Hand** — our own open hand where React Flow put its
grab hand, closing while held (#40) — and two precise pointers (#40): a
**crosshair** and a **circle**, each clicking at its centre (the hot spot is
half the image's size) where a dot is drawn, and drawn heavier while the
button is held over a node or edge, as feedback for the click. **Pointer
size** covers all four and the grabbing hand, which is the drag cursor under
every choice.

The arrow is the *default*, not a replacement for every cursor. A real
control keeps the cursor that says what it does, under either setting:

- A `<button>` inside a node (expand, focus, collapse) and a clickable edge
  label say **pointer** — a click affordance on a control, as above.
- A drag surface with an area — the GSC legend's title bar — says
  **grab**, and **grabbing** while held: a drag surface signalled by cursor,
  as above. Under "hand" the edge's hit path shows the hand too
  (`.projection-edge-hit`), since that is a drag surface in the hand's
  idiom; under the arrow it stays the arrow.
- A **control point** — an edge's bend handle, an attachment dot — is a
  point, so it shows the *precise* pointer and never the hand, under every
  setting (#40): the arrow under Arrow and Hand, the crosshair or circle
  under those, with the pressed look while it is held and dragged. In code,
  the `graph-control-point` class; `index.css` reads the pointer from the
  `--graph-pointer-point-cursor` variables GraphCanvas sets. The handle's
  hover growth is what says it can be dragged.
- Text fields keep the **text** cursor, dividers their **resize** cursors,
  and "what is this?" tooltips **help**.

So the rule: *the arrow everywhere in the graph view, and a different cursor
only where it says something specific about a control under it.* A new
cursor on something that is not a control — a node body, an edge, the
pane — is a bug under the arrow setting.

## Prefer declarative CSS over `onMouseEnter` state

For anything repeated — list rows, table cells, items from a `.map` — use a
class and a `:hover` rule rather than React state.

This is not a style preference. `index.css` records the reason (#845): JS that
mutates a shared inline style on mouse events leaves stale backgrounds behind on
re-render. Declarative CSS has no such failure mode, and it avoids extracting a
subcomponent purely to hold a boolean.

```css
.trace-step-row:hover { background: #eef2f8; }
```

**When the background is conditional**, prefer a `filter: brightness(...)` over a
fixed color — a single hover color will fight one of the states. The collapsed
diagnostics bar is amber when there is something to act on and neutral grey when there is not, so
it uses brightness, matching what `button:hover` already does app-wide.

Reach for React state only when the reveal is genuinely *coordinated* — when
hovering one element must change another, or when a control's visibility depends
on hovering something else. `ProjectionEdge`'s bend handles are the one real
case in the app: hovering a handle has to keep the handle rendered, so its
hovered-ness feeds the same predicate that decides whether to render it at all.

## Expand and collapse (#418)

One control for everything that folds, so an arrow means the same thing
everywhere. Two forms, one arrow:

**Panel edges: `PanelHandle`** (`components/common/PanelHandle.tsx`). The
splitter is the control: a 1px line with a small rounded tab holding the arrow.

- **Drag the line to resize; click the tab to collapse or restore.** A press
  that moves less than 3px is a click, so a click never resizes and a drag
  never collapses. The tab can be dragged too.
- **A collapsed pane keeps its handle on the edge**, with the arrow turned
  round, so it always comes back from where it went. No pane can vanish
  leaving nothing on screen.
- **Tab placement:** the top of a vertical edge, the right end of a horizontal
  one.
- **Keyboard and ARIA, the WAI-ARIA "window splitter" pattern:** the line is
  `role="separator"`, focusable, with `aria-valuenow` (the pane's share, in
  percent). The arrow keys along its axis resize it (10px, Shift for 50px),
  Home and End take it to its limits, and Enter collapses and restores. The
  tab is a `<button>` with `aria-expanded`, `aria-controls` (the pane) and a
  label naming the action and the panel ("Collapse the code editor"). The tab
  is the line's sibling, because a separator's children are presentational.
- **Looks:** the line thickens to 3px `--pnv-primary` on hover, drag and
  focus; the tab turns `--pnv-primary` on `--pnv-primary-tint`; keyboard focus
  gets a 2px `--pnv-primary` ring. Its hit area is at least 24×24, wide rather
  than tall (14×36 visible on a vertical edge, 40×14 on a horizontal one).
- Used on: the code pane, the bottom (Inspector) panel, and the Components
  panel's right edge (fold to the icon strip; that edge only folds, so only
  the tab acts). The two splits are `components/layout/SplitPane.tsx`, which
  replaced Allotment; stored sizes keep their proportions.

**Rows and sections: the same arrow, turned** (`DisclosureArrow`, and
`DisclosureDetails` for a native `<details>`, in
`components/common/Disclosure.tsx`).

- **`▸` closed, `▾` open:** the same chevron, turned 90° over 0.12s, in a box
  at the start of the row (16px wide; 12px in a tight list).
- **The whole row is the target**, and it is a real `<button>` (or a
  `<summary>`) with `aria-expanded`. Hover tints it `--pnv-selection-hover`;
  focus gets the 2px primary ring.
- Used on: Inspector and Run panel sections, Run State, Settings sections and
  lists, the Components tree, the Open and Tutorials menus, Validation, Model
  Diagnostics, Developer tests and History steps.

**The arrow points the way the content will move.** An open pane's arrow points
to the edge it folds into; a collapsed pane's points into the window.

**Not disclosures, and they keep their own marks:**

- a menu trigger keeps its trailing `Label ▾` text (it opens a menu; it still
  says `aria-expanded`);
- composition `−` / `+` on the graph (collapse to a node, expand from one) are
  graph operations, not panels; they carry `aria-expanded` too;
- `⤵` (enter) and `▣` (inset) do not fold anything.

**Never** a bordered square in a column of buttons (that is what made #414's
strip chevron read as a palette button), and never a clickable `<div>`.

`frontend/src/disclosureConventions.test.ts` holds the app to this: it fails on
a toggle without `aria-expanded`, a `<div>` or `<span>` toggle, a ternary that
picks between the old glyphs (`▶ ▼ ▸ ▾ ◀ › ⌄`) for open and closed, a raw
`<details>`, or an Allotment splitter. `e2e/expand-collapse-standard.spec.ts`
checks the handles and every listed fold with the mouse and the keyboard.

## Checklist for a new control

- Is it a `<button>`? Then you are done.
- If not, does it have hover feedback that does not depend on selection?
- Is the highlight trigger at least as large as the clickable area?
- If hovering reveals it, does hovering *it* keep it revealed?
- Repeated element? Use a CSS class, not `onMouseEnter`.
- Does it fold something? Use `PanelHandle` (a panel edge) or `DisclosureArrow`
  in a button with `aria-expanded` (a row), as above.

## History

The rule was written down after #984, which started from bend handles that
could be dragged in places where nothing was drawn and would vanish from under
the cursor as you reached for them. Fixes: #985 (bend handles), #986 (GSC
condition label), #987 (trace step rows, collapsed diagnostics bar).

## Graph hit areas (#250)

Anywhere in or on a node is a click on that node: its fill, outline, label and the whitespace inside. The rules, which `frontend/e2e/graph-hit-areas.spec.ts` checks on every reference model, with ports hidden and shown, and with interface nodes shown at the fitted zoom, zoomed out and zoomed in:

| Thing | Active region | A click |
|---|---|---|
| Mechanism node (any shape) | the whole drawn shape | selects it |
| Something drawn over a node's rim (an arrow's connection dot, with ports shown) | itself | is handed on to the node, which selects; a drag (4 px or more) is its own (moving the arrow's end) |
| Composition, expanded | its header (the grip: drag it there) and border; the inside belongs to what is in it, so an arrow or empty canvas inside is clicked, not the frame | selects it |
| Arrow | its line, widened to a comfortable band; its label, while the label shows | selects it; a drag shapes it |
| Canvas | everything else | clears the selection; a drag pans |

Two traps, both found by #250:
- **Invisible but catching.** A label hidden with `opacity: 0` still takes the pointer. Anything hidden that way gets `pointerEvents: "none"` while hidden.
- **A frame's box is not a frame.** React Flow makes a whole node take the pointer, inline; an open frame overrides that (`index.css`, `!important`) and takes it on its header and border bands only (`.pnv-frame-grab` in `CompositionNode.tsx`). Clicking to place a component finds the frame around the point by position (`GraphCanvas`).
- **A click is not a drag.** A press counts as a drag only after it moves a few pixels (4 px for a connection dot, 6 for an arrow's line). Otherwise a click with a wobble reshapes things, and in Auto makes the layout Custom.

## Clicks on the graph: macOS conventions (#261)

What each gesture means on the graph, as in Finder and Keynote. `frontend/e2e/graph-click-conventions.spec.ts` checks every row, as a Mac and as Windows/Linux.

| Gesture | Meaning |
|---|---|
| Click | select the object, and only it |
| Control-click = right-click = two-finger tap | the context menu for what's under the pointer. On an unselected node it becomes the selection; inside a multi-selection, the selection stays and the menu acts on all of it ("2 nodes selected": Delete 2 nodes, Select only this one). |
| Command-click (Ctrl-click off the Mac) | add to or take from the selection; never a menu |
| Shift-click | add to or take from the selection |
| Shift-drag on empty canvas | draw a selection box |
| Drag on empty canvas | pan |

Every object has a menu: nodes (Inspect, Rename…, Collapse/Expand…, Delete), a multi-selection (Delete N nodes, in one step that one Undo reverses; Select only this one), arrows (Select sender, Select receiver, Reset shape, Rename…, Delete), scheduling arrows and their labels (Edit condition, Delete) and the canvas (Select All, Fit the graph to the window, Show Components…). A menu offers only actions that exist elsewhere too (Delete is also the Delete shortcut, Backspace, which deletes the whole selection, or the selected arrow when no node is selected), and the web view's own menu (Reload, Inspect Element) never appears on the graph.
