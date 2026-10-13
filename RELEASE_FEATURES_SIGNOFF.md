# PsyNeuView — Release Feature Sign-off

Hierarchical sign-off run sheet mirroring the structure of `RELEASE_FEATURES.md`. Each feature's claims are broken into the smallest items a reviewer can independently verify.

For each item, mark **one** of:

- **Pass** — feature works as described; ships as-is.
- **Revisit** — feature has an issue that should be looked at again before release.
- **N/A** — reviewer did not test this item, or it doesn't apply.

To mark a choice, edit the raw markdown and replace the empty box next to your selection with `[x]`. Use the Comments line to record the model used, what was tried, any quirks, or follow-ups to file.

This is a single-reviewer run sheet. Each reviewer should fill out their own copy; collected sheets can then be combined into a final report.

## Reviewer

| Name | Date completed |
|---|---|
| _fill in_ | _fill in_ |

---

## At a glance

PsyNeuView is a desktop and web tool that lets researchers build, inspect, and run **PsyNeuLink** models visually — without leaving Python behind. The `.py` file remains the source of truth: the interface reads it, edits it surgically, and stays in sync with external edits.

## Core experience

- **Side-by-side code and graph.** The editor and graph stay in sync — changes in one update the other.
  - **Edit code → graph updates.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Drag a node → code updates.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Click a node → editor jumps to the line that constructed it.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Text-based editing.** Models can be built in the GUI from scratch, edited externally, and stay in sync with on-disk changes.
  - **Ab initio model building in the Python UI.** Start from an empty (or newly created) `.py` and build a model entirely through GUI actions; the `.py` is written incrementally as you go.
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **External-editor support.** Open the same `.py` in PyCharm / VSCode / another editor; on save, PsyNeuView picks up the change without a manual refresh.
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Partial model builds from incomplete Python.** While the `.py` is mid-edit (syntactically incomplete or only partially defined), the GUI renders what's parseable rather than refusing to load.
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Dynamic model rebuilding on file change.** External writes to the `.py` (editor save, formatter run, version-control checkout) trigger a GUI rebuild automatically.
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Visual graph editing.** Add, connect, and remove nodes directly on the canvas.
  - **Drag mechanisms from a searchable, hierarchical palette to add nodes.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Drag between port handles to create projections.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Select-and-delete to remove a node (Backspace / Delete).**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Per-port wiring.** Connections attach to specific input/output ports, not just to nodes generically.
  - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
  - Comments: _(notes here)_
- **Node inspector.** Click any node to view and edit its parameters.
  - **Inspector opens with parameter form populated from PsyNeuLink metadata.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Edits are written surgically back to the `.py` file (no whole-file rewrite).**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Session-wide undo/redo.** Cmd-Z reverses the last action regardless of focus; Shift-Cmd-Z redoes.
  - **Cmd-Z anywhere reverses the last action (works in code editor, graph, inspector).**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **All action types tracked: parameter edits, node moves, code saves, structural changes.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Up to 100 steps of history per session, with descriptions in the History panel.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_

## Running models

- **Run from the GUI.** Configure inputs and run a composition without leaving the app.
  - **Configure inputs per input node.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Run the model and see results as interactive Plotly charts.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Per-trial logs.** Logged values per node and composition output across trials.
  - **Per-node logged values are accessible after a run.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Composition output across trials is shown.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Execution trace.** Step through a run after it completes.
  - **Step-by-step active-node highlighting matches scheduler's firing order.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Pause / play / speed controls work.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Per-node fire counts visible after the run.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_

## Graph display

PsyNeuView matches the richness of PsyNeuLink's static `show_graph()` plot in an interactive editor, with toggles in the toolbar.

- **Role-based coloring.** Nodes are colored by their composition role.
  - **INPUT nodes colored as input.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **OUTPUT nodes colored as output.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Controller nodes colored as controller.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Learning nodes colored as learning.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Feedback / cycle roles visually distinguished.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Projection styling.** Different projection types render with distinct colors and markers.
  - **MappingProjection styled distinctly.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **ControlProjection styled distinctly.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **LearningProjection styled distinctly.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Dimension labels.** Shapes shown on the graph itself, not only in the inspector.
  - **Port shape labels shown near port handles when toggled on.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Projection matrix shapes shown on edges when toggled on.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Expanded node view.** Per-node details shown directly on the canvas.
  - **Port names rendered as labeled rows.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Function info shown inline.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Toggle between compact and expanded modes works.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Controller subsystem** rendered alongside the model graph.
  - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
  - Comments: _(notes here)_
- **Learning subsystem.** Learning components rendered when toggled on.
  - **Learning mechanisms appear with distinct color.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Learning projections rendered distinctly.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Target / comparator mechanisms rendered.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Composition-interface (CIM) view** for nested-composition routing.
  - **CIM nodes appear at composition boundaries when toggled on.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Inspector shows CIM port routing (e.g. `outer_a .InputPort-0 [2] → into composition`).**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Graph direction selector.** Layout direction can be changed live.
  - **Top-bottom direction works.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Bottom-top direction works.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Left-right direction works.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Right-left direction works.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Inactive projections** displayed in red when toggled on.
  - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
  - Comments: _(notes here)_
- **Nested compositions collapse/expand.**
  - **Right-click → collapse turns a nested composition into a single rectangle.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Re-expand restores child nodes with their positions.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_

## Scheduling

- **Basic condition editing** from the inspector.
  - **Add basic conditions (EveryNCalls, AfterNCalls, …) — code updates.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Wrap conditions in composites (All / Any / Not) — code updates.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Remove a condition — disappears from inspector and code.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Composition-level inspector.** Click a composition group to see its scheduling.
  - **Scheduler config (mode) visible.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Consideration queue visualization shown.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Termination conditions editable; changes write back to `comp.scheduler.termination_conds`.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Execution visualization.** Trace a run pass-by-pass.
  - **Step-through trace matches scheduler firing order.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Execution-count badges shown per node after a run.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_

## Model interoperability

- **ModECI MDF import and export.**
  - **Import a `.mdf.json` or `.mdf.yaml` — model loads and renders.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Export a PsyNeuLink model to MDF — file is produced.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Round-trip (export → import) preserves the model.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Pre-flight warnings** when MDF can't faithfully represent a model feature.
  - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
  - Comments: _(notes here)_
- **Free-form → standardized** PsyNeuLink script conversion.
  - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
  - Comments: _(notes here)_
- **Built-in library models** browseable from the Load Model dropdown.
  - **Library section appears in Load Model dropdown.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **At least one library model loads and runs.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Demo origin tracking.** "Reset to Demo" works after edits.
  - **After editing a demo, "Reset to Demo" restores pristine state.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **`.pnlview.json` sidecar persists demo origin across saves.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_

## Configuration & deployment

- **Settings panel** for switching PsyNeuLink source without leaving the app.
  - **PyPI release source works.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **GitHub branch source works.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Editable local checkout source works.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **`/api/settings/info` reports the active source correctly.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Single-process serving.** Backend serves the built frontend, so the app ships as one binary.
  - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
  - Comments: _(notes here)_
- **Native macOS launcher** drives PsyNeuView from a Mac app (separate repo).
  - **Mac app launches PsyNeuView in WKWebView.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Mac app env-var override is honored on `/api/settings/info`.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Layout persistence.** Node positions saved to a `.pnlview.json` sidecar next to the model.
  - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
  - Comments: _(notes here)_
- **File watching.** External edits to the `.py` file refresh the GUI automatically.
  - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
  - Comments: _(notes here)_
- **Subprocess sandboxing.** User scripts run in isolated subprocesses.
  - **A buggy / infinite-loop script does not hang the main app.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
  - **Sandbox timeout fires.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_

## Quality & confidence

- **Backend test suite** covering introspection, execution, file writing, sandboxing, layout, MDF, and settings.
  - **`make test` passes locally.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Playwright end-to-end smoke tests** for the frontend.
  - **`npm run test:e2e:smoke` passes locally from `frontend/`.**
    - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
    - Comments: _(notes here)_
- **Version-mismatch warnings** when the loaded PsyNeuLink version differs from what the model expects.
  - Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Pass &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Revisit &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] N/A
  - Comments: _(notes here)_

## On the roadmap (not yet shipped — no sign-off needed)

- MDF round-trip CI and gap-detection preflight.
- Edge routing for parallel projections (cleaner layouts on dense models).
- AutodiffComposition / PyTorch-mode visualization.
- Real-time execution highlighting during model runs.

---

## Final sign-off

I have personally exercised every item I marked Pass above and consider those features release-ready. Items I marked Revisit are noted with concrete follow-ups in the Comments lines and / or filed as issues.

- Decision: &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Approve release &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp; ] Hold for follow-up
- Outstanding concerns: _(filed issue numbers, blockers, follow-ups)_
