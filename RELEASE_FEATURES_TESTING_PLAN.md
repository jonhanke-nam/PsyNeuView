# PsyNeuView — Release Features Manual Testing Plan

Companion to `RELEASE_FEATURES.md` (what we ship) and `RELEASE_FEATURES_SIGNOFF.md` (per-reviewer sign-off run sheet). This file is the *how*: a structured runbook telling a reviewer exactly which models to load, what steps to perform, and which sign-off sub-claim each procedure verifies.

## Purpose & scope

- One reviewer per signoff-sheet copy. This plan is the same for every reviewer.
- Goal: every sign-off sub-claim ends up marked **Pass**, **Revisit**, or **N/A** with intent — not skipped because the reviewer didn't know how to test it.
- Pacing target: two ~2-hour sessions plus a short Phase 3, splittable across days.

## How to use this plan with the sign-off sheet

1. Make a personal copy of `RELEASE_FEATURES_SIGNOFF.md` (e.g. `RELEASE_FEATURES_SIGNOFF_<your-initials>.md`) or print the PDF.
2. Fill in your name and date at the top.
3. Work this plan top-to-bottom. Each procedure (T1, T2, …) lists which sign-off sub-claims it verifies.
4. After each procedure, mark the listed sub-claims **Pass / Revisit / N/A** and add a one-line Comment (model used, anything surprising, follow-up issue number if filed).
5. **Revisit** = file an issue in `jonhanke-nam/PsyNeuView` and put the issue number in the Comments field. Don't try to fix in-line.
6. End at the **Final sign-off** section: Approve release, or Hold for follow-up.

## Prerequisites

Before Session 1:

- [ ] Fresh clone of `jonhanke-nam/PsyNeuView` on the branch under test (typically `release-features` once merged to `devel`).
- [ ] Python 3.10+ and Node 18+ (`make info` to confirm).
- [ ] `make install` completes cleanly (this installs PsyNeuLink from PyPI by default).
- [ ] Ports 5173 (frontend) and 8000 (backend) free (`make stop` if a previous session left servers running).
- [ ] Browser: a fresh window or private session — undo / file-watcher tests are sensitive to leftover state.
- [ ] Local PsyNeuLink checkout available at `../PsyNeuLink` if you'll be testing the **GitHub branch** or **editable local checkout** Settings sources (needed for the Giallanza model and full Settings-panel coverage).
- [ ] `make test` and `cd frontend && npm run test:e2e:smoke` both pass on your machine before manual testing starts — those are baselines, not part of the plan, but a failing baseline contaminates everything below.

## Test fixture set

### Primary: PsyNeuLink library models

These are the models we ship as the **Library** section of PsyNeuView's Load Model dropdown. They auto-populate from the installed `psyneulink.library.models` package (PR #20).

When the Settings panel is set to **PyPI release** or **master**, expect 7 models:

| # | Model | Likely features exercised (verify on first pass) |
|---|---|---|
| 1 | `Botvinick_conflict_monitoring_model.py` | Controller / ControlProjection, conflict monitoring |
| 2 | `Cohen_Huston1994.py` | Stroop, scheduling |
| 3 | `Cohen_Huston1994_horse_race.py` | Variant — likely scheduling / cycles |
| 4 | `GilzenratModel.py` | Locus coeruleus, dynamics |
| 5 | `Kalanthroff_PCTC_2018.py` | Stroop variant, control |
| 6 | `Nieuwenhuis2005Model.py` | P300 / decision making |
| 7 | `MontagueDayanSejnowski96.py` | RL / dopamine — likely **learning subsystem** |

When Settings is switched to **GitHub branch → `devel`**, an 8th model appears:

| # | Model | Why it's special |
|---|---|---|
| 8 | `Giallanza2024_ego_study2.py` | EGO (devel-only). Loading it doubles as a Settings-panel source-switching test. |

The "Likely features exercised" column is a starting hypothesis. **Phase 1's smoke pass fills in the real coverage matrix** — see the Coverage Matrix template at the end of this file.

### Synthetic fixtures (small files we author, not from upstream)

These cover sign-off items that the upstream library can't test. Specifications below; create on demand or as a follow-up PR.

| ID | Path | Purpose | Notes |
|---|---|---|---|
| S1 | `tests/fixtures/release-test-set/infinite_loop.py` | Sandbox timeout test | A composition whose run never returns (`while True: pass` inside a UDF, or a non-terminating scheduler). |
| S2 | `tests/fixtures/release-test-set/version_mismatch.py` | Version-mismatch warning test | Ordinary tiny model, but with a sentinel `__pnl_version__ = "0.0.0"` (or whatever sidecar field the warning actually checks — confirm against `services/version.py`). |
| S3 | `tests/fixtures/release-test-set/mdf_source.mdf.json` | MDF import test | A minimal valid MDF JSON. Can be produced once via PsyNeuView's Export, or hand-written. |
| S4 | `tests/fixtures/release-test-set/mdf_source.mdf.yaml` | MDF YAML import test | Same model as S3, YAML serialization. |
| S5 | `tests/fixtures/release-test-set/mdf_incompatible.py` | MDF preflight-warning test | A model using a feature MDF can't represent (e.g. a custom-Python UDF the MDF backend doesn't support). |

### Reusing what already exists

| Existing fixture | Used in plan |
|---|---|
| `backend/tests/fixtures/freeform_no_sections.py` | Free-form → standardized converter test |
| `backend/tests/fixtures/syntax_error.py` | (Optional) error-handling sanity check |

---

## Phased approach

**Phase 1** (15–30 min) — Foundation smoke pass. Load every library model. Fail-fast for show-stoppers. Fill in the coverage matrix.

**Phase 2** (~4 hr, split across two sessions) — Feature-by-feature pass through the sign-off sheet. Each procedure references which sub-claims it verifies.

**Phase 3** (~30–45 min) — Synthetic-fixture tests (sandbox, MDF, version mismatch).

---

## Phase 1 — Foundation smoke pass

### T1: Load + render every library model

**Fixture:** all 8 library models (start with the 7 from PyPI; do Giallanza after switching to `devel`).
**Sign-off items verified:**
- Model interoperability → "Library section appears in Load Model dropdown"
- Model interoperability → "At least one library model loads and runs" (after Phase 2 run pass)

**Steps:**
1. `make start`. Wait until `make status` shows both servers healthy.
2. Open http://localhost:5173 in a fresh browser window.
3. Click **Load Model**. Confirm a **Library** section is present in the dropdown.
4. For each of the 7 PyPI library models:
   - Select it from the Library section.
   - Wait for the graph to render.
   - Note in the coverage matrix: does the model appear to have a controller, a learning subsystem, nested compositions, cycles, multiple input/output nodes? (Use role coloring to spot these.)
   - Take a screenshot of the rendered graph (optional, useful for the final report).
5. Open Settings → switch PsyNeuLink source to **GitHub branch**, branch `devel`. Wait for reinstall to finish.
6. Reload Library list. Confirm `Giallanza2024_ego_study2` now appears.
7. Load the Giallanza model. Repeat the coverage observation.
8. Switch Settings back to **PyPI release** before continuing (keeps Phase 2 on a stable base).

**Pass criteria:** all 8 models load and render without an error toast; no model crashes the backend.

**Recording:** mark the two sign-off items above tentatively (final Pass after Phase 2 confirms a run works). Fill in the Coverage Matrix.

---

## Phase 2 — Feature-by-feature pass

### Session 1 — Core, run, graph display (~2 hr)

#### T2: Side-by-side sync

**Fixture:** any small library model that loaded cleanly in T1 (`Cohen_Huston1994.py` or similar).
**Sign-off items:** Core experience → "Edit code → graph updates" / "Drag a node → code updates" / "Click a node → editor jumps to that line".

**Steps:**
1. Load the model.
2. In the code editor, change a parameter literal of one mechanism (e.g. a `slope` value) and **Cmd-S**. Confirm the graph re-renders without losing layout.
3. Drag a node to a new position on the canvas. Confirm the `.py` file (or the `.pnlview.json` sidecar — check both) updates.
4. Click a node on the canvas. Confirm the code editor scrolls to the line that constructs that mechanism, with the line highlighted.

**Pass criteria:** all three directions of sync work without a manual refresh.

#### T2b: Text-based editing

**Fixture:** a fresh empty `.py` for the ab-initio path, then any small library model + an external editor (PyCharm or VSCode) for the rest.
**Sign-off items:** Core experience → "Ab initio model building in the Python UI" / "External-editor support" / "Partial model builds from incomplete Python" / "Dynamic model rebuilding on file change".

**Steps:**
1. **Ab initio.** Create a new empty `.py` (File → New, or `touch /tmp/new_model.py` then Load Model). Drag a `TransferMechanism` from the palette onto the canvas. Confirm the `.py` is written with a syntactically valid declaration. Drag a second mechanism and project between them. Confirm both nodes and the projection are persisted to the file.
2. **External editor.** Open the active `.py` in PyCharm or VSCode in parallel with PsyNeuView. Change a parameter literal and save. Confirm the graph rebuilds within ~1 second with no manual refresh in PsyNeuView.
3. **Partial code.** In the external editor, comment out the composition assembly (leave at least one mechanism construction intact) and save. Confirm PsyNeuView still renders the parseable parts (mechanisms shown without composition edges) rather than blocking with a load error.
4. **Dynamic rebuild.** From a terminal, run a non-destructive operation that bumps the file (`ruff format <file>.py`, or a git checkout that touches the file). Confirm PsyNeuView reflects the on-disk version without manual action.

**Pass criteria:** ab-initio path produces a runnable `.py`; external saves surface in the GUI without manual refresh; partial code renders what it can; on-disk changes from any source are picked up dynamically.

#### T3: Visual graph editing

**Fixture:** continue with the same small library model, or a copy of one.
**Sign-off items:** Core experience → "Drag mechanisms from a searchable, hierarchical palette" / "Drag between port handles to create projections" / "Select-and-delete to remove a node" / "Per-port wiring".

**Steps:**
1. Open the mechanism palette. Confirm it has a search box and is hierarchical.
2. Type a name (e.g. `TransferMechanism`) in the search box; confirm filtering.
3. Drag a `TransferMechanism` from the palette onto the canvas. Confirm a new node appears and the `.py` file gains a corresponding declaration.
4. Drag from one node's output port handle to another node's input port handle. Confirm a projection edge is created and the code adds a `Projection` between those specific ports (not just `node_a → node_b`).
5. Select a recently added node. Press **Backspace**. Confirm node + its projections disappear from canvas and code.

**Pass criteria:** all four sub-claims observed; per-port wiring is visible in the generated code.

#### T4: Node inspector

**Fixture:** any library model with a non-trivial parameter set (Botvinick is a good choice — it has a controller).
**Sign-off items:** Core experience → "Inspector opens with parameter form populated from PsyNeuLink metadata" / "Edits are written surgically back to the `.py` file".

**Steps:**
1. Click any mechanism node. Confirm the inspector opens with a populated form.
2. Change one parameter (e.g. `gain`). Confirm the change is reflected in the `.py` file.
3. Open the file in an external editor. Confirm only the targeted line changed (no whole-file rewrite, no reformatting).

**Pass criteria:** edit lands on the right line; the rest of the file is byte-identical.

#### T5: Session-wide undo/redo

**Fixture:** any model.
**Sign-off items:** Core experience → "Cmd-Z anywhere reverses the last action" / "All action types tracked" / "Up to 100 steps of history per session".

**Steps:**
1. Perform 5 distinct actions in sequence: parameter edit, node drag, code save, add node, delete node.
2. Press **Cmd-Z** 5 times. Confirm each reversal works and lands the right state.
3. Press **Cmd-Shift-Z** 5 times. Confirm full redo.
4. Open the **History** panel. Confirm the action descriptions are meaningful (not generic "edit").
5. (Optional, depth-spot check) Run a tight loop of small parameter edits to verify smart batching — typing several digits in one parameter should collapse into a single undo step.

**Pass criteria:** undo correctly reverses each action type; descriptions read like English; smart batching observable.

#### T6: Running a model

**Fixture:** a library model with at least one input node — `Cohen_Huston1994.py` or `Botvinick_conflict_monitoring_model.py`.
**Sign-off items:** Running models → "Configure inputs per input node" / "Run the model and see results as Plotly charts" / "Per-node logged values are accessible after a run" / "Composition output across trials is shown".

**Steps:**
1. Open the run panel. Confirm input nodes are listed individually.
2. Configure inputs (use the model's documented defaults if shown).
3. Click **Run**. Wait for completion.
4. Confirm a Plotly chart renders. Hover to confirm interactivity.
5. Open per-node logs. Confirm logged values are present per trial.
6. Confirm the composition-output view shows results across all trials.

**Pass criteria:** run completes; charts interactive; logs populated; trial axis correct.

#### T7: Execution trace

**Fixture:** same as T6, plus `scheduling_demo.py` or a model with non-trivial scheduling.
**Sign-off items:** Running models → "Step-by-step active-node highlighting" / "Pause / play / speed controls" / "Per-node fire counts visible after the run".

**Steps:**
1. After a successful run, open the execution trace.
2. Step through the trace. Confirm active-node highlighting matches the firing order in the consideration queue.
3. Use pause / play / speed controls. Confirm each works.
4. After the trace plays through, confirm per-node fire-count badges are shown on the canvas.

**Pass criteria:** highlighting matches scheduling expectations; controls responsive; counts present.

#### T8: Graph display toggles

**Fixture:** sweep across the library models — pick the one that best exercises each toggle (use the Coverage Matrix to choose).
**Sign-off items:** every sub-claim under **Graph display** in the sign-off sheet.

**Steps:** for each toolbar toggle, flip it on and off and observe:

| Toggle | Best library model | What to confirm |
|---|---|---|
| Role-based coloring | Any model with input + output + controller (Botvinick) | INPUT, OUTPUT, controller, learning, feedback/cycle each have distinct, legible colors |
| Projection styling | Botvinick (controller) + MontagueDayanSejnowski96 (learning) | Mapping vs Control vs Learning render with distinct colors and edge markers |
| Dimension labels | Any model | Port shapes shown near port handles; matrix shapes shown on edges |
| Expanded node view | Any model | Expanded mode shows port labels + function info; toggle returns to compact view |
| Controller subsystem | Botvinick | Controller subsystem renders alongside model graph |
| Learning subsystem | MontagueDayanSejnowski96 (or any learning model) | Learning mechanisms, learning projections, target/comparator all render |
| CIM view | A nested-composition model (verify one in T1; if none in library, use `backend/demos/nested_compositions.py`) | CIM nodes appear at boundaries; inspector shows port routing string |
| Graph direction | Any model | Top-bottom, bottom-top, left-right, right-left all reflow correctly |
| Inactive projections | A model with deactivated projections (may need synthetic fixture if no library model has one) | Inactive projections rendered red when toggled on |
| Nested compositions | Same as CIM view above | Right-click → collapse turns nested into one rectangle; re-expand restores child positions |

**Pass criteria:** each toggle visibly changes the canvas; each visual element matches PsyNeuLink's `show_graph()` semantics for that model.

**End of Session 1.**

### Session 2 — Scheduling, interop, config, quality (~2 hr)

#### T9: Scheduling — basic conditions from inspector

**Fixture:** `Cohen_Huston1994.py` or another model with non-trivial scheduling. If none are obvious, use `backend/demos/scheduling_demo.py`.
**Sign-off items:** Scheduling → "Add basic conditions" / "Wrap conditions in composites" / "Remove a condition".

**Steps:**
1. Click a mechanism node. Open the inspector's **Scheduling** section.
2. Add an `EveryNCalls(other_node, 2)` condition. Confirm the `.py` file updates with the corresponding scheduler-builder call.
3. Wrap that condition in `Any(condition, AfterNCalls(...))`. Confirm code updates.
4. Remove the condition. Confirm it disappears from inspector AND code.

**Pass criteria:** code edits are surgical and round-trip; no schedule corruption.

#### T10: Composition-level inspector

**Fixture:** any model.
**Sign-off items:** Scheduling → "Scheduler config (mode) visible" / "Consideration queue visualization shown" / "Termination conditions editable".

**Steps:**
1. Click the composition's group node (or composition-level rectangle).
2. Confirm scheduler mode is shown.
3. Confirm the consideration queue visualization renders.
4. Edit a termination condition. Confirm the change writes to `comp.scheduler.termination_conds` in the `.py` file.

**Pass criteria:** all three visible and editable; termination edit lands correctly.

#### T11: Execution visualization

Already covered by T7 — verify execution-count badges are still visible after a fresh run on a scheduled model and mark sign-off items accordingly.

#### T12: MDF import / export / round-trip

**Fixture:** any small library model (export half), plus synthetic fixtures S3/S4 (import half).
**Sign-off items:** Model interoperability → "Import a `.mdf.json` or `.mdf.yaml`" / "Export a PsyNeuLink model to MDF" / "Round-trip preserves the model".

**Steps:**
1. With a small library model loaded, **Export → MDF**. Save to `/tmp/test_export.mdf.json`.
2. Confirm file exists and is valid JSON.
3. **Load Model → Import MDF…** the file you just exported. Confirm the model loads and the graph matches the original.
4. Repeat 1–3 with YAML format.
5. (If S3/S4 fixtures exist) Import each and confirm they load.

**Pass criteria:** export produces a valid file; import reproduces the original graph; round-trip is faithful (allowing for documented MDF gaps).

#### T13: MDF preflight warnings

**Fixture:** S5 (synthetic — a model with an MDF-incompatible feature). If S5 doesn't exist yet, file an issue and mark this sub-claim **Revisit**.
**Sign-off items:** Model interoperability → "Pre-flight warnings when MDF can't faithfully represent a model feature".

**Steps:**
1. Load S5.
2. Click **Export → MDF**.
3. Confirm a preflight dialog or warning enumerates the unsupported feature(s).

**Pass criteria:** warning appears and names the offending feature.

#### T14: Free-form → standardized conversion

**Fixture:** `backend/tests/fixtures/freeform_no_sections.py`.
**Sign-off items:** Model interoperability → "Free-form → standardized PsyNeuLink script conversion".

**Steps:**
1. Copy the fixture to a working location.
2. Load it in PsyNeuView. Confirm the conversion offer / banner.
3. Accept conversion. Confirm the file now has standardized sections and the graph still matches.

**Pass criteria:** conversion completes; resulting file is valid PsyNeuLink and visually equivalent.

#### T15: Demo origin tracking

**Fixture:** any built-in demo (`backend/demos/feedforward_network.py` or similar).
**Sign-off items:** Model interoperability → "After editing a demo, 'Reset to Demo' restores pristine state" / "`.pnlview.json` sidecar persists demo origin across saves".

**Steps:**
1. Load a demo.
2. Edit a parameter. Save.
3. Click **Reset to Demo**. Confirm the file returns to its original state.
4. Inspect the demo's `.pnlview.json` sidecar — confirm a `demo_origin` (or equivalent) field is present.

**Pass criteria:** reset works; sidecar persists across saves.

#### T16: Settings panel — source switching

**Fixture:** none — exercises the Settings panel itself.
**Sign-off items:** Configuration & deployment → "PyPI release source works" / "GitHub branch source works" / "Editable local checkout source works" / "`/api/settings/info` reports the active source correctly".

**Steps:**
1. Confirm Settings panel currently shows **PyPI release**. Confirm `curl http://localhost:8000/api/settings/info` reports it.
2. Switch to **GitHub branch**, enter `devel`. Wait for reinstall. Confirm `/api/settings/info` reports the GitHub source.
3. Verify Library section now lists `Giallanza2024_ego_study2`.
4. Switch to **Editable local checkout**, point to `../PsyNeuLink`. Wait for reinstall. Confirm `/api/settings/info` reports the local path.
5. Switch back to **PyPI release** (clean baseline for next reviewer).

**Pass criteria:** all three sources install successfully and `/api/settings/info` matches each time.

#### T17: Single-process serving

**Fixture:** none.
**Sign-off items:** Configuration & deployment → "Single-process serving".

**Steps:**
1. `make stop`. Build the frontend: `cd frontend && npm run build`.
2. Start the backend in production mode (per README / Makefile — typically `make backend` against the built bundle).
3. Open `http://localhost:8000` (NOT 5173). Confirm the app loads from the backend port alone.

**Pass criteria:** app fully functional on backend port without a separate Vite server.

#### T18: Mac launcher (optional, only if Mac app is set up)

**Fixture:** the PsyNeuView-MacApp build on this machine.
**Sign-off items:** Configuration & deployment → "Mac app launches PsyNeuView in WKWebView" / "Mac app env-var override is honored on `/api/settings/info`".

**Steps:**
1. Launch the Mac app. Confirm it shows the PsyNeuView UI in a WKWebView.
2. With a launcher-driven environment override active (per Mac app preferences), confirm `/api/settings/info` reports the override.

If you don't have the Mac app set up, mark **N/A** and note "tested on web only".

#### T19: Layout persistence

**Fixture:** any library model.
**Sign-off items:** Configuration & deployment → "Layout persistence".

**Steps:**
1. Load a model. Drag two or three nodes to distinctive positions.
2. Reload the page. Confirm positions are preserved.
3. Inspect the `.pnlview.json` sidecar. Confirm node coordinates are recorded.

**Pass criteria:** reload preserves positions; sidecar contains them.

#### T20: File watching

**Fixture:** any library model.
**Sign-off items:** Configuration & deployment → "File watching".

**Steps:**
1. Load a model.
2. In an external editor, edit a parameter literal in the `.py` file and save.
3. Confirm the GUI auto-refreshes (graph updates and / or a "file changed" notification appears).

**Pass criteria:** GUI reflects the external edit without a manual reload.

#### T21: Subprocess sandboxing

**Fixture:** S1 (synthetic infinite-loop). If S1 doesn't exist yet, file an issue and mark these sub-claims **Revisit**.
**Sign-off items:** Configuration & deployment → "A buggy / infinite-loop script does not hang the main app" / "Sandbox timeout fires".

**Steps:**
1. Load S1.
2. Run the model.
3. Confirm the GUI remains responsive — you can still click around, open the inspector, switch models — while the run executes.
4. Confirm a sandbox timeout fires within the configured limit and surfaces an error to the user.

**Pass criteria:** main app stays responsive; timeout fires; error surfaces cleanly.

#### T22: Quality — automated suites

**Fixture:** none.
**Sign-off items:** Quality & confidence → "`make test` passes locally" / "`npm run test:e2e:smoke` passes locally from `frontend/`".

**Steps:**
1. `make test`. Confirm green.
2. `cd frontend && npm run test:e2e:smoke`. Confirm green.

**Pass criteria:** both suites pass on the reviewer's machine on the branch under test.

#### T23: Version-mismatch warning

**Fixture:** S2 (synthetic version-mismatch). If S2 doesn't exist yet, file an issue and mark **Revisit**.
**Sign-off items:** Quality & confidence → "Version-mismatch warnings".

**Steps:**
1. Load S2.
2. Confirm a version-mismatch warning appears at load time.

**Pass criteria:** warning visible and accurate.

**End of Session 2.**

---

## Phase 3 — Synthetic-fixture build (if not already present)

If the synthetic fixtures S1–S5 aren't checked in by the time you reach this plan, file a follow-up issue and either:

- Build them inline (each is small — see specs in the **Test fixture set** section above), then return to T13 / T21 / T23.
- Mark the dependent sub-claims **Revisit** with the issue number.

The "build them" path is preferred if you have ~30 minutes; otherwise mark Revisit and move on.

---

## Coverage Matrix (fill in during Phase 1 T1)

For each library model, mark which feature axes it visibly exercises. Use this to pick the right model in Phase 2 procedures.

| Model | Has controller? | Has learning? | Has nested comp? | Has cycle / feedback? | Multiple input nodes? | Multiple output nodes? | Notable schedule? |
|---|---|---|---|---|---|---|---|
| Botvinick_conflict_monitoring_model |  |  |  |  |  |  |  |
| Cohen_Huston1994 |  |  |  |  |  |  |  |
| Cohen_Huston1994_horse_race |  |  |  |  |  |  |  |
| GilzenratModel |  |  |  |  |  |  |  |
| Kalanthroff_PCTC_2018 |  |  |  |  |  |  |  |
| Nieuwenhuis2005Model |  |  |  |  |  |  |  |
| MontagueDayanSejnowski96 |  |  |  |  |  |  |  |
| Giallanza2024_ego_study2 |  |  |  |  |  |  |  |

---

## Definition of done

A reviewer is "done" when:

- [ ] Every sub-claim in `RELEASE_FEATURES_SIGNOFF.md` has a Pass / Revisit / N/A mark — none left empty.
- [ ] Every Revisit has either a one-line Comment explaining the issue OR a filed issue number in `jonhanke-nam/PsyNeuView`.
- [ ] The Coverage Matrix above is filled in (so the next reviewer doesn't have to repeat Phase 1).
- [ ] The Final Sign-off section is marked **Approve release** or **Hold for follow-up**.
- [ ] The completed sign-off sheet (named `RELEASE_FEATURES_SIGNOFF_<initials>.md`) is committed or attached to the release-tracking issue.

When all reviewers' sheets are in, combine them into a single release report and attach to the GitHub release.
