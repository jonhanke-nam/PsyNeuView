# CI catches

A running ledger of things our CI has caught — which suite surfaced what, and
how it was fixed. Purpose:

1. Show the **value** of our tests (concrete catches, not just green checks).
2. Build intuition for **which suites catch which kinds of bugs**.
3. Easy **reporting**.

## Convention

When a CI failure turns out to be a real bug — or a meaningful hardening —
**add a row below in the same PR that fixes it**. For real product bugs, also
apply the **`ci-caught`** label to the bug issue so the live list is queryable:

```bash
gh issue list --label ci-caught
```

The file is the narrative record; the label is the filter. (We deliberately
don't use a single GitHub issue as the ledger — it gets noisy and is awkward to
format.) Tracked as a process in #709.


## The MDF-gap check would have stalled the server while it loaded a model (2026-10-12)

**Caught by:** `backend pytest` and `backend pytest (3.14)` →
`test_no_event_loop_blocking.py::test_no_blocking_call_in_async_endpoint`, on
#1410 before it merged

The new `POST /api/model/mdf-gaps` endpoint (#83–#87) was declared `async` but
called `load_and_introspect` and the sandbox directly, so while the export
dialog checked a model for MDF gaps, every other request to the server would
have waited. The guard test lists exactly that endpoint. Fixed by making it a
plain `def`, which FastAPI runs on its thread pool, like its neighbours.

## A function-built model loaded with no Composition, now and then (2026-10-11)

**Caught by:** `backend pytest (3.14)` →
`test_library_models.py::test_library_model_runs[MontagueDayanSejnowski96.py]`,
twice, on unrelated branches (#1382)

Montague builds its Composition inside a function, so introspection finds it by
scanning `gc.get_objects()` for Compositions that were not alive before the
load. That "before" snapshot kept only `id()` values, and it included
uncollected garbage from earlier loads. When the garbage was freed during the
load, Python 3.14 put the new Composition at the same address, so its id was
already in the snapshot and it was skipped: "no top composition found", with
the driver's `KeyError: 'TD_Learning_Figure_5A'` as the only report. The app's
long-lived sandbox worker had the same exposure, on load and on Run. Fixed by
having the snapshot hold the objects until the load is done;
`test_composition_snapshot_id_reuse.py` sets up the collision on purpose.

## The toolbar's Undo and Redo buttons did nothing (2026-10-07)

**Caught by:** `tutorials` → `orientation.tutorial.spec.ts` (part 3, "Editing",
step `undo`), the first run of the new-user orientation walkthroughs (#1313,
under #1310)

The buttons were enabled, their tooltips named the step to undo, and a click
changed nothing. They faked a `keydown` on `window` for ⌘Z; the shortcut
registry (#1112) had since taken over undo and no longer acted on that
synthetic event, while a real ⌘Z still worked, so nobody noticed. The
walkthrough's undo step is judged on the model (`paramEquals` back to 1), not
on the click, so it stuck. Fixed by having the buttons call the same
`applyHistoryStep` the shortcuts run; the walkthrough is the regression test.

## The file watcher hashed the file before it settled (2026-10-06)

**Caught by:** `backend pytest (3.14)` →
`test_echo_suppression_holds_across_save_strategies[backup-then-create]`, on a
version-number PR, the first full run after the backend suite went parallel
(#1259) (#1284)

The watcher hashed the model file the moment a filesystem event arrived and only
debounced the callback. A save that empties the file first (in place, or "move
the original aside, create a fresh file") could be read half-written; the empty
file's hash matched neither the last known content nor our own write, so the
app's own save was reported as an outside edit. Parallel test load widened the
window; the bug was older. Fixed by deciding after the file settles: events
only restart the debounce timer, and the timer reads mtime and hash once. A new
test delivers an event while the file is empty and then completes the write: it
fails on the old code and passes now.
## A late canvas preview replaced the newly opened model's graph (2026-09-30)

**Caught by:** `tutorials` → `walkthrough-other-model.tutorial.spec.ts` ("with
unsaved changes kept…"), whose first attempt failed in every CI run since #1237
and passed on retry (#1248)

Typing schedules a canvas preview 1.5 s later (#1029). On CI, opening another
model takes longer than that, so the old file's preview went out mid-open, came
back after it, and the app adopted it: the new model's code in the editor, the
old model's graph on the canvas. "Passed on retry" hid it for five runs. Fixed
by dropping a preview answer when the open file, or its saved text, changed
after it was sent, with a test that forces the slow ordering.

## Input sets preloaded a whole experiment into Run (2026-09-29)

**Caught by:** `e2e` → `reference-models-runnable.spec.ts` (Nieuwenhuis 2005,
Gilzenrat), intermittently from the #1233 merge onwards

The input-set detector (#1216) offers any module-level `{node: trials}` dict, and
the Run tab preloaded the first. The LC models define their full experiment that
way (`stim_list_dict`, 1,100 trials), so pressing Run went from a one-trial look
to the whole experiment: locally 0.6 s → 8 s to run, and 0.1 s → 8 s of rendering
afterwards. On CI's slower runner that pushed the test past its 120 s limit.

The failure read as `white screen after running …`, which was wrong: the
screenshot showed the app rendered. The spec's root check caught every error as
"0 children", so a page too busy to answer looked like a crash. The trace showed
a 2.5 s wait taking 58 s. Fixed by preloading only sets of up to 100 trials (larger
ones stay in the picker), and by making the check report a timeout as one.

**Why it mattered:** a default Run of two reference models became about 30×
slower, and the test that noticed was pointing at the wrong cause.

## `make release-tag` was undocumented (2026-09-15)

**Caught by:** `mkdocs build (strict)` → `scripts/docs_surface_check.py`

Adding a `release-tag` target with `##` help text but no README entry. The check
refused the PR:

```
- make target 'release-tag' has help text but is never mentioned in the README
  (document it, drop its ## help, or add it to INTERNAL_TARGETS)
1 gap(s). See #826.
```

**Why it mattered:** the target implements the release convention in #1073 — the
one operation the convention says cannot be undone once pushed. A release tool
nobody can find is worse than no tool, because the convention then gets followed
by hand and inconsistently.

**Fixed by** documenting it in the README target table. The gap was real: I had
written help text for `make help` and stopped there, assuming that counted as
documentation.

## "It passed on re-run" is not evidence of a flake

Four times now, a failure that re-ran green was a deterministic bug:

| Looked like | Actually was |
| --- | --- |
| [#810](https://github.com/jonhanke-nam/PsyNeuView/issues/810) flaky flat-view tutorial | A backend deadlock — undrained sandbox-worker stderr filled the pipe |
| [#999](https://github.com/jonhanke-nam/PsyNeuView/issues/999) intermittent canvas click | Geometry: the node's box sat under the toolbar, deterministic per runner |
| [#1203](https://github.com/jonhanke-nam/PsyNeuView/issues/1203) intermittent e2e | Two separate bugs — a spec whose wait never waited, and an unbounded worker handshake |

Each one passed on re-run, so it was re-run rather than read. The pattern is
that **environment-sensitive bugs look random across machines while being
perfectly deterministic on any one of them** — a fast runner passes, a slow one
does not.

What actually resolved all four was the same move: **download the uploaded
artifact and read the call log or page snapshot.** Playwright names the
element that intercepted a click; the page snapshot shows the app mid-load with
its spinner and elapsed seconds. The Actions summary line shows none of that,
and #999 sat for three weeks because only the summary was read — while the
artifact holding the answer expired.

Before quarantining under the [#160](https://github.com/jonhanke-nam/PsyNeuView/issues/160)
policy, read the artifact. Two occurrences on unrelated PRs is a signal to
investigate, not a threshold for writing it off.

## Bugs caught

Real product/behavior bugs first surfaced by CI.

| Date | Suite | What it caught | Fix | Issue |
|------|-------|----------------|-----|-------|
| 2026-06-30 | Tutorials (`tutorials.yml`) | Reference/demo models fail to run when the working dir isn't `backend/` — the frontend guessed the working-copy path instead of using the one the backend wrote. Affects isolated / multi-user deployments, not just CI. | [#695](https://github.com/jonhanke-nam/PsyNeuView/pull/695) | [#706](https://github.com/jonhanke-nam/PsyNeuView/issues/706) |
| 2026-06-30 | Tutorials (`tutorials.yml`) | The "Viewing options" tutorial (doc + spec) drifted after #717 moved the **Flatten** control from the `More ▾` menu into the view selector — the doc gave wrong instructions and the spec timed out. The executable-tutorial gate caught the drift. | [#732](https://github.com/jonhanke-nam/PsyNeuView/pull/732) | #717 |
| 2026-09-08 | Backend pytest (3.14) | Echo suppression for the app's own saves lost a race: `write_model_source` wrote the file and *then* told the watcher what it had written, so the filesystem event could arrive first and the app's own save was reported as an external edit. Passed on macOS, where FSEvents latency hides it; Linux inotify is fast enough to lose the race reliably. Would have made PsyNeuView reload itself after saving. | [#1037](https://github.com/jonhanke-nam/PsyNeuView/pull/1037) | [#1026](https://github.com/jonhanke-nam/PsyNeuView/issues/1026) |
| 2026-09-23 | Tutorials (`tutorials.yml`) | The warm worker's ready handshake used a plain `readline()` with no deadline, so a worker that never printed `###READY###` blocked forever — and `_start()` holds `send_task()`'s lock via `_restart()`, wedging every later request. Surfaced as a **two-mechanism** model still "Loading…" after 65s with zero nodes. `send_task()` had already fixed this exact bug one function away. | [#1205](https://github.com/jonhanke-nam/PsyNeuView/pull/1205) | [#1203](https://github.com/jonhanke-nam/PsyNeuView/issues/1203) |
| 2026-09-23 | Tutorials (`tutorials.yml`) | Setting a *function* parameter to the value it already held appended a second `function=`, producing `keyword argument repeated: function` — a model file that no longer parses. A regression from [#1202](https://github.com/jonhanke-nam/PsyNeuView/pull/1202), caught by running the suite after merging `devel` into `feature/tutorials`. The write guard did **not** refuse the invalid source, which is its own gap. | [#1206](https://github.com/jonhanke-nam/PsyNeuView/pull/1206) | [#1200](https://github.com/jonhanke-nam/PsyNeuView/issues/1200) |
| 2026-09-08 | Tutorials (`tutorials.yml`) | The canvas doesn't re-fit when its pane is *resized* — only when panes are toggled. Running a model grows the results panel, shrinks the canvas, and pushes nodes out of view with no indication. CI surfaced it as a click timeout in `live.tutorial.spec.ts`, where the off-screen node's bounding box landed in the toolbar's area and intercepted the click. **Misread as a flake for three weeks** (#999) because re-running passed and it wouldn't reproduce locally — the geometry is deterministic per runner, not random, so `retries: 1` failed it twice every time. Fixed by flagging off-screen nodes rather than silently re-framing the view. | [#1185](https://github.com/jonhanke-nam/PsyNeuView/pull/1185) (fix), [#1057](https://github.com/jonhanke-nam/PsyNeuView/pull/1057) + [#974](https://github.com/jonhanke-nam/PsyNeuView/pull/974) (test-side mitigations) | [#1183](https://github.com/jonhanke-nam/PsyNeuView/issues/1183), [#999](https://github.com/jonhanke-nam/PsyNeuView/issues/999) |
| 2026-10-11 | Tutorials (`tutorials.yml`) | A parameter edit silently replaced the Run tab's chosen input set. The same-file reload refilled the grid from scratch (the first set small enough to preload, or the 1-per-trial defaults) and kept the trial count. The Conflict Monitoring walkthrough picked `incongruent`, the reload from its gain edit landed a moment later, and the run used defaults: TASK DEMAND's word unit 0.9998 where the lesson needs < 0.2. **Passed on retry**; the artifact's screenshot showed trial 1's inputs as `[1,0,0]`, `[1,0,0]`, `[1,0]`, which is no declared set. | [#1375](https://github.com/jonhanke-nam/PsyNeuView/pull/1375) | #57 |
| 2026-10-11 | Tutorials (`tutorials.yml`) | The scheduling-conditions legend auto-placed itself in the bottom-left corner on the CI runner's layout, over React Flow's zoom and fit controls: the fit button stayed visible and every click landed on the legend. Found by the new EGO walkthrough (EGO has `BeforeNodes` conditions); the call log named the legend's swatch as the element intercepting the click. | [#1375](https://github.com/jonhanke-nam/PsyNeuView/pull/1375) | #55 |

## CI hardening

Not product bugs, but failures the pipeline surfaced that were worth fixing —
kept here so the cost/value of standing up CI is visible too.

| Date | Suite | Issue | Fix |
|------|-------|-------|-----|
| 2026-06-30 | Tutorials | torch's CUDA wheel exhausted the runner disk (`[Errno 28]`) | Free unused toolchains before install ([#695](https://github.com/jonhanke-nam/PsyNeuView/pull/695)) |
| 2026-06-30 | Tutorials | Over-broad `/error\|failed/i` assertion in the training spec matched incidental UI text and flaked | Tightened to the success banner ([#695](https://github.com/jonhanke-nam/PsyNeuView/pull/695)) |
| 2026-06-30 | Backend pytest | `test_executor.py` asserted a bare node name (`STATE`), but PsyNeuLink suffixes duplicates (`STATE-8`) as EGO is rebuilt across the suite — flaked the first time the full suite ran in CI | Normalize via the existing `clean_name()` helper ([#715](https://github.com/jonhanke-nam/PsyNeuView/pull/715)) |
| 2026-06-30 | All (Actions) | `actions/*@v4/v5` bundled the deprecated Node 20 runtime (deprecation warning) | Bump to Node-24-native majors (`checkout@v5`, `setup-python@v6`, `setup-node@v5`, `cache@v5`) ([#715](https://github.com/jonhanke-nam/PsyNeuView/pull/715)) |
| 2026-09-16 | E2E + Tutorials | Folding the Open menu's catalog sections by default (#1135) broke 40 tests across both suites — every spec that reached a model by clicking **Open** then a model label timed out on a label now hidden inside a collapsed section. The app was behaving as intended; the suites had silently depended on the sections being open. | Seed the sections expanded in the shared `e2e/test-base.ts` fixture, and cover the new folded default explicitly ([#1136](https://github.com/jonhanke-nam/PsyNeuView/pull/1136)) |
| 2026-09-23 | E2E | `reference-loaded-marker` waited for "a node to be visible" after switching models — already true from the *previous* model, so the wait returned instantly and the spec asserted before the new model had loaded. Failed 3× on unrelated branches, always the same assertion. | Wait for the node **set** to change, not for any node to exist ([#1204](https://github.com/jonhanke-nam/PsyNeuView/pull/1204)) |
| 2026-09-28 | Backend pytest (local full run) | `test_install_post_allowed_in_mac_app` posted a PyPI install without stubbing `Popen`, so **every backend run — CI included — did a real `pip install --force-reinstall psyneulink`** in a background thread, swapping the pinned PsyNeuLink for PyPI's mid-suite and rewriting its files under whatever model the warm worker was running. Hidden by a second bug: the unlocked post-install restart killed any worker the rewrite had hung, and the request fell back to a cold start. Fixing that lock ([#1208](https://github.com/jonhanke-nam/PsyNeuView/issues/1208)) surfaced it as a 300s timeout in `test_library_model_loads_and_runs[Cohen_Huston1994_horse_race.py]`, which passes in 4s alone. Tell: the local venv's `psyneulink` had an mtime from the middle of the test run. | Stub `Popen` like the neighboring test already did ([#1209](https://github.com/jonhanke-nam/PsyNeuView/pull/1209)) |
| 2026-09-28 | E2E | `pytorch-view.spec.ts` gave the EGO PyTorch-view reload the default 20s, on a call that took **12.3s** on one runner and **20.7s** on another: 7.9s against 13.6s of introspection, plus waiting out the show-graph call still running from the model's first load. The option check raced the load too: `openModel` returns once the filename shows, which the editor header does mid-load. It surfaced on [#1214](https://github.com/jonhanke-nam/PsyNeuView/pull/1214), an unrelated editor change, four minutes after the same code passed on `devel`. Diagnosed from the run log's `[perf] /model/load` lines, not by re-running. | Both waits get the suite's 60s model-load budget ([#1214](https://github.com/jonhanke-nam/PsyNeuView/pull/1214)) |
| 2026-09-29 | Tutorials | The guided-walkthrough spec ran every walkthrough as a `readOnlyTest`, with no reset between them. The **build** walkthrough adds a TransferMechanism to Stroop — Basic, so each later walkthrough that opened Stroop loaded that edited working copy (8 mechanisms, a custom layout). On one CI runner the layout left `color_hidden` off-screen, and the Stroop walkthrough's step-2 ring was never drawn. It passed locally and on the previous PR's CI only because the leftover layout happened to keep the node visible. Found on [#1217](https://github.com/jonhanke-nam/PsyNeuView/pull/1217), which only added a walkthrough; diagnosed from the artifact's screenshot ("Loaded your edited copy", "7 nodes off-screen"). | The spec uses `mutatingTest`, so each walkthrough starts from a reset working dir ([#1217](https://github.com/jonhanke-nam/PsyNeuView/pull/1217)) |
| 2026-09-29 | Tutorials | The Episodic Memory demo, the course notebook's `EMComposition(memory_capacity=1000)`, took 9.2s to load locally and **over 30s** on the CI runner, past the 30s introspection limit (`Script execution timed out after 30 seconds`), so its walkthrough never got past step 1. The cost is building the memory matrices: at capacity 100 it loads in 1.4s and draws the same 16 nodes. A learner opening the notebook's own model on a slow laptop would hit the same timeout. Found on [#1221](https://github.com/jonhanke-nam/PsyNeuView/pull/1221) from the run log, not by re-running. | The demo uses capacity 100 and says why ([#1221](https://github.com/jonhanke-nam/PsyNeuView/pull/1221)); the load limit itself is still open |
| 2026-10-11 | Tutorials | The walkthrough driver's `openModel` returned as soon as it clicked, and the step check gave the load 10s; the EGO demo (a nested EMComposition) took longer on the CI runner's retry. `setParameter` returned once the field showed the value, before the reload, which let the next step start under it (part of the Conflict Monitoring catch above). | `openModel` waits for the status bar's "Loading…" to clear on the 30s load budget; `setParameter` waits for the update-param response and reload ([#1375](https://github.com/jonhanke-nam/PsyNeuView/pull/1375)) |
| 2026-10-28 | E2E | With the bigger default text ([#118](https://github.com/jonhanke-nam/PsyNeuView/pull/118)) and the narrower default editor ([#117](https://github.com/jonhanke-nam/PsyNeuView/pull/117)), a 900 px window left the editor pane about 220 px wide. The **Files: .psyneuview/ (default)** picker ran past the pane's edge, where the divider clipped it, and the file name ran under **A− A+**. `sidecar-placement.spec.ts` (#1211) caught it from the hit test at the picker's right end; the local pre-push run had not included that spec. | The picker and the file name shrink with an ellipsis instead of overflowing ([#118](https://github.com/jonhanke-nam/PsyNeuView/pull/118)) |
| 2026-10-29 | Backend pytest | The conftest isolated the preferences file but not the PsyNeuLink update checks. A test that starts the app with its lifespan (`TestClient`) started the check scheduler; its first check finished a network round trip later, inside some other test, and wrote `pnl_update_state` to whichever preferences file was current — the real `~/.psynewview.json` when that test had unset the override. The real-file guard failed `test_the_editor_save_writes_a_local_checkout_file` in one job and `test_open_extracts_to_working_dir` in the other: different victims, same writer. Surfaced on [#150](https://github.com/jonhanke-nam/PsyNeuView/pull/150), whose new demo tests lengthened the run enough to move where the write landed; diagnosed from the run log's file contents, not by re-running. | The conftest sets `PSYNEUVIEW_PNL_UPDATE_CHECKS=0` for every test ([#150](https://github.com/jonhanke-nam/PsyNeuView/pull/150)) |
| 2026-10-29 | Backend pytest | `test_an_outside_save_to_an_open_library_model_updates_the_app_once_and_quickly` budgets 10s from an outside save to `file_changed`, which includes re-reading EGO. Locally that step is about 3s once the rest of the suite has run (2.4s alone; PsyNeuLink's in-process registries grow), and a CI runner is about 3.5x slower: the test took 18-22s overall on devel's runs, the step itself at the edge. Three lesson PRs failed it at 10.3-10.7s in one job each. Running only devel's demo tests first, or all the new lessons' too, moved the local step by 0.04s, so the lessons weren't the cause: the budget had no headroom on CI. | CI gets 20s; the 10s promise still holds on a laptop ([#154](https://github.com/jonhanke-nam/PsyNeuView/pull/154)) |
