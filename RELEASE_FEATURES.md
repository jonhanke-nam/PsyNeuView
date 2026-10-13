# PsyNeuView — Feature Overview

## At a glance

PsyNeuView is a desktop and web tool that lets researchers build, inspect, and run **PsyNeuLink** models visually — without leaving Python behind. The `.py` file remains the source of truth: the interface reads it, edits it surgically, and stays in sync with external edits.

## Core Experience

- **Side-by-side code and graph.** Edit code → graph updates. Drag a node → code updates. Click a node → the editor jumps to that line.
- **Text-based editing.** Build a model ab initio inside the Python UI, or edit the same `.py` in an external editor (PyCharm, VSCode, …). Partial / in-progress code still renders what's parseable, and the GUI rebuilds dynamically when the file changes on disk.
- **Visual graph editing.** Drag mechanisms from a searchable, hierarchical palette to add nodes; drag between port handles to make projections; select-and-delete to remove.
- **Node inspector.** Click any node to view and edit its parameters in a form auto-generated from PsyNeuLink's metadata.
- **Session-wide undo/redo.** Cmd-Z anywhere reverses the last action — parameter edits, node moves, code saves, structural changes — up to 100 steps.
- **Run from the GUI.** Configure inputs per input node, run, and view results as interactive Plotly charts.
- **Per-trial logs.** Logged values per node and composition output across trials.
- **Execution trace.** Step through a run with active-node highlighting, pause/play/speed controls, and per-node fire counts.

## Graphic Display

PsyNeuView matches the richness of PsyNeuLink's static `show_graph()` display in an interactive editor, with toggles in the toolbar:

- **Role-based coloring** (input, output, controller, learning, feedback, cycle).
- **Projection styling** — mapping vs control vs learning rendered with distinct colors and markers.
- **Per-port wiring.** Connections attach to specific input/output ports, not just to nodes generically.
- **Dimension labels** on ports and projection matrices.
- **Expanded node view** with port labels, function info, and shapes.
- **Controller subsystem** rendered alongside the model graph.
- **Learning subsystem** (learning mechanisms, learning projections, targets).
- **Composition-interface (CIM) view** for details of nested-composition routing.
- **Graph orientation** selector (top–bottom, bottom–top, left–right, right–left).
- **Inactive projections** displayed in red when toggled on.
- **Nested compositions** collapse/expand.
- **Automatic edge routing** that keeps dense graphs readable — edges route
  around nodes rather than through them, and parallel projections are held
  apart instead of overlapping.
- **Hand-editable edges.** Drag an edge to bend it, move or delete its bend
  points, choose where it attaches to a node, and reset the route.

## Scheduling

- **Basic condition editing** from the inspector (e.g., EveryNCalls, AfterNCalls, composites with All/Any/Not).
- **Composition-level inspector** for scheduler config, consideration queue, and termination conditions.
- **Execution visualization** — step-through trace with pass-by-pass node execution and execution-count badges.

## Model Interoperability

- **ModECI MDF import and export** (a cross-tool model interchange format used in computational neuroscience).
- **Pre-flight warnings** when MDF can't faithfully represent a model feature.
- **Free-form → standardized** PsyNeuLink script conversion.
- **Built-in library models** browseable from the Load Model dropdown.
% This seems a bit detailed and circumstantial for this list, no?
- **Demo origin tracking.** "Reset to Demo" still works after edits, via a sidecar that remembers where a model came from.

## Configuration & Deployment

- **Settings panel** for switching PsyNeuLink source — PyPI release, GitHub branch, or editable local checkout — without leaving the app.
- **Single-process serving.** Backend serves the built frontend, so the app ships as one binary.
- **Native macOS launcher** drives PsyNeuView from a Mac app (separate repo).
- **Layout persistence.** Node positions saved to a `.pnlview.json` sidecar next to the model.
- **File watching.** External edits to the `.py` file refresh the GUI automatically.
- **Subprocess sandboxing.** User scripts run in isolated subprocesses.

## Quality & Confidence

- **Backend test suite** covering introspection, execution, file writing, sandboxing, layout, MDF, and settings.
- **Playwright end-to-end smoke tests** for the frontend, plus an executable
  tutorial suite that re-runs every documented walkthrough.
- **Frontend unit tests** over the graph geometry, so routing changes can't
  silently reintroduce overlapping or misrouted edges.
- **Version-mismatch warnings** when the loaded PsyNeuLink version differs from what the model expects.

## On the Roadmap

- MDF round-trip CI and gap-detection preflight.
- AutodiffComposition / PyTorch-mode visualization.
- Real-time execution highlighting during model runs.
