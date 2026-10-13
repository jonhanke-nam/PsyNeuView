# MDF Versioning and Compatibility

PsyNeuView's MDF (ModECI Model Description Format) support is layered on
top of three independent moving targets. This doc records the propagation
path, the currently-tested versions, the known-lossy areas to expect on
import/export, and the checkpoint we run when any upstream version moves.

## Propagation path

```
MDF spec (modeci.org)
        │
        ▼
modeci_mdf  (Python package — ModECI/MDF on GitHub)
        │   PsyNeuLink pin:  modeci_mdf>=0.4.3, <0.4.14
        ▼
PsyNeuLink  (mdf.py — import/export bridge to the library)
        │
        ▼
PsyNeuView  (backend/app/services/file_types.py + mdf_metadata.py
            — delegates to modeci_mdf for validation/parsing)
```

PsyNeuView never speaks MDF directly — every import/export goes through
`modeci_mdf` first and then through PsyNeuLink's MDF bridge. That means:

- A change in the MDF spec only affects us once `modeci_mdf` releases a
  package update for it.
- A change in `modeci_mdf` only affects us once PsyNeuLink either bumps
  its pin or actively re-tests against the new version.
- Our user-visible behavior follows whatever PsyNeuLink decides — we do
  not unilaterally upgrade past its pin range.

## Current versions (as of 2026-05-23)

| Layer          | Version                                             | Source                                                                                                         |
|----------------|-----------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| MDF spec       | `0.4`                                               | `MODECI_MDF_VERSION` in `modeci_mdf/__init__.py`                                                               |
| `modeci_mdf`   | `>=0.4.3, <0.4.14` (PsyNeuLink pin)                 | [`PsyNeuLink/requirements.txt`](https://github.com/jonhanke-nam/PsyNeuLink/blob/jonhanke-dev/requirements.txt#L10)                                          |
| `modeci_mdf`   | `0.4.14` (currently installed in `backend/.venv`)   | `backend/.venv/lib/python3.13/site-packages/modeci_mdf-0.4.14.dist-info`                                       |
| PsyNeuLink     | Settings ▸ About (one line); Developer ▸ PsyNeuLink details | the backend's install ([Settings and the Mac app](settings-and-mac-app.md))                                                             |
| PsyNeuView     | this repo, `devel` branch                           | —                                                                                                              |

### ⚠️ Drift flagged: 2026-05-23

The currently-installed `modeci_mdf` is `0.4.14`, which is **outside**
PsyNeuLink's pin range (`<0.4.14`). This means the venv is running a
version that PsyNeuLink has not officially validated against. Two paths
forward when this happens:

1. **Re-pin the venv down**: install `modeci_mdf<0.4.14` to stay inside
   PsyNeuLink's window. Closer to upstream's officially-tested state.
2. **Push upstream**: ask PsyNeuLink to bump the pin ceiling. The right
   call when `0.4.14` is healthy and the lower ceiling is just stale.

Either way, run the audit checklist below before any release.

## Known-lossy areas

These are tracked separately and surface as preflight warnings (planned)
on MDF import/export. They are sensitive to `modeci_mdf` version
changes — every audit should re-verify each:

| Area                                          | Issue | Status                        |
|-----------------------------------------------|-------|-------------------------------|
| Nested Compositions                           | #82   | Open — gap, needs detection   |
| Conjoint Compositions (shared components)     | #83   | Open — gap, needs detection   |
| 2D-variable MatrixTransform on import         | #84   | Open — bug, needs detection   |
| Scheduler Conditions lossy on round-trip      | #85   | Open — bug, needs detection   |
| Stateful / `time_derivative` parameter exec   | #87   | Open — gap, needs test        |
| Inline projections dropped by `convert_to_standard_format` | #101 | Open — bug, MDF-imported source |

The harness that re-runs these on demand is **#88** (still open) — once
it lands, a "version-bump audit" mode there should be the single command
this doc points to.

## Checkpoint process

Run the audit when any of these three things happens:

1. **`modeci_mdf` publishes a new minor version** (e.g. `0.4.15`).
   - Check if PsyNeuLink has bumped its pin — if not, defer until they
     do, *or* open a PsyNeuLink issue suggesting they validate.
   - Once we adopt a new version, re-run all gap fixtures (#82–#85, #87,
     #101). Any change in behavior — even an improvement — gets logged
     in the audit log and surfaced in PsyNeuView release notes.

2. **PsyNeuLink bumps its pin range.**
   - Update the table above.
   - Re-run all gap fixtures against the new range's lower and upper
     bounds. Behavior should be stable across the range; if not, narrow
     our supported range and flag it as a constraint.

3. **MDF spec releases a new version** (e.g. `0.5`).
   - Read the spec changelog. Identify any new constructs that PsyNeuLink
     models could surface (e.g. new condition types).
   - Wait for `modeci_mdf` to track the new spec, then for PsyNeuLink to
     repin, then proceed as in (2).

### Who decides

- **Test expectations change** (the gap fixtures produce different output
  on a bump): the maintainer running the audit decides — record the
  rationale in the audit log alongside the version change.
- **User-facing release notes**: any behavior-changing bump deserves a
  one-line note in the next PsyNeuView release. Improvements as well as
  regressions — users who rely on the lossy areas care equally.

### Audit log

Record each audit run with date, `modeci_mdf` version pre/post, summary
of gap-fixture outcomes, and any decisions. Tabular form, append-only,
in this file under a new `## Audit history` section once #88 lands.

## Refs

- Issue: #89 (this doc)
- Action issues: #79 (MDF import — closed), #81 (MDF export — closed)
- Gap issues sensitive to version: #82, #83, #84, #85, #87, #101
- Harness: #88 (planned — consumes the audit checklist above)
- MDF spec: https://mdf.readthedocs.io/en/latest/api/Specification.html
- `modeci_mdf`: https://github.com/ModECI/MDF
- PsyNeuLink pin: [`PsyNeuLink/requirements.txt`](https://github.com/jonhanke-nam/PsyNeuLink/blob/jonhanke-dev/requirements.txt#L10)
