# Backlog survey — the book of work

**Surveyed 2026-09-17**, against `devel` and 1,530 commits of history.

> **A dated snapshot of the old tracker.** This survey was taken before the
> repo went public on 2026-10-13 with fresh issue numbers. Every issue it
> counts lives in
> [jonhanke-nam/PsyNeuView-archive](https://github.com/jonhanke-nam/PsyNeuView-archive),
> and each one is written here as a link, **archive#N**, so it can't land on
> an unrelated issue in this repo. The counts and lists are not kept up to
> date: GitHub is the source of truth, and [`TODO.md`](./TODO.md) holds the
> roadmap. Numbers inside the code blocks are archive numbers too. The method
> below still applies; to survey this repo, re-run the script.

This is not a roadmap. It is a measurement: what is actually open, grouped so
that "what's next" can be asked of one area at a time instead of one list of
four hundred. [`TODO.md`](./TODO.md) holds the roadmap; GitHub holds the truth;
this says what shape the truth is currently in.

## Why it was needed

The backlog had stopped meaning anything. Issues were being fixed and left
open, so the list described neither what was broken nor what was planned. The
cost was not tidiness — it was that **planning against it produced wrong
answers**. Repeatedly, work picked from the list turned out to be already built:

- **[archive#975](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/975)**, labelled `[Bug][Urgent]`, had been fixed in PR [archive#978](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/978) and left open.
- **[archive#1029](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1029)** was solved *better than it asked* — the app stopped writing the
  file at all rather than choosing when to autosave — and nobody closed it.
- Two of **[archive#961](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/961)**'s three asks had shipped; only the third remained.
- **[archive#1010](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1010)**, **[archive#1013](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1013)**, **[archive#1031](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1031)** and **[archive#964](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/964)** were each substantially built
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
version of this survey used it and attached [archive#1017](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1017)'s evidence to [archive#1008](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1008). Index
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

Spot-checked after the correction — [archive#914](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/914) (`edgeRouter.ts`), [archive#894](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/894)
(`runTimingStore.ts`), [archive#874](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/874) (`loadTimingStore.ts`), [archive#853](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/853), [archive#989](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/989) — all five had
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
*related* issue rather than the issue itself ([archive#279](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/279), [archive#160](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/160)).

## Re-running it

```bash
python3 scripts/backlog_survey.py          # summary
python3 scripts/backlog_survey.py --tsv    # every row, for grouping
```

The script reads this repo's issues by default; `--repo
jonhanke-nam/PsyNeuView-archive` points it at the old tracker. Commit
subjects from before 2026-10-13 name archive numbers, so on this repo treat
a match on an old commit with suspicion.

Run immediately after the closures above it reports **6 likely-shipped**
instead of 29 — which is the closures taking effect, and a useful check that
the script measures what this document claims.

Those six, plus one `shipped-then-documented`, are exactly the ones held back
on purpose:

| | why it was not closed |
| --- | --- |
| [archive#966](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/966), [archive#761](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/761) | umbrellas — a shipped child does not finish the parent |
| [archive#961](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/961), [archive#964](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/964) | had a PR in flight at the time |
| [archive#860](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/860), [archive#279](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/279), [archive#160](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/160) | evidence pointed at a *related* issue, not this one |

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
| **Execution & run** | 86 | [archive#4](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/4) | [archive#1078](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1078) | [archive#247](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/247) (6) |
| **Layout & canvas** | 60 | [archive#83](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/83) | [archive#1118](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1118) | [archive#395](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/395) (5) |
| **Unsorted** | 44 | [archive#9](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/9) | [archive#1139](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1139) | [archive#9](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/9) (7) |
| **Edges & routing** | 25 | [archive#281](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/281) | [archive#967](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/967) | [archive#938](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/938) (5) |
| **Reference models** | 24 | [archive#222](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/222) | [archive#1128](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1128) | [archive#1128](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1128) (2) |
| **Testing** | 22 | [archive#145](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/145) | [archive#1025](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1025) | [archive#321](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/321) (4) |
| **Docs & tutorials** | 21 | [archive#206](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/206) | [archive#994](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/994) | [archive#501](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/501) (1) |
| **Build & release** | 16 | [archive#11](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/11) | [archive#991](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/991) | [archive#251](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/251) (4) |
| **Open/save & formats** | 15 | [archive#253](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/253) | [archive#864](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/864) | [archive#864](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/864) (7) |
| **Umbrellas** | 14 | [archive#341](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/341) | [archive#1158](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1158) | [archive#1058](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1058) (5) |
| **Editor & inspector** | 13 | [archive#195](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/195) | [archive#1094](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1094) | [archive#1094](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1094) (5) |
| **Two-headed / files** | 12 | [archive#268](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/268) | [archive#1134](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1134) | [archive#504](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/504) (3) |
| **Undo & history** | 12 | [archive#38](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/38) | [archive#1156](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1156) | — |
| **Hosting & deployment** | 8 | [archive#260](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/260) | [archive#1110](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1110) | [archive#1074](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1074) (2) |
| **Settings & app shell** | 7 | [archive#118](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/118) | [archive#915](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/915) | [archive#457](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/457) (2) |
| **Parameter fitting** | 6 | [archive#328](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/328) | [archive#541](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/541) | [archive#512](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/512) (2) |
| **MDF** | 5 | [archive#84](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/84) | [archive#159](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/159) | — |
| **Design & discussion** | 4 | [archive#361](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/361) | [archive#959](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/959) | [archive#785](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/785) (8) |
| **Graph editing** | 2 | [archive#151](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/151) | [archive#909](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/909) | — |


### Execution & run — 86 open

- **[archive#1078](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1078)** Upgrade the Railway demo to Hobby on the lab's account — the trial expires and its fallback can't run the app `process`
- **[archive#1061](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1061)** PyTorch view: EGO has no STORE node and nothing is tagged excludeFromGradientCalc `bug`
- **[archive#997](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/997)** [Exec modes] Learn is PyTorch-only in practice — non-autodiff learning can't report loss
- **[archive#989](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/989)** CI path filters use a two-dot diff, so branches behind devel run gates they never touched
- **[archive#901](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/901)** Backend pytest: assert PsyNeuLink _debugger hook actually fires (regression guard) `testing`
- **[archive#897](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/897)** Onboarding docs: clarify the two 'devel' branches, private-repo access, and debugger-hook caveat `documentation`
- **[archive#896](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/896)** Sandbox model execution for hosted / multi-user PsyNeuView
- **[archive#894](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/894)** Show run time in the UI — live counter during a run + "ran in X.Xs" after (run-side counterpart to [archive#874](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/874))
- **[archive#892](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/892)** Load+run ALL PsyNeuLink library models via the native Run path (test + fix factory-only 'not found')
- **[archive#840](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/840)** 0.19 adds the LOSS node to the autodiff execution trace — update trace/snapshot synthesis
- **[archive#838](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/838)** [Examples] Load+run regression test over Scripts/Examples `testing,reference-model`
- **[archive#808](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/808)** Bug · executor: raw library models fail to Run — module-level driver's post-run read aborts the load `bug`
- **[archive#772](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/772)** [Nested GRU] Verify rendering across default / nested / PyTorch views `bug,reference-model`
- **[archive#771](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/771)** [Nested GRU] Runnability: load, run & baseline-match PsyNeuLink `testing,reference-model`
- …and 72 more

### Layout & canvas — 60 open

- **[archive#1118](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1118)** [Survey] What each bundled reference model needs from the canvas
- **[archive#1013](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1013)** [Layout] Role-aware layered layout — rank by role, not graph depth `enhancement`
- **[archive#1001](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1001)** [Exec modes] [archive#763](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/763)'s matrix says PyTorch is unsupported for a plain Composition — it isn't
- **[archive#999](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/999)** [Flake] live.tutorial.spec.ts — canvas node click times out intermittently in CI
- **[archive#908](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/908)** [Layout] Node-role legend + highlight/select nodes by role, and move a role-group together `enhancement`
- **[archive#907](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/907)** [Layout] Complete session undo/redo coverage for layout changes (Flip X/Y, Reset Custom Layout, re-layout) `enhancement`
- **[archive#902](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/902)** [Design] Layout system: auto-assembly + manual persistence — architecture, decisions, resolution model `documentation,enhancement,discussion`
- **[archive#810](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/810)** Flaky e2e: flat-view tutorial ('Flatten inlines a nested composition') intermittently times out
- **[archive#784](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/784)** Side-by-side toggle: React graph vs PsyNeuLink show_graph `enhancement`
- **[archive#783](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/783)** [Layout curation] Quality-bar review pass + curation standards `enhancement,reference-model`
- **[archive#782](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/782)** [Layout curation] Curate best PyTorch view layouts `enhancement,reference-model`
- **[archive#781](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/781)** [Layout curation] Curate best nested / inlined view layouts `enhancement,reference-model`
- **[archive#780](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/780)** [Layout curation] Curate best default (per-composition) view layouts `enhancement,reference-model`
- **[archive#779](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/779)** [Layout curation] Capture show_graph / show_pytorch layouts as seed variants `enhancement,reference-model`
- …and 46 more

### Unsorted — 44 open

- **[archive#1139](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1139)** Edit hand-written models in place, without conversion
- **[archive#356](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/356)** Semantic labels for vector dimensions — make [0.27, 0.00] readable
- **[archive#345](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/345)** [State] Dirty / unsaved-changes tracking + indicator `enhancement`
- **[archive#344](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/344)** [UI] Responsive file-path chip (replace inline full-path display) `enhancement`
- **[archive#323](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/323)** Link papers / writeups to their demo & example models `enhancement`
- **[archive#320](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/320)** Granular show/hide toggles for names (structures, node elements, and arrow labels) `enhancement`
- **[archive#318](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/318)** Node ovals render with non-uniform border thickness (appears thicker top/bottom) when unselected `bug`
- **[archive#314](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/314)** Port-to-port projection drag generates invalid mechanism subscript, breaks the model `bug`
- **[archive#311](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/311)** Dragging a projection from the palette doesn't create a connection (routes to add-node)
- **[archive#302](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/302)** Error toast: × button pushed off-screen by long unbroken text (file paths in error messages) `auto-build`
- **[archive#300](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/300)** Parameter update fails: 'Could not find parameter intercept' on word_input (Linear function)
- **[archive#267](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/267)** Breakpoint rule schema — design before Phase 2 implementation
- **[archive#250](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/250)** Phase 1 — Pluggable breakpoint hook in PsyNeuLink (replaces inert assert 'DEBUGGING BREAK POINT' markers) (sub-issue of [archive#247](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/247))
- **[archive#194](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/194)** Code-to-object highlighting — select code and highlight the associated graphical object `enhancement`
- …and 30 more

### Edges & routing — 25 open

- **[archive#967](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/967)** Edge-rendering regression tests exist but most don't run — measure and re-gate the quarantine
- **[archive#966](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/966)** Layout rules & constraint compliance (umbrella): forced waypoints, adjustability, hard vs soft constraints `design`
- **[archive#964](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/964)** Lane-bow bend handle can't be deleted (auto cosmetic corner, re-created on remove) `bug`
- **[archive#961](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/961)** Unify the visual/interaction language for points on an edge (attachments, user waypoints, auto corners) `design`
- **[archive#956](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/956)** Layout padding & spacing settings (umbrella): node↔node, node↔edge, edge↔edge `design`
- **[archive#955](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/955)** Attachment-dot spacing: minimum buffer vs. density / count `design`
- **[archive#954](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/954)** Parameter (yellow) diamonds aren't draggable/hoverable like connection dots `design`
- **[archive#950](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/950)** Scheduler (before) edges cross over projection edges `design`
- **[archive#949](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/949)** Connection dots can be hidden under parameter (yellow) diamonds `design`
- **[archive#943](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/943)** Dev/debug overlay: visualize & toggle edge-routing internals from the UI `design`
- **[archive#942](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/942)** Auto layout routes long (formerly peripheral) edges through the center `design`
- **[archive#940](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/940)** Obstacle detours render as multi-segment kinked polylines, not one smooth curve `design`
- **[archive#938](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/938)** Edge overlap on shared-endpoint hubs: bundle fan-outs/fan-ins (lever 2) `discussion,design`
- **[archive#936](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/936)** Obstacle-routed edges render as angular polylines, not smooth splines
- …and 11 more

### Reference models — 24 open

- **[archive#1128](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1128)** [Survey] stroop_reference_with_lc `survey`
- **[archive#1126](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1126)** [Survey] Nieuwenhuis2005Model `survey`
- **[archive#1125](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1125)** [Survey] MontagueDayanSejnowski96 `survey`
- **[archive#1123](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1123)** [Survey] GilzenratModel `survey`
- **[archive#1122](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1122)** [Survey] Giallanza2024_ego_study2 `survey`
- **[archive#886](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/886)** Tutorial + coverage parity for ALL bundled reference models + monitor added/dropped models
- **[archive#835](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/835)** [Reference models] Surface model lineage — link the exact PsyNeuLink source file + commit being run `enhancement,reference-model`
- **[archive#832](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/832)** [Reference models] Bundled set: load/run status board + regression-coverage audit `testing,reference-model`
- **[archive#830](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/830)** [Open menu] Mark the currently-loaded reference model in the Open dropdown `enhancement`
- **[archive#829](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/829)** [Reference models] Coverage matrix + load-regression gate + surface examples in the Open menu `enhancement,testing,reference-model`
- **[archive#791](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/791)** [Reference model · EGO] Reconcile our Giallanza2024_ego_study2 with the now-official upstream library model `enhancement,reference-model`
- **[archive#777](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/777)** [Reference models] Drift-tracking for vendored upstream examples `testing,reference-model`
- **[archive#773](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/773)** [Nested GRU] Tutorial/explainer: how the views differ `documentation,reference-model`
- **[archive#769](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/769)** [Umbrella · Reference model · Nested GRU] Add & support a nested GRU model `enhancement,reference-model`
- …and 10 more

### Testing — 22 open

- **[archive#1025](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1025)** [Testing] e2e can't touch anything that writes ~/.psyneuview.json — no config-path override `enhancement,testing`
- **[archive#1017](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1017)** [Process] Documentation coverage — undocumented surfaces (the omission class) `documentation`
- **[archive#969](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/969)** Grow frontend test coverage of the graph view — invariants now, pixels later `enhancement,testing`
- **[archive#826](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/826)** [Process] Periodic docs-freshness review (starting with docs/testing.md) `documentation,process`
- **[archive#728](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/728)** [#168 follow-up] Fix & re-gate the excluded e2e specs `testing`
- **[archive#716](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/716)** [Docs] Document our test suites & CI — what runs, what it validates, how to maintain `documentation,testing`
- **[archive#709](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/709)** [Process] Track what CI catches — ledger file + ci-caught label `testing`
- **[archive#321](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/321)** Fully test Giallanza2024_ego_study2.py as a validated example model `enhancement,testing`
- **[archive#274](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/274)** Phase 3 — Load Model "Developer / Tests" UI: pick a pytest test, extract, open (sub-issue of [archive#249](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/249))
- **[archive#258](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/258)** Load Model: fetch testing files from a (public/private) GitHub repo
- **[archive#254](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/254)** Phase 2 — AST-based test extractor: emit standalone .py from test_simple_execution_without_learning (sub-issue of [archive#249](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/249))
- **[archive#249](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/249)** Load PsyNeuLink pytest tests as developer-mode models (umbrella)
- **[archive#220](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/220)** Equivalence harness: normalize source declaration order in canonical form (sub-issue of [archive#215](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/215)) `enhancement,testing`
- **[archive#215](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/215)** Equivalence test: UI-constructed models vs library-constructed models (outputs + standardized code) `testing`
- …and 8 more

### Docs & tutorials — 21 open

- **[archive#994](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/994)** TODO.md should stop carrying per-issue closure status — it duplicates GitHub and rots silently
- **[archive#862](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/862)** [Process] Checkpoint tagging on devel — known-good rollback points (convention) `documentation,process`
- **[archive#760](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/760)** Ongoing maintenance: keep the vocabulary current + guard against link rot `documentation,enhancement`
- **[archive#759](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/759)** Rollout: apply inline term-linking across the 12 tutorials `documentation,enhancement`
- **[archive#758](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/758)** Link styling: color/treatment convention per link class `documentation,enhancement`
- **[archive#757](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/757)** Linking mechanism: how terms get auto-linked (manual vs automated) `documentation,enhancement`
- **[archive#756](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/756)** Vocabulary: PsyNeuView terms → in-repo object-reference docs `documentation,enhancement`
- **[archive#755](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/755)** Vocabulary: PsyNeuLink terms → canonical Sphinx URLs `documentation,enhancement`
- **[archive#751](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/751)** docs(tutorials): provide copy-ready text snippets for editing steps `documentation,enhancement`
- **[archive#749](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/749)** docs: link source-file references to their GitHub locations `documentation,enhancement`
- **[archive#689](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/689)** [Tutorial] Training a learning model `documentation`
- **[archive#687](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/687)** [Tutorial] Saving & exporting a model `documentation`
- **[archive#671](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/671)** [Tutorial] Incomplete / broken state handling `documentation`
- **[archive#670](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/670)** [Tutorial] Configuring which PsyNeuLink source/repo is used `documentation`
- …and 7 more

### Build & release — 16 open

- **[archive#991](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/991)** An Actions outage turns every required check into a skip, which branch protection accepts
- **[archive#979](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/979)** Re-evaluate the Python <3.14 cap — the wheel shortage it was based on is over
- **[archive#976](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/976)** Setup: preflight checks before installing, and a real Python version guard
- **[archive#888](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/888)** [Process] devel is gated + override-proof; devel-unsafe is the only bypass — branch-protection policy & safe-hardening workflow
- **[archive#646](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/646)** Daily backlog review & restructuring as a standing workflow `process`
- **[archive#455](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/455)** Branch dropdown Recent section disappears after install (filtered by leftover input value)
- **[archive#264](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/264)** Time each step of the install/branch-switch flow
- **[archive#259](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/259)** Python version compatibility: preflight checks + clear error UX
- **[archive#257](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/257)** GitHub auth: support private repos in install + branch lookup
- **[archive#251](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/251)** Settings install: dynamic branch lookup for the Branch / ref field — typeahead + dropdown, scoped to whichever Repo is selected
- **[archive#248](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/248)** Settings install: strip ref input, accept it without trailing slash, and offer a branch dropdown
- **[archive#177](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/177)** Add 'Text-based editing' to Core experience in release-features docs
- **[archive#175](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/175)** Release-features manual testing plan + library-models fixture set
- **[archive#157](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/157)** E2E: Settings panel — gear opens, info loads, install controls
- …and 2 more

### Open/save & formats — 15 open

- **[archive#864](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/864)** Model load latency & worker wedge: slow/hung load poisons the single serial worker; add end-to-end latency instrumentation + auto-recovery `bug,testing`
- **[archive#851](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/851)** [Load] Suppress the non-fatal module-level-driver notice for read-only raw library/example opens? `enhancement,discussion`
- **[archive#845](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/845)** [Open menu] Foldable sections + fix stale/muddy row hover coloring `enhancement`
- **[archive#641](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/641)** [Runnability] 5 upstream PsyNeuLink examples fail to load in PsyNeuView `testing,reference-model,auto-build`
- **[archive#619](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/619)** Dev launcher reuses a running Vite server after a dependency change, surfacing spurious "Failed to resolve import" overlays `bug`
- **[archive#421](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/421)** "Convert to Standard Format" silently destroys function-scoped models `bug`
- **[archive#351](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/351)** [Export] Fold Export into "Save a copy as…" `enhancement`
- **[archive#350](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/350)** [IA] Open menu structure: catalogs vs recents vs bookmarks `enhancement`
- **[archive#348](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/348)** [Bundles] .pnlproject round-trip + bundle spec `enhancement`
- **[archive#347](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/347)** [Open/Save] Native file picker via app bridge (replace text-prompt path entry) `enhancement`
- **[archive#346](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/346)** [Save] Correct Save-in-place vs Save-As semantics + overwrite `enhancement`
- **[archive#301](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/301)** Save As cannot overwrite an existing file — no way to update a saved model in place
- **[archive#270](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/270)** Orphan breakpoint detection on model load
- **[archive#265](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/265)** Time each stage of the model-load path
- …and 1 more

### Umbrellas — 14 open

- **[archive#1158](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1158)** [Umbrella] What happens to a layout when the model underneath it changes
- **[archive#1058](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1058)** [Umbrella] Multi-tenant cloud deployment — a third deployment mode `discussion,design`
- **[archive#1027](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1027)** [Umbrella] Two-headed workflow — PsyNeuView + PyCharm side by side `documentation,design`
- **[archive#836](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/836)** [Umbrella] Upstream PsyNeuLink examples: load+run coverage, status board, Open-menu section & lineage `enhancement,testing,reference-model`
- **[archive#790](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/790)** [Umbrella] PsyNeuLink upgrade handling & compatibility testing — bump smoothly, catch breakage early `enhancement,testing`
- **[archive#778](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/778)** [Umbrella] Curate best graph layouts across all reference models & views `enhancement,reference-model`
- **[archive#761](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/761)** [Umbrella] Execution modes: model, surface, and debug across Run / Learn / Step `enhancement`
- **[archive#754](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/754)** [Umbrella] Controlled vocabulary → inline term-linking across tutorials & docs `documentation,enhancement`
- **[archive#733](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/733)** [Umbrella] Documentation revisit & review across PsyNeuLink + PsyNeuView `documentation,enhancement`
- **[archive#662](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/662)** [Umbrella] User tutorials & onboarding: what to expect from PsyNeuView `documentation`
- **[archive#656](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/656)** [Umbrella] Flat view: inline all nested compositions into one canvas (general; PyTorch flatten as a specialization) `enhancement,reference-model`
- **[archive#652](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/652)** [Umbrella] Automated testing footprint & strategy `testing`
- **[archive#377](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/377)** [Umbrella] Scheduler as a first-class editable surface: mental model, editing UI, and execution visualization `enhancement`
- **[archive#341](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/341)** [Umbrella] File system & formats: a coherent open / save / bundle model `enhancement`

### Editor & inspector — 13 open

- **[archive#1094](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1094)** Click and drag inside the Python editor raises an error `bug`
- **[archive#874](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/874)** Surface model load time in the UI — live counter during load + persistent breakdown in the Model Diagnostics bar
- **[archive#503](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/503)** [Editor] Add a font-size selector for the code editor `enhancement`
- **[archive#476](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/476)** Code Editor: inserting a '+ Snippet' is not undoable `bug`
- **[archive#473](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/473)** Code Editor: '+ Snippet' dropdown opens rightward and gets clipped under the graph panel `bug`
- **[archive#443](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/443)** Function-scope diagnostic still reads as an error — demote to calm info notice `enhancement`
- **[archive#431](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/431)** Surface model-intrinsic element_names in the Inspector + add input-port resolver
- **[archive#422](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/422)** Introspector: synthesize GUI handles for function-scoped nodes `enhancement`
- **[archive#334](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/334)** Inspector function dropdown is scoped to the current function's family — wrong options for multi-family mechanisms (e.g. DDM)
- **[archive#218](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/218)** Inspector: parameter-port UI surface — visibility and editability scope (sub-issue of [archive#198](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/198)) `enhancement`
- **[archive#217](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/217)** Inspector: enum dropdowns for non-function enumerated parameters (sub-issue of [archive#197](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/197)) `enhancement`
- **[archive#210](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/210)** Inspector: port resize for output ports (sub-issue of [archive#198](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/198))
- **[archive#195](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/195)** Edit component input shapes from the GUI inspector `enhancement`

### Two-headed / files — 12 open

- **[archive#1134](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1134)** The PsyNeuView anchor accumulates untracked files until it cannot update
- **[archive#929](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/929)** [Files] Surface file lineage in the UI — which sidecars are used and where they live (lateral vs. dot-folder) `discussion,design`
- **[archive#926](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/926)** [Files] Keep externally-edited sources in sync (PyCharm ↔ PsyNeuView) `enhancement,design`
- **[archive#860](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/860)** Backend hangs: blocking work in async endpoints stalls the event loop; add regression guards + load-latency budget
- **[archive#793](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/793)** [Process] Weekly watcher — re-check upstream [archive#30](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/30) (EM PyTorch learn) + re-run EGO .learn() test `testing`
- **[archive#534](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/534)** [Learn L1] Walking skeleton: Learn mode + targets grid + synchronous /api/model/learn `enhancement`
- **[archive#504](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/504)** [Editor] Rethink editor file identity — "Code Editor" label vs the .py filename and its sidecar bundle `enhancement`
- **[archive#478](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/478)** [Bug] Labels YAML sidecar bypasses artifact_path() and dirties managed clones ([archive#349](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/349) policy) `bug`
- **[archive#349](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/349)** [Hygiene] Sidecar & backup file placement policy `enhancement`
- **[archive#342](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/342)** [Design] File-handling mental model + formats reference (keystone) `documentation,enhancement`
- **[archive#316](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/316)** Branch switch in Settings fails when PsyNeuView has written sidecar/backup files into the managed source clone
- **[archive#268](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/268)** Breakpoint persistence — sidecar format and lifecycle

### Undo & history — 12 open

- **[archive#1156](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1156)** Keep a short history of the versions that built, not just the last one
- **[archive#559](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/559)** [Undo P5] Queue introspection UI (global + per-panel; placement TBD) `enhancement`
- **[archive#558](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/558)** [Undo P4] Effectively unlimited undo depth (raise/remove maxHistory cap) `enhancement`
- **[archive#557](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/557)** [Undo P3] Settings: per-category global-queue membership `enhancement`
- **[archive#556](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/556)** [Undo P2] Tagged command log + per-panel ↩ undo + global/per-panel selection (snapshot→command migration) `enhancement`
- **[archive#555](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/555)** [Undo P1] Run-panel input/trial edits join the global Cmd-Z queue (retire standalone toast) `enhancement`
- **[archive#518](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/518)** [Run] Input-editor ✕ deletes the whole trial (all nodes) and isn't undoable — clarify scope & wire into History `bug,enhancement`
- **[archive#44](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/44)** Replace 'Revert to Original' with version-history-aware actions
- **[archive#43](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/43)** Version history UI: timeline, diff view, and restore
- **[archive#42](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/42)** Define version history granularity: auto-save vs explicit checkpoints
- **[archive#41](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/41)** Design version history storage format
- **[archive#38](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/38)** Version history for user models

### Hosting & deployment — 8 open

- **[archive#1110](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1110)** [CI] Container jobs exhaust the runner's disk — provisioning or a leak?
- **[archive#1076](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1076)** Princeton OIT VM request — hosting PsyNeuView for a small group `discussion,design`
- **[archive#1074](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1074)** One container per user on a single VM — the per-user provisioning pattern `enhancement,design`
- **[archive#1064](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/1064)** [CI] Standing gate — container work must not regress the Mac app path `testing,process`
- **[archive#931](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/931)** [CI] Playwright browser-install step hangs on apt → 30-min job timeout (flakes e2e/tutorials) `testing`
- **[archive#895](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/895)** Host a private PsyNeuView instance for zero-install access (lab demo)
- **[archive#740](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/740)** [Docs] (Tentative) Deploy the MkDocs site to GitHub Pages `documentation,enhancement`
- **[archive#260](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/260)** Onboarding & deployment workflow: clearer paths for users vs developers

### Settings & app shell — 7 open

- **[archive#915](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/915)** [UX] General pending/in-progress feedback for slow operations (elapsed counter + 'display is stale' cue) `enhancement,discussion`
- **[archive#853](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/853)** Open-menu catalog headers: show each catalog's exact source path on hover
- **[archive#457](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/457)** Settings panel: don't pre-populate 'devel' in Branch/ref input — keep it blank with placeholder hint
- **[archive#452](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/452)** Settings 'Branch / ref' shows wrong branch after switch (clone_manager uses reset --hard, not checkout -B)
- **[archive#338](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/338)** Condense the graph display toolbar into grouped menus
- **[archive#181](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/181)** Drag-to-create components from the components menu `enhancement`
- **[archive#118](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/118)** Cross-platform settings strategy: surface and source-of-truth (umbrella) `enhancement`

### Parameter fitting — 6 open

- **[archive#541](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/541)** [Fit F4] Fit viz: objective curve + parameter trajectories `enhancement`
- **[archive#540](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/540)** [Fit F3] Run-sets: per-evaluation records, sortable results table, apply-best-fit `enhancement`
- **[archive#539](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/539)** [Fit F2] PEC wiring: objective + optimizer method, running as a job `enhancement`
- **[archive#538](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/538)** [Fit F1] Free-parameter spec: Inspector 'free' toggle + bounds, persisted as <model>.fit.yaml sidecar `enhancement`
- **[archive#512](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/512)** Training & parameter-fitting runs: learn weights / fit parameters against recorded data (umbrella)
- **[archive#328](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/328)** [Strategy] Compile parsed models to fast backends (PyTorch / LLVM / Rust / C++) for parameter fitting at scale `enhancement`

### MDF — 5 open

- **[archive#159](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/159)** E2E: MDF round-trip — import → export → compare
- **[archive#158](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/158)** E2E: File operations — save, save-as, export MDF / YAML, project bundle
- **[archive#89](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/89)** Track MDF / modeci_mdf / PsyNeuLink version pinning and document compatibility policy `documentation,mdf`
- **[archive#87](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/87)** MDF gap: stateful / time_derivative parameter execution semantics — detect, test `bug,mdf`
- **[archive#84](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/84)** MDF gap: 2D-variable MatrixTransform corrupts on import — detect, warn, test `bug,mdf`

### Design & discussion — 4 open

- **[archive#959](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/959)** Smooth-step: drag whole horizontal/vertical segments, not just corners `design`
- **[archive#785](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/785)** [Meta] Design & discussion agenda — prioritized conversation points
- **[archive#776](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/776)** [Discussion/Design] Model constructor methods vs. execution methods — how PsyNeuView represents & supports both `discussion,design`
- **[archive#361](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/361)** Design: element_names + propagation rules for PsyNeuLink port values

### Graph editing — 2 open

- **[archive#909](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/909)** [Graph editing] Multi-select & group operations (box-select, move/delete as group, group/ungroup) `enhancement,discussion`
- **[archive#151](https://github.com/jonhanke-nam/PsyNeuView-archive/issues/151)** E2E: Graph canvas — drag, multi-select, delete, zoom, pan, layout modes
