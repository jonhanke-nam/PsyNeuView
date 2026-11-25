# Performance baseline

Performance is a requirement. This page records how long PsyNeuView takes to do
the everyday things with each reference model, so that a slowdown shows up as a
changed number rather than as a feeling (#406).

- **The numbers:** [`testing-coverage/perf-baseline.json`](testing-coverage/perf-baseline.json)
  (medians, in milliseconds), and the table below, which the measurement
  rewrites from it.
- **The measurement:** `frontend/e2e/_measure-perf-baseline.spec.ts`, run by
  hand against a production build. It is not in CI.
- **The CI check:** `frontend/e2e/perf-smoke.spec.ts` (@ci), a few key timings
  held to generous budgets.

## What is measured

Each reference model (the same ten the show_graph agreement batch uses) is
measured five times; the table shows the medians. Every time is taken inside
the page with `performance.now()`, starting in the same task as the click, so
Playwright's own round trips are left out. "Settled" means the canvas has not
changed for half a second, no model request is in flight, and the busy wheel is
off; the time reported is the last change before that quiet spell.

| Column | From | To |
|---|---|---|
| Open: first paint | the model's row clicked in the Open menu, on an empty canvas | the first frame with its nodes on screen |
| Open: settled | the same click | the graph settled (layout finished, Like show_graph's own request answered) |
| Switch: settled | the same click, with another model showing | its graph settled |
| Run: to results | Run Model, with the model's default inputs | the first trial's card on screen |
| Run: per trial | — | the backend's median time per trial (PsyNeuLink's per-trial hooks; EGO's build has none, so its run time over its trials) |
| Step: frame | each Next step through the trace (15 steps) | the frame painted after it |
| Drag: frame (p95) | — | the gap between frames while the largest node is dragged (median, and the slowest 5 %) |
| Typing: latency (p95) | each key press in the code editor, live preview on | the frame painted after it (median, and the slowest 5 %) |
| Typing: graph updated | the last key press | the graph redrawn from the edit; includes the live preview's 1.5 s wait for typing to pause |
| Fold / unfold | Collapse (then Expand) on a composition frame, in the nested view | the graph settled. Only EGO has a composition to fold |

The app's own load breakdown (its `[perf] load` line: request, build, paint,
and the backend's introspection time) is recorded in the JSON beside these.

## Results

All times in milliseconds unless marked in seconds.

<!-- perf-table:start -->
| Model | Open: first paint | Open: settled | Switch: settled | Run: to results | Run: per trial | Step: frame | Drag: frame (p95) | Typing: latency (p95) | Typing: graph updated | Fold / unfold |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Conflict Monitoring — Stroop (Botvinick et al. 2001) | 1411 | 1428 | 1160 | 1191 | 17 | 12 | 8 (9) | 13 (16) | 2909 | – |
| Stroop — Horse Race (Cohen & Huston 1994) | 1239 | 1254 | 1179 | 1199 | 15 | 13 | 8 (9) | 13 (17) | 2914 | – |
| Stroop — Bidirectional (Cohen & Huston 1994) | 1082 | 1101 | 1100 | 1073 | 14 | 11 | 8 (9) | 14 (17) | 2473 | – |
| EGO — Giallanza et al. 2024 (Study 2) | 3128 | 3206 | 3272 | 3330 | 629 | 13 | 8 (9) | 15 (17) | 5132 | 3564 / 3562 |
| Locus Coeruleus — gain model (Gilzenrat et al.) | 736 | 756 | 785 | 692 | 7 | 10 | 8 (10) | 14 (17) | 2281 | – |
| Stroop — PCTC (Kalanthroff, Davelaar & Usher 2018) | 1153 | 1168 | 1093 | 1093 | 13 | 14 | 8 (10) | 15 (18) | 2668 | – |
| TD Learning / dopamine (Montague, Dayan & Sejnowski 1996) | 636 | 652 | 647 | 682 | 4 | 11 | 8 (9) | 15 (17) | 2087 | – |
| Locus Coeruleus / P300 (Nieuwenhuis et al. 2005) | 675 | 727 | 743 | 751 | 7 | 10 | 8 (10) | 14 (17) | 2278 | – |
| Stroop — Basic | 708 | 730 | 743 | 1219 | 98 | 14 | 8 (9) | 14 (17) | 2151 | – |
| Stroop — with Locus Coeruleus (LC) | 938 | 958 | 965 | 2817 | 356 | 14 | 8 (9) | 14 (17) | 2437 | – |
<!-- perf-table:end -->

**Machine:** see `machine` in the JSON: an Apple M4 Max (14 cores, 36 GB),
macOS, Chromium as Playwright ships it, PsyNeuLink as installed in the
backend's environment. The machine was otherwise quiet (one-minute load
average about 6 on 14 cores, recorded in the JSON); earlier trial runs made
while it was busy came out within about 20 % of these, so treat differences
smaller than that as noise. **CI numbers differ:** GitHub's runners have fewer, slower cores, and
are shared; expect two to four times these.

The first of the five runs comes straight after the test harness restarts the
backend's model worker, so it is often slower; the median sets it aside.

## Running it

```sh
cd frontend
npx vite build
PERF_BASELINE=1 PW_PROD_PORT=<a free port> npx playwright test e2e/_measure-perf-baseline.spec.ts
```

About 15 minutes. Options: `PERF_RUNS=3` (default 3, the committed baseline
used 5), `PERF_MODELS="EGO,Stroop — Basic"` (labels containing these),
`PERF_NO_WRITE=1` (print only, leave the files alone). Each model's raw runs go
to `frontend/test-results/perf-baseline/`. Commit the JSON and this page when a
change is meant to move the numbers, and say why in the pull request.

## The CI check

`perf-smoke.spec.ts` runs with the other @ci specs, in the existing e2e shards,
so it adds no job and no runner start-up: about 40 seconds of one shard (#991).
It measures, once each:

- opening Stroop — Basic, to settled;
- running its default inputs, to the first trial's results;
- stepping its trace (median frame after Next step);
- typing in the code editor (slowest 5 % of key-to-frame times);
- opening EGO, the heaviest model, to settled.

Each is held to the budget in `ciBudgets` in the JSON. The budgets are set at
roughly six times this machine's median, with a floor of 150 ms for frame
times: twice what a CI runner is expected to take, so a doubling fails and
noise does not. The spec prints every measurement (`[perf-smoke]` in the CI
log, and as an annotation on the test), so once a few CI runs have reported,
the budgets can be tightened to about twice CI's own median.

## The slowest areas: open questions

Found while taking this baseline. None is fixed here; each needs its own
issue and its own before-and-after measurement.

1. **Opening a model is almost all the backend building it.** The backend's
   introspection is 0.6–1.2 s of each open (3 s for EGO), and the browser's
   share (building the graph and painting it) is under 100 ms. Switching back
   to a model that was open a moment ago costs the same as opening it fresh.
   *Suggestion:* keep the last few introspections, keyed by the file's
   content hash, so a switch back is instant; and look at what in
   introspection dominates for EGO.
2. **Every run rebuilds the model first.** For the Stroop-like models the
   backend's run takes about 1 s for five trials of about 15 ms each: roughly
   0.9 s is the sandbox worker executing the model's script again before the
   first trial, about the same as introspection. *Suggestion:* keep the built
   composition in the warm worker between runs while the source hash is
   unchanged (reset its state instead of rebuilding), and report build and
   trial time separately in `timings`.
3. **Some models' trials are slow in PsyNeuLink itself:** Stroop with LC
   about 360 ms a trial, Stroop — Basic about 100 ms, EGO about 630 ms
   (EGO's figure includes its rebuild; its build returns no per-trial times).
   *Question:* would LLVM (compiled) mode, or fewer time steps per trial in
   the integrator-based models, be acceptable defaults for these?
4. **The graph takes 2–5 s to follow an edit.** About 1.5 s of that is the
   live preview deliberately waiting for typing to pause; the rest is the
   preview introspecting the edited model, the same cost as item 1.
   *Question:* is 1.5 s the right wait? Item 1's cache would also help when an
   edit is undone or only touches comments.
5. **Folding EGO's EM takes about 3.5 s each way,** because folding reloads
   the model from the backend. *Suggestion:* fold and unfold on the client
   from the nested model already loaded, without a round trip.
6. **What is fast:** stepping a trace (about 12 ms to the next frame), dragging
   a node (frames every 8–10 ms, no dropped frames), and typing (about 14 ms a
   key, 17 ms at the slowest 5 %, even while the preview works). These hold
   steady across models, so the canvas and the editor are not where the time
   goes today.

Also found (not about speed): opened from the Open menu, EGO shows EM folded
while the view menu reads "Flatten (all compositions)", and its Expand button
reloads the model but leaves EM folded. Chosen from the view menu, the EGO
composition's own view expands it as it should. Opened from a path, EGO shows EM open, as
`composition-frame-buttons.spec.ts` expects. The baseline times folding in
the nested view for that reason.
