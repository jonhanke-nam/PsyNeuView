# Viewing options & the flat view

How to control what the graph shows — layout, nesting, and the flattened view.

> **What you need:** a model loaded. This walkthrough uses [**EGO**](../reference-models/ego.md), which has a
> nested **EM** composition.

---

## Layout and display controls

The graph toolbar controls how the model is drawn:

- **Layout: Auto / Custom** — auto-layout vs. your hand-arranged positions, plus
  **Reset Custom Layout** and the layout (**Like show_graph**, **Layered**, …).
  Bending an arrow, or dragging one of its ends, shapes that arrow only: in
  Auto it switches the layout to Custom where it stands, and no node moves.
  The arrow's shape is saved with the layout, and Undo takes it back.
- **Advanced Graph View Options ▾** — one panel that stays open while you
  change things, grouped as **Nodes** (names, type and role tags, full type
  names, colour by role, dimensions, run order, show ports, expand or collapse
  all), **Layout** (direction such as **Bottom-Up**, flips), **Lines** (line
  style, direction arrows, line names, spreading shared lines) and **What the
  graph shows** (controller, learning, interface nodes, inactive lines).
  Escape, a click outside or its × closes it. The dashed scheduling arrows are
  hidden by default; turn them on in Settings ▸ Appearance.
  By default a node shows just its name, as `show_graph()` draws it, with its
  role in the outline colour; **Type and role tags** adds each node's tags and
  its function (for example `f: Logistic`), and is remembered once you choose.
- The **view selector** (the composition dropdown) — switch between a single
  composition, the whole nested model, and the **flattened** view (below).

## Which panels show

The **Layout** menu shows or hides the graph, the code editor, the Inspector
panel and the Components panel, and each has its own key. One of the graph, the
code editor and the Inspector panel normally stays on screen; a notice says so
if you try to hide the last one.

To be able to clear the window, turn on **Allow a blank screen** in Settings ▸
Appearance ▸ Panels. Then the last panel goes too: the toolbar stays, and a
short hint says how to bring a panel back. Opening a model on a blank screen
brings the graph with it, or whichever panels you tick under **Panels to open
when a model loads on a blank screen**, just below that setting. The Components
panel shows inside the graph, so tick the graph along with it. With any panel
showing, opening a model leaves your layout alone.

Turn the setting off while the screen is blank and the graph comes back. A
guided walkthrough shows every panel while it runs and goes back to your blank
screen when it ends.

## Nested vs. flat

By default a nested composition is drawn as a container you can drill into — here
**EM** is a single composition node.

![EGO with EM as a nested composition](assets/viewing/01-nested.png)

In the **view selector**, choose **Flatten (all compositions)** to inline every
nested composition into one graph — the autodiff-flattened view. EM's internals
(e.g. `RETRIEVE`, `STORE`, `MATCH`, `QUERY`) become top-level nodes, so you can
see the whole computation at once.

![EGO flattened: EM's internals inlined into one graph](assets/viewing/02-flat.png)

Pick a composition from the selector again to return to the nested view. When a
node has been flattened out of a nested composition, the Inspector shows its
**provenance** (which composition it came from).

---

## What you can expect

- [x] Layout can be **auto** or your **custom** arrangement, with a reset and
      direction options.
- [x] Advanced Graph View Options shows or hides roles, names, ports, arrows,
      and more, and stays open while you change several.
- [x] **Flatten** inlines nested compositions into one graph; toggling it off
      restores the nested view.
- [x] Flattened nodes carry **provenance** back to their source composition.
- [x] With **Allow a blank screen** on, every panel can be hidden and a model
      you open brings the panels you chose, the graph by default.

> The flat view is especially useful for learning models like EGO, where the
> interesting computation lives inside a nested composition.

---

## Further reading

PsyNeuView visualizes the model; for the underlying concepts and full API, see the PsyNeuLink docs on [`Composition.show_graph`](https://princetonuniversity.github.io/PsyNeuLink/Composition.html) and [AutodiffComposition](https://princetonuniversity.github.io/PsyNeuLink/AutodiffComposition.html) (the PyTorch view).

## How this tutorial stays accurate

```bash
cd frontend
npm run tutorials:capture
```

**Validated by:** [`frontend/e2e/tutorials/viewing.tutorial.spec.ts`](https://github.com/jonhanke-nam/PsyNeuView/blob/devel/frontend/e2e/tutorials/viewing.tutorial.spec.ts)
**Tracking:** #688 (under the tutorials umbrella #662); flat view #216 / #230
