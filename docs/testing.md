# Testing & CI

How PsyNeuView is tested — what suites exist, what each validates, what runs in
CI, and how to run them locally. Keep this current when a suite or workflow is
added or changed (call it out in the PR, like the [catches ledger](ci/catches.md)).

## Test suites

| Suite | Location | What it validates | How |
| --- | --- | --- | --- |
| **Backend pytest** | `backend/tests/` (~57 files, ~695 tests) | Backend behavior end-to-end: introspector, executor, MDF round-trips, file/sidecar handling, debugger snapshots, and **reference-model equivalence**; one source guard reaches into the frontend (`test_show_graph_palette.py`: the INPUT and OUTPUT role colours in `palette.css` are show_graph's, read from PsyNeuLink and resolved as Graphviz draws them, #190) | In-process Python assertions against PsyNeuLink |
| **Tutorials (e2e)** | `frontend/e2e/tutorials/*.tutorial.spec.ts` | The user-facing workflows in the [tutorials](tutorials/README.md) | Drives the real app in headless Chromium, asserts the workflow, and regenerates the doc screenshots |
| **Broader e2e** | `frontend/e2e/*.spec.ts` | App smoke + feature surfaces, incl. the **reference-model runnability gate** (`reference-models-runnable.spec.ts`): loads + runs *every* bundled reference model and fails on a white screen / uncaught error | Same Playwright engine as tutorials |
| **Typecheck** | `frontend` (`tsc -b`) | TypeScript type correctness | Compile-time; no runtime |
| **Frontend unit tests** | `frontend/src/**/*.test.ts` (vitest) | Pure logic (stores, utils, shortcuts), plus two source guards: the settings inventory (`settingsInventory.test.ts`, one control per setting) the dialog inventory (`dialogInventory.test.ts`, every overlay uses the shared `useDismiss`/`DialogHeader` and is listed in [dialog-inventory.md](dialog-inventory.md)) the CI e2e list (`ciSpecs.test.ts`: the specs tagged `@ci` are the files in `e2e/ci-specs.txt`) and the style conventions (`styleConventions.test.ts`: no file writes a colour by hand, bar the listed exceptions, and buttons keep to the `Button` kinds, per [ui-style-conventions.md](ui-style-conventions.md); the same workflow runs `node scripts/style-report.mjs --check`) | Node; no browser. The dialogs' behaviour in a browser is `e2e/dialog-sweep.spec.ts`; their computed styles, `e2e/style-conventions.spec.ts`; the heights of the swept areas' buttons and rows against their pre-sweep sizes, `e2e/style-sizes.spec.ts` |

### Reference-model equivalence (the "does PsyNeuView match PsyNeuLink?" check)

A subset of the backend suite asserts that **PsyNeuView's executor produces the
same output as stock PsyNeuLink** for our reference models —
`test_stroop_basic_reference_equivalence.py`, `test_stroop_lc_reference_equivalence.py`
(`test_executor_matches_stock_baseline`: executor output `np.allclose` a direct
`Composition.run`), and `test_ego_reference_equivalence.py` (EGO validated as a
standalone script, pending the executor learning path). These are unified into
one parametrized matrix in `test_reference_equivalence_matrix.py` (#653) —
every model under `backend/reference_models/` has a row (a guard test fails when
one is added without), each run from the same PsyNeuLink seed on both sides so
stochastic models (GilzenratModel) compare exactly; MontagueDayanSejnowski96,
which exists to learn, is also trained both ways (the Learn path vs
`Composition.learn`). EGO's execute-path row is skipped until the executor
learning gap (#363) closes. EGO's `.learn()` tests are
currently `xfail`, blocked on the upstream **PsyNeuLink#30** bug (standalone
repro in `upstream_repros/psyneulink-30-em-pytorch-learn/`; watcher #793).

### Executable tutorials

Each tutorial is **both a doc and a test**: the Playwright spec drives the live
app through the documented steps, asserts the behavior (e.g. a "Results (N
trials)" panel appears; editing a node's gain updates the code to `gain=2.5`; a
dangling projection renders a phantom node; training reaches "Training
complete"), and writes the screenshots the Markdown embeds. So the docs can't
silently drift from the app. See [tutorials/README.md](tutorials/README.md).

## CI workflows

Under `.github/workflows/`. All run on `ubuntu-latest` and install PsyNeuLink
from a pinned git ref (PsyNeuLink pulls `torch`, so a disk-cleanup step reclaims
runner space first).

All four run on **every PR to `devel`** (and `devel` pushes), gated by a cheap
`changes` job so only the relevant expensive job actually runs (see
[Path filtering](#path-filtering-and-required-checks)). They also run on
`devel-unsafe`.

### The `feature/tutorials` cheap tier

Tutorial work lands on the `feature/tutorials` integration branch (#1180), and
PRs into it get a **deliberately reduced** set of checks:

| Runs on a tutorial slice | Cost | Runs once, at the PR into `devel` | Cost |
| --- | --- | --- | --- |
| `typecheck (tsc)` | ~30s | `tutorials` | ~14 min |
| `unit tests (vitest)` | ~25s | `e2e` | ~30 min (3 shards in parallel) |
| `mkdocs build (strict)` (path-triggered) | ~20s | `backend pytest` ×2 | ~26–29 min each |
| `Docs drift guard` (on push) | ~7s | | |
| `tutorials`, **only when** walkthrough YAML, tour-named source, `frontend/e2e/`, or `tutorials.yml` changed | ~14 min | | |

The reasoning: **the tutorials suite takes ~2.4 min locally and ~14 min in CI**,
and the difference is almost entirely the PsyNeuLink install. A slice author who
runs it locally has already seen the result CI would report, so paying for it on
every slice buys little. The exception is a slice that changes the walkthroughs
themselves: the tutorials suite runs on those, because until it did, the
walkthrough specs had never run in CI at all. The full suite still gates the merge into `devel`, against
everything the branch accumulated. Actions spend here is capped with stop-usage
on (#991), so this is a real constraint rather than tidiness.

**If you are writing a tutorial slice, run the suite locally before opening the
PR** — CI runs it only for walkthrough changes:

```bash
cd frontend && npx playwright test e2e/tutorials
```

| Workflow | Runs | Runs when the diff touches | PsyNeuLink ref |
| --- | --- | --- | --- |
| `tutorials.yml` | Tutorial e2e suite | `frontend/**` or `backend/**` | 0.19 sync `b0a750db14` |
| `backend-tests.yml` | `backend/tests` | `backend/**` | 0.19 sync `b0a750db14` |
| `typecheck.yml` | `tsc -b`, vitest, the style check (`style-report.mjs --check`) | `frontend/**` | — (no PsyNeuLink) |
| `e2e.yml` | Broader e2e (CI subset, `test:e2e:ci` = specs tagged `@ci`), in 3 parallel shards plus the `e2e` check ([below](#e2e-shards)) | `frontend/**` | 0.19 sync `b0a750db14` |
| `container-image.yml` | Builds the deployment image, runs it, converts it to Apptainer | `backend/**`, `frontend/**`, `Dockerfile` | 0.19 sync `b0a750db14` (as `ARG` in the Dockerfile) |

**The pinned ref** (`b0a750db14`, `PSYNEULINK_GIT_REF` in each workflow) is the
2026‑07‑29 sync onto the PsyNeuLink 0.19 line, matching the version the app is
vendored against (#803/#804). Keeping CI and the app on the same PsyNeuLink
avoids the "tests pass against a different version than ships" drift (#790). When
the app's pin moves, bump `PSYNEULINK_GIT_REF` in every installing workflow in
lockstep — including the `ARG PSYNEULINK_GIT_REF` in the `Dockerfile`, which
`container-image.yml` cross-checks against `backend-tests.yml` and fails on
drift. An image built from a ref CI never tested makes "the tests passed"
meaningless for the thing that actually ships.

**The lock** (#247). `backend/uv.lock` holds every Python package at an exact
version. CI builds from it with `uv sync --frozen --no-install-package
psyneulink`, then installs PsyNeuLink from `PSYNEULINK_GIT_REF` on top, the
same way the Mac app installs a user's chosen PsyNeuLink over the lock. The
lock's own PsyNeuLink is the PyPI release, used by a fresh `make install`.
PsyNeuLink's source is deliberately *not* pinned in `pyproject.toml`
(`[tool.uv.sources]`): `uv pip install -e backend/` obeys such a pin, and
would replace the PsyNeuLink every existing Mac app and Settings switch chose.
`backend-tests.yml` fails if the lock is stale (`uv lock --check`). To update
the packages, run `uv lock --upgrade` in `backend/` and let CI test the result.

**The standard-tools job** (`backend-tests-pip.yml`, #259). Every other backend
job builds from the lock with uv. This one installs the usual way (`python -m
venv` + `pip install -e "backend/[dev]"`) at the newest versions pyproject
allows, runs the suite, and keeps `pip freeze` as an artifact. It also checks
that `make install` takes the pip route with no uv, a broken uv, or
`USE_UV=0`. It runs nightly, on PRs that change how the backend is installed,
and on demand, and isn't a required check: an upstream release can break it
with no change here, and that is for fixing, not for blocking unrelated PRs.

**The code scan** (`code-scan.yml`, script `scripts/code_scan.py`, #243). Checks
across PsyNeuView and the Mac app for patterns no single PR shows: two files
whose names differ only in capitals, pip where uv belongs, a `[tool.uv.sources]`
pin of PsyNeuLink, the product's old name, platform checks on
`navigator.platform`, `shell=True`, and TODOs with no issue. The report goes in
the run's summary (and locally to `.planning/code-scan/`). It runs on every
`devel` merge, on demand, and on PRs that change the scanner; it fails, and
comments on #243, only on a new high-severity finding, one no open `code-scan`
issue names by its `scan:<id>`. Not a required check. Its own tests are
`backend/tests/test_code_scan.py`. New checks come from bugs that turn out to
be patterns; add them there and on #243.

**Path filters** keep doc-only or unrelated PRs from spending CI minutes.

**Playwright browser install** (`e2e.yml`, `tutorials.yml`; #931). The install
used to hang on a stalled apt mirror and burn the whole job timeout. It now runs
as two separate steps, each with its own `timeout-minutes`, a per-attempt
`timeout`, and a plain shell retry loop: system deps
(`npx playwright install-deps chromium`, 5 min per attempt, 2 attempts, with apt
network timeouts so a stall errors out) and the browser download
(`npx playwright install chromium`, 2 min per attempt, 3 attempts). The browsers
in `~/.cache/ms-playwright` are cached under `playwright-<OS>-<Playwright
version>`; a hit skips only the download, never the apt deps. The cache is saved
right after the download rather than at job end, so a job that later fails or is
cancelled still fills it.

### The e2e shards {#e2e-shards}

`e2e.yml` (#295) runs the `@ci` specs as **3 shards on 3 runners at once**,
because one runner had grown to about an hour of tests and was hitting its
75-minute limit. Each shard (`e2e shard 1/3`, `2/3`, `3/3`) installs everything,
builds the frontend and starts its own servers, exactly as the single job did,
then runs `playwright test --grep "@ci\b" --shard=N/3`. Playwright hands each
shard a run of whole spec files in name order, a third of the tests each
(`workers: 1`, `fullyParallel: false`, so files never split). One failing
shard doesn't stop the others.

- **One check.** A last job named **`e2e`** passes only if all three shards
  passed (or if the `changes` job skipped them all). It is the check `devel`'s
  branch protection requires, so the shard jobs need no protection entry, and
  adding a shard needs no admin change. It runs even when a shard fails or
  times out, so the check goes red instead of skipped.
- **One report.** Each shard uploads a Playwright *blob* report (results,
  traces, screenshots, videos; kept 1 day). The `e2e` job merges them with
  `npx playwright merge-reports` into the **`playwright-results-<run id>`**
  artifact: the HTML report plus `results.json`, kept 14 days after a failure
  and 3 after a pass. Open it with `npx playwright show-report <folder>`.
- **Balance.** Playwright splits by test count, not time. Measured against a
  full `@ci` run (2026-11-18: about 65 minutes of tests in all) and today's
  127 files, that gives about 21, 21 and 24 minutes of tests per shard, plus
  about 4 minutes of setup each. If one shard drifts well ahead, read per-file times out of the
  merged `results.json` (sum each file's test durations) before moving
  anything; a test-heavy file of short tests and a one-test file of long ones
  are what tip it.
- **Timeout.** 75 minutes per shard stays as a safety net.
- **Manual runs.** "Run workflow" (`gh workflow run e2e.yml --ref <branch> -f
  mode=ci`) runs the gate's `@ci` suite on any branch; `smoke` and `full` are
  sharded the same way.
- **Tutorials** (`tutorials.yml`) is still one job, about 31 to 39 minutes
  end to end; give it the same treatment if it nears its own limit.

**What CI caches** (#1368). The repo's Actions cache holds 10 GB, and GitHub
evicts the least recently used entries past that. Kept: the Playwright browsers
(~250 MB), npm (~70 MB), and pip for the docs build (small). Not kept: pip for
the jobs that install PsyNeuLink (`backend-tests.yml`, `tutorials.yml`,
`e2e.yml`). Those pull torch with its CUDA wheels, about 2.8 GB per cache, and
the key moved with every `pyproject.toml` version bump, so each PR saved
another copy; three filled the quota and evicted the browser cache, which was
then re-downloaded on about 40% of runs. Before adding a cache, check
`gh api repos/OWNER/PsyNeuView/actions/cache/usage` and keep the total well
under 10 GB.

## Running locally

```bash
# Tutorials — also regenerates docs/tutorials/assets/ screenshots
cd frontend && npm run tutorials:capture

# Backend environment, from backend/uv.lock (#247). A new one gets the lock's
# PsyNeuLink; an existing one keeps whichever PsyNeuLink you chose. uv is used
# only when `uv --version` works; it says which route it took (#259).
make install
# Without uv: venv + pip from backend/pyproject.toml, whatever is installed
make install USE_UV=0

# Backend suite (do NOT set PSYNEUVIEW_TEST_MODE globally — tests set their own
# mode; setting it breaks the "reset endpoint hidden in production" test).
# --no-sync: a plain `uv run` first re-syncs to the lock, which would put the
# locked PsyNeuLink back over one you chose.
cd backend && uv run --no-sync pytest tests -q

# Typecheck
cd frontend && npx tsc -b

# The CI e2e suite, as CI runs it, or just one of its three shards (#295):
cd frontend && npm run test:e2e:ci
cd frontend && npm run test:e2e:ci -- --shard=2/3
# See which spec files a shard would run, without running them:
cd frontend && npx playwright test --grep "@ci\b" --shard=2/3 --list
# Open a CI run's merged report (the playwright-results-<run id> artifact):
gh run download <run id> -n playwright-results-<run id> -D /tmp/pw-report
npx playwright show-report /tmp/pw-report
```

## Conventions & maintenance

- **Ship regression coverage with each fix/feature** — an e2e or pytest test that
  would catch the bug. Don't close a bug without one (or a note on why not).
- **User-facing changes must keep the tutorial specs green** and update the
  matching `docs/tutorials/*.md` in the same change.
- **To add a spec to the CI e2e run, tag it `@ci`** (and add its file to
  `frontend/e2e/ci-specs.txt`, sorted, one per line). `npm run test:e2e:ci`
  runs `playwright test --grep "@ci\b"`; tag the file's top-level
  `test.describe("…", { tag: "@ci" }, …)`, or each top-level test when there
  is no describe. A vitest (`ciSpecs.test.ts`) fails if the tagged files and
  the list differ, so a dropped tag can't take a spec out of CI unnoticed.
  Tutorial specs are never tagged `@ci` — they run in `tutorials.yml`.
- **Log what CI catches** — when a CI failure turns out to be a real bug, add a
  row to [ci/catches.md](ci/catches.md) in the fixing PR and apply the
  `ci-caught` label (`gh issue list --label ci-caught`).
- **Keep this doc current** when suites or workflows change.

## Current footprint

- ✅ Run & report on every PR to `devel`: **tutorials**, **backend pytest**
  (incl. the reference-model equivalence matrix + runnability gate),
  **typecheck**, and the curated **e2e** subset.
- 🔒 **Required to merge** (`devel` branch protection): **`tutorials`**,
  **`e2e`**, **`typecheck (tsc)`** — a red one blocks the merge button. Backend
  `pytest` runs and reports but is **not** yet required.
- ⏸️ e2e: the full / smoke sets stay manual (`workflow_dispatch`); four specs are
  excluded from the auto gate pending fixes (#728).

### Path filtering (and required checks) {#path-filtering-and-required-checks}

Each workflow triggers on *all* PRs to its gated branches — `devel`,
`devel-unsafe`, `feature/tutorials` — with no trigger-level path filter, and
a cheap `changes` job decides whether the expensive job runs. A skipped job
reports a **skipped** check, which counts as **passing** — so a docs-only PR
skips the installs yet still satisfies the required checks and merges freely.

The diff is taken from the **merge commit's first parent** — the base branch as
it stands now — not from `pull_request.base.sha`, which is the base as it was
when the PR was opened. Diffing from the latter also sweeps up everything the
base gained since, so an old branch runs gates it never touched (#989).

Branch protection on `devel` requires `tutorials` + `e2e` + `typecheck (tsc)`
(strict/up-to-date **off**, admins **not** enforced, no PR-review requirement).
To adjust the required set, edit `devel`'s protection
(`gh api repos/OWNER/PsyNeuView/branches/devel/protection`).

Tracked under the testing-footprint umbrella **#652**; tutorials umbrella **#662**.

## Keeping this doc current

This doc drifts silently when a suite or workflow changes without a matching
edit here. Three guards:

1. **Per-PR:** any PR that adds/changes a suite, workflow, required check, or the
   PsyNeuLink pin must update this doc in the same PR (call it out, like the
   [catches ledger](ci/catches.md)).
2. **Automated (every `devel` merge):** the `Docs drift guard` workflow
   (`.github/workflows/docs-drift-guard.yml`, script `scripts/docs_drift_check.py`)
   runs on every push to `devel` and to `feature/tutorials`, plus on demand.
   It checks that the PsyNeuLink pin and the gate-workflow list here match the
   actual workflows; on drift it opens/updates a tracking issue and fails the
   run. Run it locally with
   `python3 scripts/docs_drift_check.py`. (GitHub cron only fires from the
   default branch `main`, not the `devel` trunk, so it runs per-merge instead.)
3. **Periodic review:** a standing docs-freshness pass re-checks this doc against
   the actual workflows, `backend/tests/`, `frontend/e2e/`, and `devel`'s
   required checks (the parts the automated guard doesn't cover). Tracked as a
   recurring `process` task (#826, under #652).
