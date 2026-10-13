# PsyNeuView TODO — roadmaps and pointers

> **Status lives on GitHub.** This file holds direction, design notes and
> pointers to issues. It does not say whether an issue is open, merged,
> tested or waiting for closure — open the issue for that (#994). An item
> with no issue number is real but not yet filed.

> **Where the work is.** [`BACKLOG.md`](./BACKLOG.md) surveys every open
> issue against commit history and groups them into areas, so "what's next"
> can be asked one area at a time. This file holds roadmaps and direction;
> that one holds the measured state.

---

# Reference / Library / Live Example Models

Bundling, loading, and running the PsyNeuLink example/library models, plus the
sandbox/CI robustness that keeps them green. Two-section model story: **live**
examples run verbatim from the selected PsyNeuLink source (never copied);
**Reference Models** are curated, maintained copies. The engine is always the
live PsyNeuLink.

- Upstream examples: load+run coverage, status board, Open-menu section and
  lineage — #836.
- What each bundled reference model needs from the canvas (survey) — #1118,
  with per-model notes in #1119–#1128.
- Edit hand-written models in place, without conversion (open design
  question, deliberately unscheduled) — #1139.

## Reference

- CI regression coverage for this arc: `reference-models-runnable.spec.ts`
  (load + run every reference model), `test_library_models.py` (all 8 library
  models load; runnable ones run), `test_sandbox_stdout_flood.py` (#865),
  `test_no_event_loop_blocking.py` (#868).

---

# MDF Integration

The MDF (ModECI Model Description Format) import/export workstream.

- MDF gap detection — preflight warnings for features MDF can't faithfully
  represent: conjoint Compositions (#83), 2D-variable `MatrixTransform` (#84),
  scheduler Conditions (#85), stateful / time-derivative parameters (#87).

## Reference

- **`docs/mdf-versioning.md`** — propagation path (MDF spec →
  `modeci_mdf` → PsyNeuLink pin → PsyNeuView), current versions, known-
  lossy areas, and the checkpoint we run on any upstream bump (#89).

---

# Developer Tests / Pytest Loader (#249 umbrella)

Load pytest tests from a PsyNeuLink source tree directly into PsyNeuView
as standalone models. Standing baseline target:
`tests/composition/test_emcomposition.py::TestExecution::test_simple_execution_without_learning`
(reference from #249). The phase plan lives on **#249**.

- **Tests for wheel installs.** Fetch tests from GitHub when the installed
  PsyNeuLink has no source tree on disk. Today `/api/dev/tests` returns an
  empty list with `source_tree: null`, and the frontend says to install
  PsyNeuLink from source. Not yet filed.
- **Run-panel UX for executed tests.** A developer-mode run produces real
  results; surfacing them (stdout/stderr capture, result tensor display) was
  deferred past #273. Not yet filed.
- Extractor: strip the post-run assertion block — #272 (its root cause was
  fixed by #273).

---

# Graph readability (review follow-ups)

What's left from the graph-readability reviews of the EMComposition and
Stroop layouts (edge fan-out and arrowheads, role-placed ports, the
straight-edge default and the Names / Elements toggles all came out of them).

- Parameter port dots as real React Flow `Handle`s, so `ControlProjection`
  edges can attach — #281.
- Parameter (yellow) diamonds aren't draggable or hoverable like connection
  dots — #954.
- Canvas → code + inspector focus: click a node or port to highlight its
  source location and focus the inspector (reverse of #194 / #213) — #283.

---

# Edge Routing & Layout (#966, #956 umbrellas)

Making edges readable on dense graphs, and then making them editable. Two
umbrellas frame the open work: **#966** (layout rules & constraint
compliance — forced waypoints, adjustability, hard vs soft constraints) and
**#956** (padding & spacing — node↔node, node↔edge, edge↔edge).

- Auto layout routes long (formerly peripheral) edges through the center — #942.
- Connection dots can be hidden under parameter (yellow) diamonds — #949.
- Scheduler (before) edges cross over projection edges — #950.
- Attachment-dot spacing: minimum buffer vs. density/count — #955.
- Smooth-step: drag whole horizontal/vertical segments, not just corners — #959.
- Dev/debug overlay to visualize and toggle routing internals — #943.
- Edge-rendering regression tests: measure and re-gate the quarantine — #967.
- Grow frontend test coverage of the graph view (sequencing and the
  invariants-now / pixels-later rule live there) — #969.

## Reference

- The router is custom, written against React Flow: obstacle-avoiding,
  geometry-aware ports, lane separation for tangent and near-parallel edges.
  None of the off-the-shelf engines (ELK, Dagre edge routing, force-directed)
  was adopted. Constraints it was built around: React Flow's rendering model,
  nested compositions, nodes that stay interactively draggable.
- Pure geometry lives in `frontend/src/utils/edgeRouter.ts` and
  `edgeLanes.ts`, deliberately extracted from the components so it can be
  unit-tested without a browser. Keep new routing logic there rather than in
  `ProjectionEdge.tsx` — see #969 for why.
- Live edge-spacing sliders in the **Graph Style** panel tune the routing
  constants without a rebuild.

---

# Stepwise debugger (#247 umbrella)

Pause a running PsyNeuLink model at well-defined execution moments,
inspect state, scrub through prior pauses, and read values with semantic
labels. The hook it relies on (`_debugger`) is upstream in PsyNeuLink
0.19.1.0 and later.

- **Live stepping (Phase 3).** Pause and resume *during* the run over a
  WebSocket, rather than scrubbing the post-run trace. Not yet filed beyond
  the umbrella.
- **Inspector follows stepping.** Overlaps the Run-State-vs-Inspector design
  question (#336 gap 2, raised on #355). Not yet filed.
- Breakpoints: rule schema (#267), sidecar persistence (#268), run logs
  tagged to breakpoint hits (#269), orphan detection on load (#270) — these
  go with live stepping when it starts.
- Semantic labels for vector dimensions, three-layer plan — #356.

## Design notes

- Labels are for *semantic* units (cognitive models with hand-assigned
  roles), not abstract neural-net demos — silence is the right default when
  there's no meaning to surface (#361).
- **Run State** is the agreed home for stepping context (#355).

---

# Run lifecycle UX (#459 umbrella)

Reshape the Run panel from "configure inputs → bare-JSON results" into a
readable lifecycle: labeled input authoring → per-trial outputs → cross-trial
analysis. Umbrella **#459**.

- Redesign the input editor as a per-trial, labeled surface mirroring the
  output cards (two view modes `Per-trial | By node`, sidecar-driven labeled
  fields) — #499.
- Surface `PARAMETER_SETTING` events in the Run State panel (builds on the
  #460 capture) — #464.
- Within-trial iteration display: per-trial cards collapse values that evolve
  across PASS / TIME_STEP — #524.

---

# Training & parameter-fitting (#512 umbrella)

Learn weights / fit parameters against recorded data. Two arcs under
umbrella **#512**: Learn (train via `.learn`) and Fit (parameter estimation
via PEC).

- Fit F1 — free-parameter spec: Inspector "free" toggle + bounds, as a
  `<model>.fit.yaml` sidecar — #538.
- Fit F2 — PEC objective/optimizer wiring as a job — #539.
- Fit F3 — run-sets + results table + apply-best-fit — #540.
- Fit F4 — objective curve + parameter trajectories — #541.

---

# show_graph parity — reference

How PsyNeuLink's `show_graph()` draws a Composition, kept as the reference
for PsyNeuView's canvas. Source:
`PsyNeuLink/psyneulink/core/compositions/showgraph.py`.

## Open gaps

- **Arrowheads by projection type.** show_graph marks ControlProjections
  with a box and LearningProjections with a diamond; the canvas colours
  edges by type but draws one arrowhead shape. Not yet filed.
- **Real-time execution highlighting.** Highlight nodes as they fire during
  a run (post-run stepping exists). Same work as live stepping under #247.
- **`show_graph_attributes` pass-through.** The Graph Style panel lets the
  user override colours and widths, but a Composition's own
  `show_graph_attributes` dict isn't read from the model. Not yet filed.
- **CIM layout edge cases** (unverified against current code — check before
  filing):
  - CIM positions dragged in custom layout may be lost after toggling to auto
    and back, if CIM nodes aren't in the layout save/load cycle by a stable
    key.
  - With CIMs shown, the direct resolved edge (e.g. `outer_a → inner_comp`)
    and the CIM-routed pair are both drawn. Hide the direct edge only when
    both halves of its CIM replacement (`outer_a → Input CIM`,
    `Input CIM → first inner node`) have their endpoints on the canvas;
    otherwise keep it as the fallback.

## show_graph's conventions

**Node colour by role**

| Role | Color | Border Width |
|------|-------|-------------|
| INPUT | green | 3 (bold) |
| OUTPUT | red | 3 (bold) |
| INPUT+OUTPUT (singleton) | brown | 3 (bold) |
| PROBE | pink | 3 (bold) |
| INTERNAL (default) | black | 1 |
| ControlMechanism | blue | 3 (bold) |
| Controller | purple | 1 |
| Learning | orange | 1 |

**Node shape by type**

| Node Type | Shape |
|-----------|-------|
| Regular mechanism | oval |
| FEEDBACK_SENDER | octagon |
| CYCLE | doublecircle |
| Controller | doubleoctagon |
| CIM | rectangle |
| Nested Composition (collapsed) | rectangle |
| agent_rep (OCM) | egg |

**Projection style by type**

| Type | Arrowhead | Color | Style |
|------|-----------|-------|-------|
| MappingProjection | normal | black | solid |
| ControlProjection | box | blue/purple | solid (dashed if RANDOMIZATION) |
| LearningProjection | diamond | orange | solid |
| Inactive projection | normal | red | solid |

**Other options**

- `show_node_structure`: `True` (port names), `VALUES`, `LABELS`,
  `FUNCTIONS`, `MECH_FUNCTION_PARAMS`, `PORT_FUNCTION_PARAMS`, `ROLES`, `ALL`.
- `show_dimensions`: mechanisms as "out (5)\nname\nin (3,2)", projections
  as "name\n(5x3)" (matrix shape).
- `show_types`: class name below the node name.
- Nesting modes: NESTED (inline), INSET (separate inset graphs), collapsed
  (single box).
- Direction: BT (default), TB, LR, RL.
- `show_controller`, `show_cim`, `show_learning`, inactive projections (in
  red), `active_items` (execution animation).
- PyTorch view (`show_pytorch=True`): flattens nested compositions; marks
  gradient-excluded components brown and dotted.

---

# Scheduling (#377 umbrella)

The scheduler as a first-class editable surface. Plan lives in umbrella
**#377** and its sub-issues (**#379–#389**): consolidated scheduler panel,
editable mode / termination / composite conditions, full PsyNeuLink
Condition-type coverage, node-centric authoring from the canvas, graphical +
run-time consideration-queue visualization, validation, and test coverage.

- Design keystone: scheduler UX and information architecture — #379.

---

# Other ideas

- **MiniMap.** Re-add it as a toggleable overlay (default off), draggable
  like the legend, with position and visibility remembered; decide when it
  earns its place (large models). A `TODO` marks the spot in
  `GraphCanvas.tsx`. Not yet filed.

---

# Upstream PsyNeuLink sync

PsyNeuView can build against the `jonhanke-nam/PsyNeuLink` fork
(`jonhanke-dev`). Keeping that branch synced with upstream `devel` on a
regular cadence means builds are tested against current PsyNeuLink. Tracked
in the fork, not here.

- Regular merge-not-rebase sync of `jonhanke-dev` with upstream `devel`;
  procedure + cadence in the fork's `SYNCING_UPSTREAM.md`, tooling via
  `make sync-upstream` — jonhanke-nam/PsyNeuLink#25 (tooling:
  jonhanke-nam/PsyNeuLink#26).
