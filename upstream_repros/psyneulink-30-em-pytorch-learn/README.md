# PsyNeuLink#30 — EM / nested-composition PyTorch `.learn()` crash

A self-contained, **native-PsyNeuLink** reproduction of
[jonhanke-nam/PsyNeuLink#30](https://github.com/jonhanke-nam/PsyNeuLink/issues/30).
Nothing here imports PsyNeuView; it runs with only `psyneulink` (+ `torch`)
installed and is written so `test_pnl30.py` could drop straight into
PsyNeuLink's own `tests/composition/`.

## The bug

Calling `.learn()` in **PyTorch execution mode** on an affected composition
raises:

```
AttributeError: 'list' object has no attribute 'owner'
  psyneulink/library/compositions/pytorchwrappers.py:2163, in __init__
    sample_mech = loss_mech.sample.owner
```

It constructs fine and only fails when the PyTorch representation is built for
`.learn()`.

## Root cause

The failure is commonly seen through `EMComposition` (the EGO models), but **EM
is not the cause**. The general trigger is:

> a **nested composition** + an outer `LossMechanism` whose **SAMPLE input port
> has more than one afferent**, trained in PyTorch mode.

When the loss node's SAMPLE port receives from more than one sender,
`loss_mech.sample` returns a **list** of source mechanisms (PsyNeuLink even warns
at construction: *"has more than one 'SAMPLE'; therefore, its `sample` Parameter
returns a list"*). `pytorchwrappers.py:2163` then dereferences `.owner` on that
list — assuming a single Port — and raises.

In the EGO models this happens because, after
`infer_backpropagation_learning_pathways()` mints the loss with `SAMPLE ←
PREDICTION`, a second projection is added into the same SAMPLE port (e.g.
`STATE → loss`), so `loss_mech.sample == [PREDICTION, STATE]`.

## What's here

| File | Role |
|------|------|
| `repro_minimal.py` | **Minimal, EM-free** trigger — a nested `AutodiffComposition` + a two-afferent loss SAMPLE, ~2 nodes. Isolates the bug to the general case. |
| `repro_bundled.py` | **Real EMComposition path** — loads the Giallanza 2024 EGO model and `.learn()`s it. Same crash, reached via `emcomposition/pytorchEMwrappers.py` (the path the upstream `EGO CSW Model.py` hits). |
| `test_pnl30.py` | Pytest sentinels: 2 passing (construction + exact-signature pin) + 2 `strict` xfails that flip loudly the day #30 is fixed. |
| `test_giallanza_ego_upstream.py` | **PsyNeuLink's own EGO test**, vendored verbatim (see provenance below). **Passes here (2 passed)** — see "Why the upstream test passes". |
| `conftest.py` | Test isolation mirroring PsyNeuLink's conftest (clears name registries + seeds), so the whole folder runs order-independently. |
| `pytest.ini` | Pins this folder as its own pytest rootdir and registers the vendored test's `model`/`pytorch` markers. |
| `models/Giallanza2024_ego_study2.py` | Verbatim copy of the reference model (pure PsyNeuLink; no PsyNeuView imports). |

**Provenance:** `test_giallanza_ego_upstream.py` is a verbatim copy of
`tests/models/test_giallanza_ego.py` from `PrincetonUniversity/PsyNeuLink`
devel @ `83cc4165b7` — permalink:
<https://github.com/PrincetonUniversity/PsyNeuLink/blob/83cc4165b70ae0395b3fc113cbb46749ce9aded2/tests/models/test_giallanza_ego.py>.
The only changes from upstream are a provenance banner at the top of the file
and the `_upstream` filename suffix; the test body is unmodified. To refresh it
against a newer PsyNeuLink, re-copy that file and update the commit above.

## Why the upstream test passes but the model still crashes

PsyNeuLink's own `test_giallanza_ego_upstream.py` **passes** — yet EGO doesn't
run. Not a contradiction: the two build the learning pathway differently.

| | How the loss/target is wired | Result |
|---|---|---|
| **Upstream test** | `targets=(prediction_layer, state_input_layer)` on `AutodiffComposition(...)` | ✅ passes |
| **The runnable model** (`EGO CSW Model.py`, our bundled reference model, `repro_bundled.py`) | `infer_backpropagation_learning_pathways()` + a manual `add_projection(receiver=loss_sample_mech)` | ❌ crashes at #30 |

The manual projection gives the loss SAMPLE a **second afferent** →
`loss_mech.sample` becomes a list → `pytorchwrappers.py:2163`. The `targets=`
form never adds it, so the upstream test never trips the bug. **So "the upstream
EGO test passes" does not mean the EGO model runs.**

## Running it

```bash
# 1. the scripts (print BUG PRESENT / FIXED)
python repro_minimal.py
python repro_bundled.py

# 2. our #30 sentinels — expected today: "2 passed, 2 xfailed"
pytest test_pnl30.py -q

# 3. PsyNeuLink's own EGO test (vendored) — expected: "2 passed"
pytest test_giallanza_ego_upstream.py -q

# 4. the whole folder at once — expected: "4 passed, 2 xfailed"
pytest -q
```

> **Running inside a PsyNeuLink checkout?** Its `pyproject.toml` sets
> `required_plugins` (pytest-benchmark, -cov, -helpers-namespace, -pycodestyle,
> -ruff, -xdist). Either install them (`pip install "psyneulink[dev]"`) or
> bypass the gate for a quick run: `pytest test_pnl30.py -q -o addopts="" -o required_plugins=""`.

### From a fresh clone (fully isolated)

Nothing but `psyneulink` (+ `torch`) is needed — no PsyNeuView setup. This is the
path for someone reproducing from scratch (e.g. a PsyNeuLink developer):

```bash
# 1. Clone this repo (private → use gh, or SSH). Shallow is fine.
#    NOTE: this folder lives on `devel`; the repo default branch is `main`, so
#    clone `devel` explicitly or the folder won't be there.
gh repo clone jonhanke-nam/PsyNeuView /tmp/pnl30-check -- --depth 1 --branch devel
cd /tmp/pnl30-check/upstream_repros/psyneulink-30-em-pytorch-learn

# 2. Isolated venv with the deps (torch + pytest; pytest only for test_pnl30.py)
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip

#    Pin the exact PsyNeuLink that reproduces #30 (the 0.19 sync):
./.venv/bin/pip install torch pytest \
  "psyneulink @ git+https://github.com/PrincetonUniversity/PsyNeuLink.git@b0a750db14f0e18f13f4af6d4228e5824a7f2797"
#    …or just `./.venv/bin/pip install psyneulink torch pytest` for the latest
#    release (may or may not still carry the bug).

# 3. Run
./.venv/bin/python repro_minimal.py       # -> BUG PRESENT (PsyNeuLink#30)
./.venv/bin/python repro_bundled.py       # -> BUG PRESENT (via EMComposition)
./.venv/bin/python -m pytest test_pnl30.py -q   # -> 2 passed, 2 xfailed
```

To check whether upstream has **fixed** it, install from the latest `devel`
instead (`...@devel`) and re-run: the strict xfails XPASS (failures) when it's
fixed.

## Expected outcomes

- **Bug present (today):** scripts print `BUG PRESENT (PsyNeuLink#30)`; pytest is
  `2 passed, 2 xfailed`.
- **Fixed upstream:** scripts print `FIXED`; the strict xfails XPASS (reported as
  failures) and `test_minimal_error_signature` fails — the signal to remove the
  xfails, un-block EGO, and re-verify/close PsyNeuView#578.

## Reproduced on

- `PrincetonUniversity/PsyNeuLink` devel — `0.19.1.0+10.g83cc4165b7`
- synced `jonhanke-dev` — `b0a750d`

Zero delta in `pytorchwrappers.py` between the fork and stock devel, so this is
stock upstream behavior.

## Related

- Upstream bug: **jonhanke-nam/PsyNeuLink#30**
- EGO runnability (blocked): **PsyNeuView#578**
- Upstream-fix watcher: **PsyNeuView#793**
- Upgrade/compat umbrella: **PsyNeuView#790**
