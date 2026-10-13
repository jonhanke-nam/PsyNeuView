# Backlog survey — the book of work

**Surveyed 2026-09-17**, against `devel` and 1,530 commits of history.

This is not a roadmap. It is a measurement: what is actually open, grouped so
that "what's next" can be asked of one area at a time instead of one list of
four hundred. [`TODO.md`](./TODO.md) holds the roadmap; GitHub holds the truth;
this says what shape the truth is currently in.

## Why it was needed

The backlog had stopped meaning anything. Issues were being fixed and left
open, so the list described neither what was broken nor what was planned. The
cost was not tidiness — it was that **planning against it produced wrong
answers**. Repeatedly, work picked from the list turned out to be already built:

- **#975**, labelled `[Bug][Urgent]`, had been fixed in PR #978 and left open.
- **#1029** was solved *better than it asked* — the app stopped writing the
  file at all rather than choosing when to autosave — and nobody closed it.
- Two of **#961**'s three asks had shipped; only the third remained.
- **#1010**, **#1013**, **#1031** and **#964** were each substantially built
  before being picked up.

Roughly **half** of the issues reached for in one session were already done.

## Method

Reproducible, and deliberately simple enough to re-run.

1. List every open issue.
2. Index every commit subject on `devel` by the issue numbers it names.
3. For each issue, look at the **newest** commit naming it, and classify by
   what that commit *is*.

```
likely-shipped            newest commit is feat/fix and does the thing
shipped-then-documented   a feat/fix exists, but the newest touch is docs
mentioned-only            commits name it, none of them implement it
no-commits                nothing in history names it
```

**The count of commits does not discriminate.** Nearly every open issue has
some. What separates shipped from open is the *type* of the newest one: an
issue whose most recent touch is `docs(TODO): record the edge-routing arc` is
someone writing work down, not doing it. That single distinction identified
every case correctly in a hand-checked sample.

A caution, learned the hard way: `git log --grep` searches the whole commit
*message*, so it matches issues named in a body rather than a subject. An early
version of this survey used it and attached #1017's evidence to #1008. Index
subjects only.

## Results

| Classification | Count | Meaning |
| --- | ---: | --- |
| `no-commits` | 239 | genuinely untouched — this is the real backlog |
| `likely-shipped` | 121 | built; **candidates to close**, 29 done so far |
| `shipped-then-documented` | 18 | built, then a docs commit touched it last |
| `mentioned-only` | 18 | work happened nearby; the issue itself did not |

**The first run of this survey got that badly wrong**, and the mistake is worth
keeping because it is easy to repeat. It counted only conventional-commit
prefixes — `feat`, `fix`, `perf`, `refactor` — as evidence of work. This repo's
older history writes `area: description` instead:

```
modelStore: focus-mode state + focused-composition graph root (#426)
Frontend: type-coded port dots on mechanism nodes (#184)
backend: redirect PsyNeuView sidecars/backups out of managed clones (#349)
```

Those are finished features. The rule read them as *mentions*, and reported
**6** likely-shipped where there were **121** — understating by a factor of
twenty, with 132 issues misfiled. The rule is now an exception list: anything
that is not bookkeeping counts as doing.

Spot-checked after the correction — #914 (`edgeRouter.ts`), #894
(`runTimingStore.ts`), #874 (`loadTimingStore.ts`), #853, #989 — all five had
their implementation in the tree.

**426 → 396 open** so far: 29 closed by this survey, plus ~30 closed by hand
earlier the same day from the edge-rendering cluster and the two-headed arc.
Every closure carries the commit that shipped it and an invitation to reopen,
because a heuristic will be wrong somewhere — as the miscount above shows, it
already was once.

**The remaining ~92 `likely-shipped` are the next obvious pass.** They are
candidates, not conclusions: check each against the code, and never close an
umbrella because one of its children shipped.

Deliberately **not** closed: umbrellas (a shipped child does not finish the
parent), issues with a PR in flight, and cases where the evidence pointed at a
*related* issue rather than the issue itself (#279, #160).

## Re-running it

```bash
python3 scripts/backlog_survey.py          # summary
python3 scripts/backlog_survey.py --tsv    # every row, for grouping
```

Run immediately after the closures above it reports **6 likely-shipped**
instead of 29 — which is the closures taking effect, and a useful check that
the script measures what this document claims.

Those six, plus one `shipped-then-documented`, are exactly the ones held back
on purpose:

| | why it was not closed |
| --- | --- |
| #966, #761 | umbrellas — a shipped child does not finish the parent |
| #961, #964 | had a PR in flight at the time |
| #860, #279, #160 | evidence pointed at a *related* issue, not this one |

If a future run reports a number far above six, either real work has shipped
without its issues being closed, or the drift has started again.

## How to use this

Take one area. Ask "what's next" of it. Build, merge, and strike through what
lands. The areas are sized to be answerable — the largest is an argument for
splitting it, not for reading it all.

Two things worth doing before planning against any area:

- **Re-run the survey.** It is cheap, and this document is a snapshot.
- **Read the code before committing to an issue.** The survey narrows the
  field; it does not replace looking. The `mentioned-only` group in particular
  hides partially-built work that no commit subject admits to.

---

# The areas

| Area | Open | Oldest | Newest | Most-discussed |
| --- | ---: | --- | --- | --- |
| **Execution & run** | 86 | #4 | #1078 | #247 (6) |
| **Layout & canvas** | 60 | #83 | #1118 | #395 (5) |
| **Unsorted** | 44 | #9 | #1139 | #9 (7) |
| **Edges & routing** | 25 | #281 | #967 | #938 (5) |
| **Reference models** | 24 | #222 | #1128 | #1128 (2) |
| **Testing** | 22 | #145 | #1025 | #321 (4) |
| **Docs & tutorials** | 21 | #206 | #994 | #501 (1) |
| **Build & release** | 16 | #11 | #991 | #251 (4) |
| **Open/save & formats** | 15 | #253 | #864 | #864 (7) |
| **Umbrellas** | 14 | #341 | #1158 | #1058 (5) |
| **Editor & inspector** | 13 | #195 | #1094 | #1094 (5) |
| **Two-headed / files** | 12 | #268 | #1134 | #504 (3) |
| **Undo & history** | 12 | #38 | #1156 | — |
| **Hosting & deployment** | 8 | #260 | #1110 | #1074 (2) |
| **Settings & app shell** | 7 | #118 | #915 | #457 (2) |
| **Parameter fitting** | 6 | #328 | #541 | #512 (2) |
| **MDF** | 5 | #84 | #159 | — |
| **Design & discussion** | 4 | #361 | #959 | #785 (8) |
| **Graph editing** | 2 | #151 | #909 | — |


### Execution & run — 86 open

- **#1078** Upgrade the Railway demo to Hobby on the lab's account — the trial expires and its fallback can't run the app `process`
- **#1061** PyTorch view: EGO has no STORE node and nothing is tagged excludeFromGradientCalc `bug`
- **#997** [Exec modes] Learn is PyTorch-only in practice — non-autodiff learning can't report loss
- **#989** CI path filters use a two-dot diff, so branches behind devel run gates they never touched
- **#901** Backend pytest: assert PsyNeuLink _debugger hook actually fires (regression guard) `testing`
- **#897** Onboarding docs: clarify the two 'devel' branches, private-repo access, and debugger-hook caveat `documentation`
- **#896** Sandbox model execution for hosted / multi-user PsyNeuView
- **#894** Show run time in the UI — live counter during a run + "ran in X.Xs" after (run-side counterpart to #874)
- **#892** Load+run ALL PsyNeuLink library models via the native Run path (test + fix factory-only 'not found')
- **#840** 0.19 adds the LOSS node to the autodiff execution trace — update trace/snapshot synthesis
- **#838** [Examples] Load+run regression test over Scripts/Examples `testing,reference-model`
- **#808** Bug · executor: raw library models fail to Run — module-level driver's post-run read aborts the load `bug`
- **#772** [Nested GRU] Verify rendering across default / nested / PyTorch views `bug,reference-model`
- **#771** [Nested GRU] Runnability: load, run & baseline-match PsyNeuLink `testing,reference-model`
- …and 72 more

### Layout & canvas — 60 open

- **#1118** [Survey] What each bundled reference model needs from the canvas
- **#1013** [Layout] Role-aware layered layout — rank by role, not graph depth `enhancement`
- **#1001** [Exec modes] #763's matrix says PyTorch is unsupported for a plain Composition — it isn't
- **#999** [Flake] live.tutorial.spec.ts — canvas node click times out intermittently in CI
- **#908** [Layout] Node-role legend + highlight/select nodes by role, and move a role-group together `enhancement`
- **#907** [Layout] Complete session undo/redo coverage for layout changes (Flip X/Y, Reset Custom Layout, re-layout) `enhancement`
- **#902** [Design] Layout system: auto-assembly + manual persistence — architecture, decisions, resolution model `documentation,enhancement,discussion`
- **#810** Flaky e2e: flat-view tutorial ('Flatten inlines a nested composition') intermittently times out
- **#784** Side-by-side toggle: React graph vs PsyNeuLink show_graph `enhancement`
- **#783** [Layout curation] Quality-bar review pass + curation standards `enhancement,reference-model`
- **#782** [Layout curation] Curate best PyTorch view layouts `enhancement,reference-model`
- **#781** [Layout curation] Curate best nested / inlined view layouts `enhancement,reference-model`
- **#780** [Layout curation] Curate best default (per-composition) view layouts `enhancement,reference-model`
- **#779** [Layout curation] Capture show_graph / show_pytorch layouts as seed variants `enhancement,reference-model`
- …and 46 more

### Unsorted — 44 open

- **#1139** Edit hand-written models in place, without conversion
- **#356** Semantic labels for vector dimensions — make [0.27, 0.00] readable
- **#345** [State] Dirty / unsaved-changes tracking + indicator `enhancement`
- **#344** [UI] Responsive file-path chip (replace inline full-path display) `enhancement`
- **#323** Link papers / writeups to their demo & example models `enhancement`
- **#320** Granular show/hide toggles for names (structures, node elements, and arrow labels) `enhancement`
- **#318** Node ovals render with non-uniform border thickness (appears thicker top/bottom) when unselected `bug`
- **#314** Port-to-port projection drag generates invalid mechanism subscript, breaks the model `bug`
- **#311** Dragging a projection from the palette doesn't create a connection (routes to add-node)
- **#302** Error toast: × button pushed off-screen by long unbroken text (file paths in error messages) `auto-build`
- **#300** Parameter update fails: 'Could not find parameter intercept' on word_input (Linear function)
- **#267** Breakpoint rule schema — design before Phase 2 implementation
- **#250** Phase 1 — Pluggable breakpoint hook in PsyNeuLink (replaces inert assert 'DEBUGGING BREAK POINT' markers) (sub-issue of #247)
- **#194** Code-to-object highlighting — select code and highlight the associated graphical object `enhancement`
- …and 30 more

### Edges & routing — 25 open

- **#967** Edge-rendering regression tests exist but most don't run — measure and re-gate the quarantine
- **#966** Layout rules & constraint compliance (umbrella): forced waypoints, adjustability, hard vs soft constraints `design`
- **#964** Lane-bow bend handle can't be deleted (auto cosmetic corner, re-created on remove) `bug`
- **#961** Unify the visual/interaction language for points on an edge (attachments, user waypoints, auto corners) `design`
- **#956** Layout padding & spacing settings (umbrella): node↔node, node↔edge, edge↔edge `design`
- **#955** Attachment-dot spacing: minimum buffer vs. density / count `design`
- **#954** Parameter (yellow) diamonds aren't draggable/hoverable like connection dots `design`
- **#950** Scheduler (before) edges cross over projection edges `design`
- **#949** Connection dots can be hidden under parameter (yellow) diamonds `design`
- **#943** Dev/debug overlay: visualize & toggle edge-routing internals from the UI `design`
- **#942** Auto layout routes long (formerly peripheral) edges through the center `design`
- **#940** Obstacle detours render as multi-segment kinked polylines, not one smooth curve `design`
- **#938** Edge overlap on shared-endpoint hubs: bundle fan-outs/fan-ins (lever 2) `discussion,design`
- **#936** Obstacle-routed edges render as angular polylines, not smooth splines
- …and 11 more

### Reference models — 24 open

- **#1128** [Survey] stroop_reference_with_lc `survey`
- **#1126** [Survey] Nieuwenhuis2005Model `survey`
- **#1125** [Survey] MontagueDayanSejnowski96 `survey`
- **#1123** [Survey] GilzenratModel `survey`
- **#1122** [Survey] Giallanza2024_ego_study2 `survey`
- **#886** Tutorial + coverage parity for ALL bundled reference models + monitor added/dropped models
- **#835** [Reference models] Surface model lineage — link the exact PsyNeuLink source file + commit being run `enhancement,reference-model`
- **#832** [Reference models] Bundled set: load/run status board + regression-coverage audit `testing,reference-model`
- **#830** [Open menu] Mark the currently-loaded reference model in the Open dropdown `enhancement`
- **#829** [Reference models] Coverage matrix + load-regression gate + surface examples in the Open menu `enhancement,testing,reference-model`
- **#791** [Reference model · EGO] Reconcile our Giallanza2024_ego_study2 with the now-official upstream library model `enhancement,reference-model`
- **#777** [Reference models] Drift-tracking for vendored upstream examples `testing,reference-model`
- **#773** [Nested GRU] Tutorial/explainer: how the views differ `documentation,reference-model`
- **#769** [Umbrella · Reference model · Nested GRU] Add & support a nested GRU model `enhancement,reference-model`
- …and 10 more

### Testing — 22 open

- **#1025** [Testing] e2e can't touch anything that writes ~/.psynewview.json — no config-path override `enhancement,testing`
- **#1017** [Process] Documentation coverage — undocumented surfaces (the omission class) `documentation`
- **#969** Grow frontend test coverage of the graph view — invariants now, pixels later `enhancement,testing`
- **#826** [Process] Periodic docs-freshness review (starting with docs/testing.md) `documentation,process`
- **#728** [#168 follow-up] Fix & re-gate the excluded e2e specs `testing`
- **#716** [Docs] Document our test suites & CI — what runs, what it validates, how to maintain `documentation,testing`
- **#709** [Process] Track what CI catches — ledger file + ci-caught label `testing`
- **#321** Fully test Giallanza2024_ego_study2.py as a validated example model `enhancement,testing`
- **#274** Phase 3 — Load Model "Developer / Tests" UI: pick a pytest test, extract, open (sub-issue of #249)
- **#258** Load Model: fetch testing files from a (public/private) GitHub repo
- **#254** Phase 2 — AST-based test extractor: emit standalone .py from test_simple_execution_without_learning (sub-issue of #249)
- **#249** Load PsyNeuLink pytest tests as developer-mode models (umbrella)
- **#220** Equivalence harness: normalize source declaration order in canonical form (sub-issue of #215) `enhancement,testing`
- **#215** Equivalence test: UI-constructed models vs library-constructed models (outputs + standardized code) `testing`
- …and 8 more

### Docs & tutorials — 21 open

- **#994** TODO.md should stop carrying per-issue closure status — it duplicates GitHub and rots silently
- **#862** [Process] Checkpoint tagging on devel — known-good rollback points (convention) `documentation,process`
- **#760** Ongoing maintenance: keep the vocabulary current + guard against link rot `documentation,enhancement`
- **#759** Rollout: apply inline term-linking across the 12 tutorials `documentation,enhancement`
- **#758** Link styling: color/treatment convention per link class `documentation,enhancement`
- **#757** Linking mechanism: how terms get auto-linked (manual vs automated) `documentation,enhancement`
- **#756** Vocabulary: PsyNeuView terms → in-repo object-reference docs `documentation,enhancement`
- **#755** Vocabulary: PsyNeuLink terms → canonical Sphinx URLs `documentation,enhancement`
- **#751** docs(tutorials): provide copy-ready text snippets for editing steps `documentation,enhancement`
- **#749** docs: link source-file references to their GitHub locations `documentation,enhancement`
- **#689** [Tutorial] Training a learning model `documentation`
- **#687** [Tutorial] Saving & exporting a model `documentation`
- **#671** [Tutorial] Incomplete / broken state handling `documentation`
- **#670** [Tutorial] Configuring which PsyNeuLink source/repo is used `documentation`
- …and 7 more

### Build & release — 16 open

- **#991** An Actions outage turns every required check into a skip, which branch protection accepts
- **#979** Re-evaluate the Python <3.14 cap — the wheel shortage it was based on is over
- **#976** Setup: preflight checks before installing, and a real Python version guard
- **#888** [Process] devel is gated + override-proof; devel-unsafe is the only bypass — branch-protection policy & safe-hardening workflow
- **#646** Daily backlog review & restructuring as a standing workflow `process`
- **#455** Branch dropdown Recent section disappears after install (filtered by leftover input value)
- **#264** Time each step of the install/branch-switch flow
- **#259** Python version compatibility: preflight checks + clear error UX
- **#257** GitHub auth: support private repos in install + branch lookup
- **#251** Settings install: dynamic branch lookup for the Branch / ref field — typeahead + dropdown, scoped to whichever Repo is selected
- **#248** Settings install: strip ref input, accept it without trailing slash, and offer a branch dropdown
- **#177** Add 'Text-based editing' to Core experience in release-features docs
- **#175** Release-features manual testing plan + library-models fixture set
- **#157** E2E: Settings panel — gear opens, info loads, install controls
- …and 2 more

### Open/save & formats — 15 open

- **#864** Model load latency & worker wedge: slow/hung load poisons the single serial worker; add end-to-end latency instrumentation + auto-recovery `bug,testing`
- **#851** [Load] Suppress the non-fatal module-level-driver notice for read-only raw library/example opens? `enhancement,discussion`
- **#845** [Open menu] Foldable sections + fix stale/muddy row hover coloring `enhancement`
- **#641** [Runnability] 5 upstream PsyNeuLink examples fail to load in PsyNeuView `testing,reference-model,auto-build`
- **#619** Dev launcher reuses a running Vite server after a dependency change, surfacing spurious "Failed to resolve import" overlays `bug`
- **#421** "Convert to Standard Format" silently destroys function-scoped models `bug`
- **#351** [Export] Fold Export into "Save a copy as…" `enhancement`
- **#350** [IA] Open menu structure: catalogs vs recents vs bookmarks `enhancement`
- **#348** [Bundles] .pnlproject round-trip + bundle spec `enhancement`
- **#347** [Open/Save] Native file picker via app bridge (replace text-prompt path entry) `enhancement`
- **#346** [Save] Correct Save-in-place vs Save-As semantics + overwrite `enhancement`
- **#301** Save As cannot overwrite an existing file — no way to update a saved model in place
- **#270** Orphan breakpoint detection on model load
- **#265** Time each stage of the model-load path
- …and 1 more

### Umbrellas — 14 open

- **#1158** [Umbrella] What happens to a layout when the model underneath it changes
- **#1058** [Umbrella] Multi-tenant cloud deployment — a third deployment mode `discussion,design`
- **#1027** [Umbrella] Two-headed workflow — PsyNeuView + PyCharm side by side `documentation,design`
- **#836** [Umbrella] Upstream PsyNeuLink examples: load+run coverage, status board, Open-menu section & lineage `enhancement,testing,reference-model`
- **#790** [Umbrella] PsyNeuLink upgrade handling & compatibility testing — bump smoothly, catch breakage early `enhancement,testing`
- **#778** [Umbrella] Curate best graph layouts across all reference models & views `enhancement,reference-model`
- **#761** [Umbrella] Execution modes: model, surface, and debug across Run / Learn / Step `enhancement`
- **#754** [Umbrella] Controlled vocabulary → inline term-linking across tutorials & docs `documentation,enhancement`
- **#733** [Umbrella] Documentation revisit & review across PsyNeuLink + PsyNeuView `documentation,enhancement`
- **#662** [Umbrella] User tutorials & onboarding: what to expect from PsyNeuView `documentation`
- **#656** [Umbrella] Flat view: inline all nested compositions into one canvas (general; PyTorch flatten as a specialization) `enhancement,reference-model`
- **#652** [Umbrella] Automated testing footprint & strategy `testing`
- **#377** [Umbrella] Scheduler as a first-class editable surface: mental model, editing UI, and execution visualization `enhancement`
- **#341** [Umbrella] File system & formats: a coherent open / save / bundle model `enhancement`

### Editor & inspector — 13 open

- **#1094** Click and drag inside the Python editor raises an error `bug`
- **#874** Surface model load time in the UI — live counter during load + persistent breakdown in the Model Diagnostics bar
- **#503** [Editor] Add a font-size selector for the code editor `enhancement`
- **#476** Code Editor: inserting a '+ Snippet' is not undoable `bug`
- **#473** Code Editor: '+ Snippet' dropdown opens rightward and gets clipped under the graph panel `bug`
- **#443** Function-scope diagnostic still reads as an error — demote to calm info notice `enhancement`
- **#431** Surface model-intrinsic element_names in the Inspector + add input-port resolver
- **#422** Introspector: synthesize GUI handles for function-scoped nodes `enhancement`
- **#334** Inspector function dropdown is scoped to the current function's family — wrong options for multi-family mechanisms (e.g. DDM)
- **#218** Inspector: parameter-port UI surface — visibility and editability scope (sub-issue of #198) `enhancement`
- **#217** Inspector: enum dropdowns for non-function enumerated parameters (sub-issue of #197) `enhancement`
- **#210** Inspector: port resize for output ports (sub-issue of #198)
- **#195** Edit component input shapes from the GUI inspector `enhancement`

### Two-headed / files — 12 open

- **#1134** The PsyNeuView anchor accumulates untracked files until it cannot update
- **#929** [Files] Surface file lineage in the UI — which sidecars are used and where they live (lateral vs. dot-folder) `discussion,design`
- **#926** [Files] Keep externally-edited sources in sync (PyCharm ↔ PsyNeuView) `enhancement,design`
- **#860** Backend hangs: blocking work in async endpoints stalls the event loop; add regression guards + load-latency budget
- **#793** [Process] Weekly watcher — re-check upstream #30 (EM PyTorch learn) + re-run EGO .learn() test `testing`
- **#534** [Learn L1] Walking skeleton: Learn mode + targets grid + synchronous /api/model/learn `enhancement`
- **#504** [Editor] Rethink editor file identity — "Code Editor" label vs the .py filename and its sidecar bundle `enhancement`
- **#478** [Bug] Labels YAML sidecar bypasses artifact_path() and dirties managed clones (#349 policy) `bug`
- **#349** [Hygiene] Sidecar & backup file placement policy `enhancement`
- **#342** [Design] File-handling mental model + formats reference (keystone) `documentation,enhancement`
- **#316** Branch switch in Settings fails when PsyNeuView has written sidecar/backup files into the managed source clone
- **#268** Breakpoint persistence — sidecar format and lifecycle

### Undo & history — 12 open

- **#1156** Keep a short history of the versions that built, not just the last one
- **#559** [Undo P5] Queue introspection UI (global + per-panel; placement TBD) `enhancement`
- **#558** [Undo P4] Effectively unlimited undo depth (raise/remove maxHistory cap) `enhancement`
- **#557** [Undo P3] Settings: per-category global-queue membership `enhancement`
- **#556** [Undo P2] Tagged command log + per-panel ↩ undo + global/per-panel selection (snapshot→command migration) `enhancement`
- **#555** [Undo P1] Run-panel input/trial edits join the global Cmd-Z queue (retire standalone toast) `enhancement`
- **#518** [Run] Input-editor ✕ deletes the whole trial (all nodes) and isn't undoable — clarify scope & wire into History `bug,enhancement`
- **#44** Replace 'Revert to Original' with version-history-aware actions
- **#43** Version history UI: timeline, diff view, and restore
- **#42** Define version history granularity: auto-save vs explicit checkpoints
- **#41** Design version history storage format
- **#38** Version history for user models

### Hosting & deployment — 8 open

- **#1110** [CI] Container jobs exhaust the runner's disk — provisioning or a leak?
- **#1076** Princeton OIT VM request — hosting PsyNeuView for a small group `discussion,design`
- **#1074** One container per user on a single VM — the per-user provisioning pattern `enhancement,design`
- **#1064** [CI] Standing gate — container work must not regress the Mac app path `testing,process`
- **#931** [CI] Playwright browser-install step hangs on apt → 30-min job timeout (flakes e2e/tutorials) `testing`
- **#895** Host a private PsyNeuView instance for zero-install access (lab demo)
- **#740** [Docs] (Tentative) Deploy the MkDocs site to GitHub Pages `documentation,enhancement`
- **#260** Onboarding & deployment workflow: clearer paths for users vs developers

### Settings & app shell — 7 open

- **#915** [UX] General pending/in-progress feedback for slow operations (elapsed counter + 'display is stale' cue) `enhancement,discussion`
- **#853** Open-menu catalog headers: show each catalog's exact source path on hover
- **#457** Settings panel: don't pre-populate 'devel' in Branch/ref input — keep it blank with placeholder hint
- **#452** Settings 'Branch / ref' shows wrong branch after switch (clone_manager uses reset --hard, not checkout -B)
- **#338** Condense the graph display toolbar into grouped menus
- **#181** Drag-to-create components from the components menu `enhancement`
- **#118** Cross-platform settings strategy: surface and source-of-truth (umbrella) `enhancement`

### Parameter fitting — 6 open

- **#541** [Fit F4] Fit viz: objective curve + parameter trajectories `enhancement`
- **#540** [Fit F3] Run-sets: per-evaluation records, sortable results table, apply-best-fit `enhancement`
- **#539** [Fit F2] PEC wiring: objective + optimizer method, running as a job `enhancement`
- **#538** [Fit F1] Free-parameter spec: Inspector 'free' toggle + bounds, persisted as <model>.fit.yaml sidecar `enhancement`
- **#512** Training & parameter-fitting runs: learn weights / fit parameters against recorded data (umbrella)
- **#328** [Strategy] Compile parsed models to fast backends (PyTorch / LLVM / Rust / C++) for parameter fitting at scale `enhancement`

### MDF — 5 open

- **#159** E2E: MDF round-trip — import → export → compare
- **#158** E2E: File operations — save, save-as, export MDF / YAML, project bundle
- **#89** Track MDF / modeci_mdf / PsyNeuLink version pinning and document compatibility policy `documentation,mdf`
- **#87** MDF gap: stateful / time_derivative parameter execution semantics — detect, test `bug,mdf`
- **#84** MDF gap: 2D-variable MatrixTransform corrupts on import — detect, warn, test `bug,mdf`

### Design & discussion — 4 open

- **#959** Smooth-step: drag whole horizontal/vertical segments, not just corners `design`
- **#785** [Meta] Design & discussion agenda — prioritized conversation points
- **#776** [Discussion/Design] Model constructor methods vs. execution methods — how PsyNeuView represents & supports both `discussion,design`
- **#361** Design: element_names + propagation rules for PsyNeuLink port values

### Graph editing — 2 open

- **#909** [Graph editing] Multi-select & group operations (box-select, move/delete as group, group/ungroup) `enhancement,discussion`
- **#151** E2E: Graph canvas — drag, multi-select, delete, zoom, pan, layout modes
