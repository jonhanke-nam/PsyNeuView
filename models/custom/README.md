# `models/custom/` — custom and experimental PsyNeuLink models

A low-friction home for PsyNeuLink models that are useful inside
PsyNeuView but that are *not* part of the upstream PsyNeuLink approved
devel model set.

Models added here are committed to the repository and are
**automatically discovered at runtime** by PsyNeuView's Load Model
scanner — they appear under a **custom** folder in the Load Model
dropdown alongside any ad-hoc user models in `../`.

## What belongs here

- Experimental models that exercise GUI rendering or workflow edges the
  upstream-approved models don't cover.
- Intentionally-broken examples used to test incomplete-state rendering
  (see #185, #186).
- Edge-case models contributors want to keep alongside the curated set
  without negotiating an upstream PR.
- Models that don't currently run end-to-end but are still useful for
  rendering or design discussions.

## What does *not* belong here

- Models destined for the upstream PsyNeuLink approved set — file those
  as PsyNeuLink PRs instead.
- End-to-end test fixtures — those live in `frontend/e2e/fixtures/`
  (see #148).
- Library models that come from the installed PsyNeuLink package — see
  the **Library** section of PsyNeuView's Load Model dropdown (see #175).

## Per-model notes

Each model added here should carry a brief README or in-file comment
noting:

- **Purpose** — e.g. *"exercises dangling-projection rendering"*,
  *"demonstrates EM composition expansion"*, *"intentionally broken — used
  to test the format-issue banner"*.
- **Status** — runnable end-to-end, render-only, intentionally broken,
  etc.
- **Origin** — who contributed it, when, and the testing scenario it came
  from if relevant.

## How to add a model

1. Drop your `<model_name>.py` into this folder.
2. Add a sibling `<model_name>.md` (or a header docstring) covering the
   per-model notes above.
3. Open a PR against `devel`; no upstream PsyNeuLink approval is needed
   for changes under this folder.

## Related issues

- #148 — canonical fixture models for tests (curated, deterministic;
  lives in `frontend/e2e/fixtures/`).
- #175 — library-models fixture set for release testing (lives in the
  installed PsyNeuLink package).
- #185 / #186 — incomplete-state rendering umbrella and dangling-
  projection sub-issue; this folder is a natural home for inputs to that
  work.
