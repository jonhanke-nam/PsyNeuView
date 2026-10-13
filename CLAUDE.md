# PsyNeuView

FastAPI backend + React frontend. Trunk is `devel`; `main` is dormant (app
releases only).

Workspace layout, session-open behaviour and the standing workflow rules live
one level up in `../CLAUDE.md` and in auto-memory. Not repeated here.

## Conventions — read before editing in these areas

| Area | Doc |
|---|---|
| **Interactive UI elements (hover/affordance)** | [`docs/ui-interaction-conventions.md`](docs/ui-interaction-conventions.md) |
| **Colours and buttons (the palette, the five button kinds, the Close rule)** | [`docs/ui-style-conventions.md`](docs/ui-style-conventions.md) — colours are tokens from `frontend/src/styles/palette.css`, buttons are `Button` kinds; `styleConventions.test.ts` and `style-report.mjs --check` (CI) fail on any hand-written colour outside the listed exceptions |
| Icons and their meanings | [`docs/icon-ontology.md`](docs/icon-ontology.md) |
| File naming, sidecars, model working copies | [`docs/file-conventions.md`](docs/file-conventions.md) |
| Python style | [`docs/python-code-conventions-peps.md`](docs/python-code-conventions-peps.md) |
| Test layout and what CI runs | [`docs/testing.md`](docs/testing.md) |
| Guided walkthroughs (`frontend/src/walkthroughs/`) | [`docs/guided-walkthroughs.md`](docs/guided-walkthroughs.md) |
| **Settings, Mac app bridges, native vs React UI** | [`docs/settings-and-mac-app.md`](docs/settings-and-mac-app.md) — one control per setting, listed in `docs/settings-inventory.yaml` |
| **Dialogs, panels and pop-up menus (how they close)** | [`docs/dialog-inventory.md`](docs/dialog-inventory.md) — every overlay uses `useDismiss` + `DialogHeader` and is listed there; a guard test fails otherwise |

### The one with a silent failure mode

Adding anything clickable to the frontend? Read
[`docs/ui-interaction-conventions.md`](docs/ui-interaction-conventions.md)
first.

`index.css` carries a global `button:hover`, so every real `<button>` gets hover
feedback for free — and **nothing else does**. A `<div onClick>` will look
correct in review, work correctly when clicked, and silently offer no hover
affordance at all. An audit under #984 found the app almost entirely compliant
*by accident*, because it mostly uses `<button>`.

Short version: prefer `<button>`; if a press at X does something, hovering X
must say so; and for repeated elements use a CSS class rather than
`onMouseEnter` state (#845).

## Python

Requires 3.12, 3.13, or 3.14 — `backend/pyproject.toml` is the source of truth
(`requires-python = ">=3.12,<3.15"`). `make` checks the version before building
the venv and names a usable interpreter if the one you gave it is out of range.
