import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "child_process";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = !!process.env.PW_DEV;

// Production mode: allocate a free port at config-load time so parallel
// test runs or a concurrent dev server don't collide (#147). Dev mode
// keeps the conventional Vite + uvicorn ports so HMR-style iteration works.
//
// net.createServer().listen(0) is async in Node — address() returns null
// before the 'listening' event fires. We can't await from a config module,
// so we shell out to a one-liner child process which can actually wait.
function pickFreePort(): number {
  const script = `const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})`;
  const out = execFileSync(process.execPath, ["-e", script], { encoding: "utf8" });
  const port = Number(out.trim());
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`playwright.config: failed to allocate a free port (got ${JSON.stringify(out)})`);
  }
  return port;
}

// Playwright loads this config multiple times in a single run (once for
// the runner, again per worker). Cache the picked port via an env var so
// the webServer and baseURL agree across loads.
const PROD_PORT = (() => {
  if (process.env.PW_PROD_PORT) return Number(process.env.PW_PROD_PORT);
  const port = pickFreePort();
  process.env.PW_PROD_PORT = String(port);
  return port;
})();
const DEV_FRONTEND_PORT = 5173;
const DEV_BACKEND_PORT = 8000;

const baseURL = isDev
  ? `http://127.0.0.1:${DEV_FRONTEND_PORT}`
  : `http://127.0.0.1:${PROD_PORT}`;

const backendCwd = path.resolve(__dirname, "..", "backend");
const venvUvicorn = path.join(backendCwd, ".venv", "bin", "uvicorn");

// Per-session temp dirs keep working-copy mutations and any locally-saved
// models from the user's real backend/ working tree (#147). Each Playwright
// run gets its own dir; we deliberately don't clean it up on exit so trace
// failures can be inspected post-mortem.
//
// Cached via env var for the same reason PROD_PORT is — Playwright reloads
// this config across processes and we want the runner-spawned webServer and
// the worker-process baseURL to agree on the dir.
const sessionTmp = (() => {
  if (process.env.PW_SESSION_TMP) return process.env.PW_SESSION_TMP;
  const dir = mkdtempSync(path.join(tmpdir(), "psyneuview-e2e-"));
  process.env.PW_SESSION_TMP = dir;
  return dir;
})();
const sessionModelsDir = path.join(sessionTmp, "models");
const sessionWorkingDir = path.join(sessionTmp, "working");
const sessionLayoutsDir = path.join(sessionTmp, "layouts");

// Playwright's webServer `env` replaces the child's environment rather
// than merging with it, so we have to fold process.env in explicitly or
// uvicorn loses PATH and can't resolve Python deps.
const harnessEnv: Record<string, string> = {
  ...(process.env as Record<string, string>),
  PSYNEWVIEW_TEST_MODE: "1",
  PSYNEWVIEW_MODELS_DIR: sessionModelsDir,
  PSYNEWVIEW_WORKING_DIR: sessionWorkingDir,
  // #1321: layouts and labels for read-only PsyNeuLink files (a stand-in
  // library model declared through /api/test/pnl-install) go here instead
  // of ~/.psyneuview/layouts, and the startup migration stays off.
  PSYNEUVIEW_LAYOUTS_DIR: sessionLayoutsDir,
  // #1025: user preferences (~/.psynewview.json) redirected into this session's
  // temp dir. Without it, any test touching a persisted setting — the global
  // sidecar-placement default, install history, recent files — writes to the
  // developer's real preferences file on whatever machine runs the suite.
  // Both spellings are correct: PSYNEUVIEW_ here, PSYNEWVIEW_ above. The env
  // names are genuinely split; see #1025.
  PSYNEUVIEW_CONFIG_FILE: path.join(sessionTmp, "psynewview.json"),
};

const prodWebServer = {
  command: `${venvUvicorn} app.main:app --host 127.0.0.1 --port ${PROD_PORT}`,
  cwd: backendCwd,
  url: `http://127.0.0.1:${PROD_PORT}/health`,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
  stdout: "pipe" as const,
  stderr: "pipe" as const,
  env: harnessEnv,
};

const devWebServers = [
  {
    command: `${venvUvicorn} app.main:app --host 127.0.0.1 --port ${DEV_BACKEND_PORT}`,
    cwd: backendCwd,
    url: `http://127.0.0.1:${DEV_BACKEND_PORT}/health`,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe" as const,
    stderr: "pipe" as const,
    env: harnessEnv,
  },
  {
    command: `npm run dev -- --port ${DEV_FRONTEND_PORT}`,
    cwd: __dirname,
    url: `http://127.0.0.1:${DEV_FRONTEND_PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      VITE_FRONTEND_PORT: String(DEV_FRONTEND_PORT),
      VITE_BACKEND_PORT: String(DEV_BACKEND_PORT),
    },
  },
];

export default defineConfig({
  testDir: "./e2e",
  // *.local.spec.ts are developer-run specs that need something the runners do
  // not have — a desktop app installed, macOS, Accessibility permission. They
  // are real tests, just not automatable here.
  testIgnore: "**/*.local.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // Per-test budget. Playwright defaults to 30s, too tight for our backend-heavy
  // specs on a loaded CI runner — real model load+run (e.g. EGO in
  // reference-models-runnable) could exceed it and the test was killed mid-flight
  // ("Target page/browser has been closed"), a pure-infra flake now that these
  // are required checks (#160). 120s is a generous ceiling, not a target.
  timeout: 120_000,
  use: {
    baseURL,
    trace: "on-first-retry",
    video: "on-first-retry",
    screenshot: "only-on-failure",
    // 10s was too tight for backend POSTs (model load / test reset) when the CI
    // backend is briefly slow — surfaced as "apiRequestContext.post: Timeout
    // 10000ms" across unrelated specs (#160).
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: isDev ? devWebServers : prodWebServer,
});
