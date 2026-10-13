# PsyNeuView tutorials

Walkthrough-style tutorials for using PsyNeuView, organized by workflow. Each
tutorial walks the workflow end-to-end across our reference models and states
**what you can expect** from a working build.

These are **executable tutorials**: the screenshots are captured from the live
app by a Playwright spec under `frontend/e2e/tutorials/`, and the same spec
asserts the documented behavior. So the docs can't silently drift from the app —
if a workflow breaks, its spec fails. (This is the documentation half of the
automated-testing footprint, #652/#653.)

## Regenerating screenshots

```bash
cd frontend
npm run tutorials:capture
```

Reuses a running backend + frontend (ports 8000 / 5173) if present; otherwise
starts them.

## Tutorials

| # | Workflow | Tracking |
| --- | --- | --- |
| 01 | [Loading a model](01-loading-a-model.md) | #663 |
| 02 | [Running a model](02-running-a-model.md) | #664 |
| 03 | [Building a model](03-building-a-model.md) | #665 |
| 04 | [Stepping with the debugger](04-debugger-stepping.md) | #666 |
| 05 | [Editing via the inspector](05-editing-inspector.md) | #667 |
| 06 | [Editing via the code editor](06-editing-code.md) | #668 |
| 07 | [Live editing (edit + re-run)](07-live-editing.md) | #669 |
| 08 | [Configuring the PsyNeuLink source](08-configuring-psyneulink-source.md) | #670 |
| 09 | [Incomplete / broken state handling](09-incomplete-state.md) | #671 |
| 10 | [Saving & exporting a model](10-saving-exporting.md) | #687 |
| 11 | [Viewing options & the flat view](11-viewing-options.md) | #688 |
| 12 | [Training a learning model](12-training-a-model.md) | #689 |
| 13 | [The sync check](13-sync-check.md) | #1035 |
| 14 | [Starting a model (two-editor)](14-starting-a-model.md) | #1036 |
| 15 | [The two-editor workflow](15-two-headed-workflow.md) | #1034 |
| 16 | [Guided walkthroughs: the Cognitive Neuroscience Course](16-course-walkthroughs.md) | #1180 |

## Reference models

- **EGO** — Giallanza et al. 2024, Study 2 (#395)
- **Stroop — Basic** (#396)
- **Stroop — with LC** (#399)

## Further reading

These tutorials cover using PsyNeuView. For the modeling library it visualizes —
the concepts, classes, and full API — see the
[PsyNeuLink documentation](https://princetonuniversity.github.io/PsyNeuLink/).
Each tutorial also deep-links the relevant PsyNeuLink page (Composition, Mechanism,
Scheduler, AutodiffComposition, …) at the bottom of its page.
