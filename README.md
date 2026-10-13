# PsyNewView

A web-first graphical interface for [PsyNeuLink](https://github.com/PrincetonUniversity/PsyNeuLink) — the computational neuroscience modeling framework.

## Prerequisites

- **Python 3.12, 3.13, or 3.14** — [python.org](https://www.python.org/downloads/).
  `make` checks the version before building the venv and names a usable
  interpreter if `python3` is out of range — install one with
  `brew install python@3.14` and re-run as `make install PYTHON=python3.14`.
- **Node.js 18+** — [nodejs.org](https://nodejs.org/) (includes `npm`)
- **Make** — pre-installed on macOS/Linux; on Windows use [WSL](https://learn.microsoft.com/en-us/windows/wsl/) or Git Bash

## Quick Start

```bash
make install       # create venv, install backend deps + PsyNeuLink from PyPI
make start         # start both servers in the background
```

Open **http://localhost:5173**. Click **Load Model** and select a `.py` model file — or use one of the built-in demo models.

To see what's running: `make status`. To stop everything: `make stop`.

## Documentation

| Start here | |
|---|---|
| **What PsyNeuView is** | [`docs/introduction.md`](docs/introduction.md) — no-setup overview of what the tool does |
| **Tutorials** | [`docs/tutorials/`](docs/tutorials/README.md) — 12 walkthroughs, one per workflow |
| **Reference models** | [`docs/reference-models/`](docs/reference-models/README.md) — the ten bundled models |
| **Full setup** | [`docs/getting-started.md`](docs/getting-started.md) — fresh clone, repo access, `devel`, troubleshooting |

Everything else — testing, conventions, internals — is under
[`docs/`](docs/index.md).

### Using a local PsyNeuLink checkout

If you have a local PsyNeuLink repo (e.g. for development or a pre-release branch), install it in editable mode instead:

```bash
# Default: expects ../PsyNeuLink relative to this repo
make install-all

# Or point to a custom location
make install-all PSYNEULINK_DIR=/path/to/PsyNeuLink
```

This replaces the PyPI version with your local copy. You can switch back anytime with `make install`.

### All Makefile targets

Run `make help` to see every available target. Key ones:

| Target | Description |
|--------|-------------|
| `make start` | Start both servers in the background |
| `make status` | Show what's running, and which checkout each server is serving |
| `make stop` | Stop both servers |
| `make run-release` | Stop, switch to the tagged release, and launch it |
| `make run-devel` | Stop, return to the latest `devel`, and launch it |
| `make release-tag` | Cut a release tag on `devel` (`VERSION=1.2.3`) — see [#1073](https://github.com/jonhanke-nam/PsyNeuView/issues/1073) |
| `make dev` | Start both servers with hot reload (use `SLOT=N` for parallel branches) |
| `make install` | Backend deps + PsyNeuLink from PyPI |
| `make install-pnl` | Install local PsyNeuLink (editable) |
| `make install-all` | Backend deps + local PsyNeuLink |
| `make install-frontend` | Frontend `npm install` |
| `make backend` | Start backend on port 8000 |
| `make frontend` | Start frontend dev server |
| `make test` | Run backend test suite |
| `make info` | Show installed versions |
| `make clean` | Remove venv, node_modules, build artifacts |

### Manual setup (without Make)

<details>
<summary>Click to expand manual steps</summary>

**Backend:**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e .            # backend + all declared deps (incl. PsyNeuLink) from pyproject.toml
uvicorn app.main:app --port 8000 --reload
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

</details>

## Features

### Bidirectional Code-Graph Sync
- **Code editor** (left) and **graph canvas** (right) stay in sync
- Edit code → graph updates. Drag/connect nodes → code updates.
- Click a graph node → code editor jumps to that line

### Visual Graph Editing
- **Add nodes**: click or drag mechanism types from the palette
- **Connect nodes**: drag between port handles to create projections
- **Delete nodes**: select and press Backspace/Delete
- **Auto layout**: dagre-based directed graph layout
- **Nested compositions**: rendered as group nodes

### Model Execution
- Configure inputs per input node
- Run the model and view results as **Plotly charts**
- Per-node logged values and composition output across trials

### Inspector
- Click any node to view/edit its parameters
- Data-driven forms generated from PsyNeuLink's parameter metadata
- Changes written surgically to the `.py` file

### Session-Wide Undo/Redo

Full undo/redo history for all actions in the session:

- **Arbitrary depth** — up to 100 undo steps per session
- **Every action tracked** — parameter edits, node moves, code saves, structural changes (add/delete nodes and projections)
- **Smart batching** — rapid edits (e.g., typing a parameter value) are grouped into a single undo step
- **Action descriptions** — each entry shows what happened ("Modified gain in hidden_layer", "Moved node output", "Added TransferMechanism input_node")
- **Undo/Redo buttons** (↩/↪) in the toolbar with tooltips showing the action to undo/redo
- **History panel** — click "History" to see the full action list with current position
- **Works everywhere** — Cmd+Z undoes the last action regardless of what has focus (code editor, graph, inspector)
- **Positions restored** — node layout positions are captured in each snapshot and restored on undo

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+S** / **Cmd+S** | Save code and refresh graph |
| **Ctrl+Z** / **Cmd+Z** | Undo (session-wide, all actions) |
| **Ctrl+Shift+Z** / **Cmd+Shift+Z** | Redo |
| **Backspace** / **Delete** | Delete selected node |

### Other Features
- **File watching**: external changes to the `.py` file auto-refresh the GUI
- **Format conversion**: free-form PsyNeuLink scripts can be converted to standardized format
- **MDF import**: load ModECI MDF models (`.mdf.json` / `.mdf.yaml`, or sniffed bare `.json` / `.yaml`) via *Load Model → Import MDF…*. See [`docs/file-conventions.md`](docs/file-conventions.md) for the naming convention.
- **Layout persistence**: node positions saved to `.pnlview.json` sidecar file
- **Version tracking**: PsyNeuLink version mismatch warnings
- **Subprocess sandboxing**: user scripts execute in isolated subprocesses

## Architecture

```
Frontend (React + TypeScript)          Backend (Python + FastAPI)
┌────────────────────────────┐         ┌─────────────────────────┐
│ React Flow (graph canvas)  │  REST   │ Introspector            │
│ CodeMirror (code editor)   │ ──────► │   execute .py → JSON    │
│ Zustand (state)            │ WebSocket│ File Writer             │
│ Plotly (charts)            │ ◄────── │   surgical .py edits    │
│ Allotment (split panes)   │         │ Executor                │
└────────────────────────────┘         │   run compositions      │
                                       │ Sandbox (subprocess)    │
                                       │ File Watcher (watchdog) │
                                       └─────────────────────────┘
```

**Design principle**: The `.py` file is the source of truth. The GUI reads from and writes back to it.

## Testing

PsyNeuView has backend pytest, executable tutorial e2e specs, a broader e2e
suite, and a typecheck gate — most of which run in CI on PRs to `devel`. See
[`docs/testing.md`](docs/testing.md) for what each suite validates, the CI
workflows, and how to run them locally. Things CI has caught are logged in
[`docs/ci/catches.md`](docs/ci/catches.md).

## Project Structure

```
PsyNewView/
├── frontend/               # React + TypeScript application
│   └── src/
│       ├── components/
│       │   ├── graph/      # React Flow canvas, custom nodes, palette
│       │   ├── editor/     # CodeMirror Python editor
│       │   ├── inspector/  # Property inspector, run panel, charts
│       │   ├── layout/     # Toolbar, split-pane layout
│       │   └── common/     # Notifications, shared UI
│       ├── hooks/          # File watcher, undo/redo
│       ├── stores/         # Zustand stores (model, notifications, history)
│       ├── types/          # TypeScript type definitions
│       └── utils/          # Dagre layout, utilities
├── backend/                # Python FastAPI server
│   ├── app/
│   │   ├── api/            # REST routes, WebSocket handler
│   │   └── services/       # Core services
│   │       ├── introspector.py   # Execute & introspect PsyNeuLink models
│   │       ├── executor.py       # Run compositions with inputs
│   │       ├── file_writer.py    # Surgical .py file edits
│   │       ├── converter.py      # Free-form → standardized format
│   │       ├── file_types.py     # File-type classification (PNL/PNLPROJECT/MDF)
│   │       ├── sandbox.py        # Subprocess isolation
│   │       ├── watcher.py        # File change detection
│   │       └── layout.py         # Sidecar .pnlview.json management
│   └── tests/              # backend test suite
└── docs/                   # Design documentation
```

## Testing

```bash
cd backend
source .venv/bin/activate
python -m pytest tests/ -v
```

Tests cover: introspection, execution, file writing, structural changes, sandboxing, layout persistence, file watching, format conversion, format versioning, file-type classification, MDF import, and API endpoints.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md)
for how work flows into `devel` and what must pass, [SUPPORT.md](SUPPORT.md)
for getting help, and [SECURITY.md](SECURITY.md) for reporting security
problems. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

PsyNeuView is licensed under the [Apache License, Version 2.0](LICENSE), the
same license as PsyNeuLink. See [NOTICE](NOTICE).
