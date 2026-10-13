# `models/` — PsyNeuView model storage

This folder serves two related purposes:

1. **Runtime model-discovery directory.** PsyNeuView scans this folder
   (recursively) for `.py` files at runtime and surfaces them in the
   Load Model dropdown. User-loaded models saved via Save As land here
   too. These files are *not* tracked in git.
2. **Home of the repo-tracked custom/experimental model set under
   `models/custom/`.** See below.

## What lives here

- `custom/` — custom and experimental PsyNeuLink models that ship with
  the repository. Not subject to upstream PsyNeuLink approval. See
  `custom/README.md`.

Models under `custom/` are picked up by the runtime scanner just like
ad-hoc user models, and appear in the Load Model dropdown under a
**custom** folder.

## What does *not* live here

For clarity when navigating the broader code base:

- **Test fixtures** for end-to-end tests live under
  `frontend/e2e/fixtures/`, not here (see #148).
- **Library models** shipped with PsyNeuLink itself
  (e.g. `Botvinick_conflict_monitoring_model`, `Cohen_Huston1994`)
  are auto-discovered from the installed PsyNeuLink package and surface
  under the **Library** section of the Load Model dropdown — they are
  not stored in this repository (see #175).
