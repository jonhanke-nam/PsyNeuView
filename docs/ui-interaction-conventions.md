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
overrides those under `.graph-pointer-arrow`, with the arrow coming from
`utils/graphCursor.ts` at the size chosen in Settings ▸ Appearance. The
**grabbing hand** shows only while a drag is in progress — the canvas being
panned, a node being moved — which is when it carries meaning. Settings ▸
Appearance also offers **Hand**, which leaves React Flow's cursors as they
were.

The arrow is the *default*, not a replacement for every cursor. A real
control keeps the cursor that says what it does, under either setting:

- A `<button>` inside a node (expand, focus, collapse) and a clickable edge
  label say **pointer** — a click affordance on a control, as above.
- A handle you drag — an edge's bend handle, the GSC legend's title bar —
  says **grab**, and **grabbing** while held: a drag surface signalled by
  cursor, as above. Under "hand" the edge's hit path says grab too
  (`.projection-edge-hit`), since that is a drag surface in the hand's
  idiom; under the arrow it stays the arrow, and the bend handles that
  appear on hover carry the grab.
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
diagnostics bar is amber when there are issues and green when there are not, so
it uses brightness, matching what `button:hover` already does app-wide.

Reach for React state only when the reveal is genuinely *coordinated* — when
hovering one element must change another, or when a control's visibility depends
on hovering something else. `ProjectionEdge`'s bend handles are the one real
case in the app: hovering a handle has to keep the handle rendered, so its
hovered-ness feeds the same predicate that decides whether to render it at all.

## Checklist for a new control

- Is it a `<button>`? Then you are done.
- If not, does it have hover feedback that does not depend on selection?
- Is the highlight trigger at least as large as the clickable area?
- If hovering reveals it, does hovering *it* keep it revealed?
- Repeated element? Use a CSS class, not `onMouseEnter`.

## History

The rule was written down after #984, which started from bend handles that
could be dragged in places where nothing was drawn and would vanish from under
the cursor as you reached for them. Fixes: #985 (bend handles), #986 (GSC
condition label), #987 (trace step rows, collapsed diagnostics bar).
