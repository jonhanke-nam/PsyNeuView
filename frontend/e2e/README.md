# PsyNeuView E2E tests (Playwright)

Browser-driven smoke + behavior tests for the PsyNeuView UI. Foundation issues: #146 (setup), #147 (deterministic harness), #148 (canonical fixtures), #149 (CI scaffolding). Umbrella: #145.

## Run modes

Two modes — **production** is the default, **dev** is for tight iteration.

| Script | Mode | What runs | When to use |
| --- | --- | --- | --- |
| `npm run test:e2e` | production | `npm run build` then backend on a free port serving `frontend/dist/` | default; matches what ships |
| `npm run test:e2e:smoke` | production | same, but only `@smoke`-tagged tests | PR gating, fast feedback |
| `npm run test:e2e:ci` | production | same, but only `@ci`-tagged tests (listed by file in `e2e/ci-specs.txt`) | what the `e2e` check runs on PRs |
| `npm run test:e2e:headed` | production | same, with a visible browser window | watching what the test does |
| `npm run test:e2e:ui` | production | Playwright's interactive UI runner | debugging a single test |
| `npm run test:e2e:dev` | dev | backend on `:8000` + Vite on `:5173` (HMR); tests hit `:5173` | iterating on UI + tests at the same time |

In production mode Playwright's `webServer` config auto-starts/stops the backend per run on a port picked dynamically at config-load time. In dev mode it auto-starts both the backend (uvicorn) and the Vite dev server on the conventional ports.

Override the production port with `PW_PROD_PORT=8765 npm run test:e2e` if you need it pinned (e.g. an external probe attached to a fixed port).

## Prerequisites

Run once after cloning or after deps change:

```bash
cd frontend
npm install
npx playwright install chromium
```

The backend venv at `backend/.venv/` must already be set up (`make install` from the repo root).

## Selector strategy

- **Roles + accessible names first**: `page.getByRole('button', { name: 'Settings' })`. Survives style changes, encourages a11y.
- **`data-testid` only where roles aren't natural**: the canvas viewport, palette items (drag-and-drop targets), and the React Flow node bodies. Don't add `data-testid` to anything that already has a stable role + name.

Existing testids today:
- `app-toolbar` — top toolbar root
- `palette-sidebar` — palette root
- `graph-canvas` — graph canvas wrapper (toolbar + palette + viewport)
- `graph-canvas-viewport` — the inner React Flow surface (drop target)

## Test fixtures — `readOnlyTest` vs `mutatingTest`

Specs pick a fixture at the import site rather than relying on a global `beforeEach`. The choice declares whether the test mutates backend state — which is what determines whether we pay the warm-worker restart cost.

```ts
// Fast path — no per-test reset. Use for tests that only read state.
import { readOnlyTest as test, expect } from "./test-base";

// Slow path — POSTs /api/test/reset before each test, clearing the
// working dir and restarting the warm worker (~1.7s — PsyNeuLink
// re-imports on every restart).
import { mutatingTest as test, expect } from "./test-base";
```

Pick `mutatingTest` when a test:
- loads a demo or runs `/demos/reset`
- edits source through the API (`/source/apply-*`, `/save`, etc.)
- runs a model (`/api/run`) — PsyNeuLink builds and caches Composition state
- saves a layout or other sidecar metadata
- exercises Save As, project bundles, or any file-write path

Pick `readOnlyTest` (the default) when a test only reads — the app-shell smoke is the canonical example.

## Backend isolation

The harness gives each test session a fresh backend environment:

- **Dynamic port**: the production webServer binds a free port picked at config-load time. Override via `PW_PROD_PORT`.
- **Per-session temp dir** under `os.tmpdir()/psyneuview-e2e-XXXXXX`, exposed to the backend as:
  - `PSYNEWVIEW_MODELS_DIR=<tmp>/models` — model browse paths point here (real user models stay invisible to tests)
  - `PSYNEWVIEW_WORKING_DIR=<tmp>/working` — working copies of included models (`/demos/reset`, `/reference-models/load`) go here instead of `~/.psyneuview/working-copies` (#1319)
  - `PSYNEUVIEW_LAYOUTS_DIR=<tmp>/layouts` — layouts and labels for read-only PsyNeuLink files (a stand-in declared through `/api/test/pnl-install`) go here instead of `~/.psyneuview/layouts`, and the startup migration stays off (#1321). `/api/test/reset` empties it.
- **Test-mode gate**: `PSYNEWVIEW_TEST_MODE=1` opens `POST /api/test/reset` on the backend, which is the endpoint `mutatingTest` hits. Production builds never see this endpoint — it's only mounted when the env var is set.

Temp dirs are deliberately *not* cleaned up on exit so trace failures can be inspected post-mortem. They accumulate under `os.tmpdir()` — sweep manually if it gets noisy.

## Canonical fixture models

Five small PsyNeuLink models live under `e2e/fixtures/`. They sit here, not in `backend/demos/`, because the demo lifecycle test (#155) mutates demo working copies — tests that need a stable shape would race against it.

| File | Shape | What it's for |
| --- | --- | --- |
| `single_transfer.py` | one `TransferMechanism` | smallest-possible smoke baseline |
| `two_mech_projection.py` | A → B with explicit `MappingProjection` | edge rendering, projection inspector |
| `with_controller.py` | one mech + `ControlMechanism` via `add_controller` | controller surface (inspector, run panel) |
| `recurrent_self.py` | one `RecurrentTransferMechanism` with auto+hetero | self-loop / recurrent rendering |
| `nested_minimal.py` | outer comp containing an inner comp | nesting code path |

Tests resolve the absolute path through the typed helper:

```ts
import { fixturePath } from "./fixtures";

const modelPath = fixturePath("single_transfer");  // type-checked name
```

The path resolver lives in `e2e/fixtures.ts`. Adding a new fixture means: drop a `.py` file in `e2e/fixtures/`, add its name to the `FixtureName` union, and add a row to the `FIXTURE_EXPECTATIONS` table in `backend/tests/test_e2e_fixtures.py`.

Each fixture is verified by a backend pytest (`test_e2e_fixtures.py`) that asserts it introspects with the expected node and projection counts — so upstream PsyNeuLink shape changes surface there instead of in flaky Playwright failures.

## Failure artifacts

On first retry: trace + video + screenshot. Locally they land in `frontend/test-results/`. Manual CI dispatch runs (see below) bundle `test-results/` and `playwright-report/` into one artifact retained 14 days.

## Console-error policy

Zero tolerance during page load. If a real error is unavoidable (third-party library that always logs), whitelist it explicitly in the test rather than relaxing the assertion globally.

## CI (manual-only — see #168)

Workflow file: `.github/workflows/e2e.yml`. **All automatic triggers are intentionally disabled.** The only trigger today is `workflow_dispatch` — a maintainer clicks **Run workflow** in the Actions UI. Auto triggers (PR smoke, push smoke, nightly full, failure-comment) will be re-enabled incrementally via sub-issues; see **#168** for the activation plan and decision checklist.

### What manual dispatch runs

In the Actions UI, picking `mode=smoke` runs `npm run test:e2e:smoke` (today: `app-shell.spec.ts` and the harness self-test). Picking `mode=full` runs `npm run test:e2e` (everything).

The install + build path mirrors a developer running `make install-all && npm run test:e2e` locally:

1. Python 3.13 + Node 22, with pip / npm caches keyed on the lockfiles.
2. `python -m venv backend/.venv`, install PsyNeuLink from the pinned git SHA in `PSYNEULINK_GIT_REF` (top of `e2e.yml`), then editable install of `backend/`.
3. `npm ci` in `frontend/`, then `npx playwright install --with-deps chromium` (cached on the resolved `@playwright/test` version).
4. `tsc -b && vite build`, then Playwright runs against the backend started by `playwright.config.ts`'s `webServer`.

On failure, the artifact `playwright-results-<mode>-<run_id>` carries traces / videos / screenshots for 14 days.

### Local-vs-CI parity

`playwright.config.ts` hardcodes `backend/.venv/bin/uvicorn` because that's where `make install` puts it. CI mirrors the same path: it creates `backend/.venv` and installs into it, so the same harness code drives both environments. Two intentional differences:

- **PsyNeuLink source.** Local dev uses `pip install -e ../PsyNeuLink` (editable checkout). CI installs from a pinned git SHA — bump `PSYNEULINK_GIT_REF` at the top of `e2e.yml` when CI should track upstream forward; `backend/pyproject.toml` stays decoupled from a specific version.
- **Platform.** Local is typically macOS; CI is `ubuntu-latest`. Platform-specific behavior (path separators, font metrics, headless WebGL) will surface here first. If a spec passes locally and fails in CI, suspect platform before flake.

## What's NOT here yet

- Automatic CI triggers (PR smoke, nightly full, failure-comment) → gated on #168
- Page Object Model abstraction (revisit when 3+ specs exist)
- Golden snapshots / visual diff — deferred (heavy maintenance)
