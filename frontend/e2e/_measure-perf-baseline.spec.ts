/**
 * The performance baseline for the reference models (#406).
 *
 * For each reference model (the show_graph agreement batch's set), several
 * times over, against the production build:
 *
 *   - open:    Open menu click → first paint of the graph, and → settled;
 *   - switch:  the same, opening it while another model is showing;
 *   - run:     Run Model with the default inputs → the first trial's results
 *              on screen; the backend's time per trial;
 *   - step:    each Next step through the trace → the frame painted after it;
 *   - drag:    the gaps between frames while a node is dragged;
 *   - type:    each key press in the code editor → the frame painted after it,
 *              with the live preview on, and the last key → the graph updated;
 *   - fold:    Collapse a composition → settled, and Expand → settled
 *              (models with a composition frame: EGO).
 *
 * Medians go to docs/testing-coverage/perf-baseline.json, and the table in
 * docs/performance.md is rewritten from it. See docs/performance.md.
 *
 * Run (about 10–15 minutes):
 *   npx vite build
 *   PERF_BASELINE=1 PW_PROD_PORT=<port> npx playwright test e2e/_measure-perf-baseline.spec.ts
 * Options: PERF_RUNS=5 (default 3), PERF_MODELS="EGO,Stroop — Basic" (labels
 * containing these), PERF_NO_WRITE=1 (print only).
 *
 * Not in CI: measurement: takes 10–15 minutes and only records timings; the CI check is perf-smoke.spec.ts.
 */
import { mutatingTest as test, expect, closePalette, fitGraph } from "./test-base";
import type { Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  REFERENCE_MODELS,
  clickTimed,
  frameAfter,
  graphIds,
  installProbes,
  longTaskMs,
  median,
  openTimed,
  percentile,
  round,
  startClock,
  startFrames,
  startKeyLatency,
  stopFrames,
  stopKeyLatency,
  waitGraph,
  waitSelector,
} from "./perf";

const RUN = !!process.env.PERF_BASELINE;
const RUNS = Number(process.env.PERF_RUNS ?? 3);
const ONLY = (process.env.PERF_MODELS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const WRITE = !process.env.PERF_NO_WRITE;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const JSON_OUT = path.join(REPO, "docs", "testing-coverage", "perf-baseline.json");
const MD_OUT = path.join(REPO, "docs", "performance.md");
const RAW_DIR = path.resolve(__dirname, "..", "test-results", "perf-baseline");

/** The model opened in between, for the switch timing. */
const OTHER = "Stroop — Basic";
const OTHER_FOR_OTHER = "TD Learning / dopamine (Montague, Dayan & Sejnowski 1996)";
const STEPS = 15;
const KEYS = "# timing the editor's response to typing, one key at a time";

/** The app's own load breakdown, from its `[perf] load` line (utils/loadPerf.ts). */
function parsePerfLine(line: string) {
  const n = (k: string) => {
    const m = line.match(new RegExp(`${k}=(\\d+)`));
    return m ? Number(m[1]) : null;
  };
  return { total: n("total"), api: n("api"), parse: n("parse"), build: n("build"), paint: n("paint"), introspect: n("introspect") };
}

type Sample = Record<string, number | null>;

async function measureOnce(page: Page, label: string): Promise<Sample> {
  const s: Sample = {};
  const perfLines: string[] = [];
  const onConsole = (m: { text(): string }) => {
    const t = m.text();
    if (t.includes("[perf] load")) perfLines.push(t);
  };
  page.on("console", onConsole);

  await page.goto("/");
  await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30_000 });

  // Open, from an empty canvas.
  perfLines.length = 0;
  const open = await openTimed(page, label);
  s.openFirstPaint = open.firstPaint;
  s.openSettled = open.settled;
  s.openLongTasks = open.longTasks;
  const app = parsePerfLine(perfLines.find((l) => l.includes(label)) ?? perfLines[0] ?? "");
  s.appLoadTotal = app.total;
  s.appLoadApi = app.api;
  s.appLoadBuild = app.build;
  s.appLoadPaint = app.paint;
  s.backendIntrospect = app.introspect;

  // Switch: another model, then this one again.
  await openTimed(page, label === OTHER ? OTHER_FOR_OTHER : OTHER);
  const sw = await openTimed(page, label);
  s.switchFirstPaint = sw.firstPaint;
  s.switchSettled = sw.settled;

  await closePalette(page);
  await fitGraph(page);

  // Run the default inputs.
  await page.getByTestId("tab-run").click();
  const runButton = page.getByRole("button", { name: /Run Model/ });
  await expect(runButton).toBeEnabled({ timeout: 30_000 });
  const runResp = page.waitForResponse((r) => r.url().endsWith("/api/model/run"), { timeout: 180_000 });
  await clickTimed(runButton);
  const resp = await runResp;
  const shown = await waitSelector(page, '[data-testid="run-trial-card-1"]').catch(() => null);
  s.runToResults = shown;
  s.runLongTasks = await longTaskMs(page);
  if (resp.ok()) {
    const data = await resp.json();
    const trials: number[] = (data.trial_seconds ?? []).map((x: number) => x * 1000);
    s.runTrials = data.numTrials ?? trials.length ?? null;
    s.runServerMs = data.timings?.run_ms ?? null;
    // Builds without PsyNeuLink's per-trial hooks return no per-trial times
    // (EGO's run); the server's run time over the trials stands in.
    s.runPerTrial = trials.length ? median(trials) : s.runServerMs != null && s.runTrials ? s.runServerMs / s.runTrials : null;
  }

  // Step through the trace.
  const next = page.getByTestId("trace-next-step");
  if (await next.isVisible({ timeout: 5_000 }).catch(() => false)) {
    const frames: number[] = [];
    for (let i = 0; i < STEPS; i++) {
      if (!(await next.isEnabled())) break;
      frames.push(await frameAfter(next));
    }
    s.stepFrame = median(frames);
    s.stepFrameP95 = percentile(frames, 95);
  }

  // Drag a node: the biggest mechanism, so the move is unmistakable.
  const nodes = page.getByTestId("graph-canvas").locator(".react-flow__node:not(.react-flow__node-compositionNode)");
  const count = await nodes.count();
  let best: { x: number; y: number; width: number; height: number } | null = null;
  for (let i = 0; i < Math.min(count, 40); i++) {
    const b = await nodes.nth(i).boundingBox();
    if (b && (!best || b.width * b.height > best.width * best.height)) best = b;
  }
  if (best) {
    const x = best.x + best.width / 2;
    const y = best.y + best.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await startFrames(page);
    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(x + i * 4, y + i * 2);
    }
    const gaps = await stopFrames(page);
    await page.mouse.up();
    s.dragFrame = median(gaps);
    s.dragFrameP95 = percentile(gaps, 95);
    // Let a layout save or rebuild the drop starts finish.
    await startClock(page);
    await waitGraph(page, { needChange: false, quietMs: 300 }).catch(() => null);
  }

  // Fold and unfold a composition, where the model has one. A model can open
  // with it folded (EGO's saved layout folds EM), so unfold first then.
  const canvas = page.getByTestId("graph-canvas");
  const frameButton = canvas.getByRole("button", { name: /^(Collapse|Expand) composition / }).first();
  if (await frameButton.isVisible().catch(() => false)) {
    const aria = (await frameButton.getAttribute("aria-label")) ?? "";
    const name = aria.replace(/^(Collapse|Expand) composition /, "");
    const order = aria.startsWith("Collapse") ? (["Collapse", "Expand"] as const) : (["Expand", "Collapse"] as const);
    for (const verb of order) {
      const button = canvas.getByRole("button", { name: `${verb} composition ${name}`, exact: true }).first();
      await expect(button).toBeVisible({ timeout: 30_000 });
      const prev = await graphIds(page);
      await clickTimed(button);
      const t = (await waitGraph(page, { prevIds: prev })).settled;
      if (verb === "Collapse") s.foldSettled = t;
      else s.unfoldSettled = t;
    }
  }

  // Type in the code editor, live preview on (the default).
  const editor = page.locator(".cm-content").first();
  if (await editor.isVisible().catch(() => false)) {
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    const preview = page.waitForResponse((r) => r.url().endsWith("/api/model/preview"), { timeout: 60_000 }).catch(() => null);
    await startKeyLatency(page);
    // About 60 ms between keys, like steady typing; long enough to run past
    // the preview's delay, so some keys land while it works.
    await page.keyboard.type(KEYS, { delay: 60 });
    const lat = await stopKeyLatency(page);
    s.typeLatency = median(lat);
    s.typeLatencyP95 = percentile(lat, 95);
    s.typeLatencyMax = lat.length ? Math.max(...lat) : null;
    // The last key → the graph redrawn from the edit (includes the preview's delay).
    await startClock(page);
    const answered = await preview;
    if (answered) {
      const g = await waitGraph(page, { needChange: false, quietMs: 300 }).catch(() => null);
      s.previewAfterLastKey = g?.settled ?? null;
    }
  }

  page.off("console", onConsole);
  return s;
}

function machine() {
  const cpus = os.cpus();
  let sha = "";
  try {
    sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    /* not a checkout */
  }
  return {
    cpu: cpus[0]?.model ?? "unknown",
    cores: cpus.length,
    memoryGB: Math.round(os.totalmem() / 2 ** 30),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    node: process.version,
    commit: sha,
    // Other work on the machine slows everything; a load near the core count is busy.
    loadAverage1m: Math.round(os.loadavg()[0] * 10) / 10,
  };
}

function psyneulinkVersion(): string | null {
  try {
    const py = path.join(REPO, "backend", ".venv", "bin", "python");
    return execFileSync(py, ["-c", "import importlib.metadata as m; print(m.version('psyneulink'))"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** The table in docs/performance.md, between its markers. */
function tableMarkdown(models: Record<string, { medians: Sample }>) {
  const cols: [string, string][] = [
    ["openFirstPaint", "Open: first paint"],
    ["openSettled", "Open: settled"],
    ["switchSettled", "Switch: settled"],
    ["runToResults", "Run: to results"],
    ["runPerTrial", "Run: per trial"],
    ["stepFrame", "Step: frame"],
    ["dragFrame", "Drag: frame (p95)"],
    ["typeLatency", "Typing: latency (p95)"],
    ["previewAfterLastKey", "Typing: graph updated"],
    ["foldSettled", "Fold / unfold"],
  ];
  const fmt = (v: number | null | undefined) => (v == null ? "–" : v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)}`);
  const lines = [
    `| Model | ${cols.map((c) => c[1]).join(" | ")} |`,
    `|---|${cols.map(() => "---:").join("|")}|`,
  ];
  for (const [label, { medians: m }] of Object.entries(models)) {
    const cell = (k: string) => {
      if (k === "dragFrame") return m.dragFrame == null ? "–" : `${fmt(m.dragFrame)} (${fmt(m.dragFrameP95)})`;
      if (k === "typeLatency") return m.typeLatency == null ? "–" : `${fmt(m.typeLatency)} (${fmt(m.typeLatencyP95)})`;
      if (k === "foldSettled") return m.foldSettled == null ? "–" : `${fmt(m.foldSettled)} / ${fmt(m.unfoldSettled)}`;
      return fmt(m[k]);
    };
    lines.push(`| ${label} | ${cols.map((c) => cell(c[0])).join(" | ")} |`);
  }
  return lines.join("\n");
}

function writeResults(label: string, file: string, samples: Sample[], extra: Record<string, unknown>) {
  const keys = [...new Set(samples.flatMap((s) => Object.keys(s)))];
  const medians: Sample = {};
  for (const k of keys) medians[k] = round(median(samples.map((s) => s[k]).filter((v): v is number => v != null)));
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(path.join(RAW_DIR, `${file}.json`), JSON.stringify({ label, samples }, null, 2));
  console.log(`\n[perf-baseline] ${label}\n${JSON.stringify(medians)}\n`);
  if (!WRITE) return;
  const doc = existsSync(JSON_OUT) ? JSON.parse(readFileSync(JSON_OUT, "utf8")) : {};
  doc.about =
    "Medians of PERF_RUNS runs of _measure-perf-baseline.spec.ts against the production build, in milliseconds. " +
    "Taken on the machine below; CI runners are slower. See docs/performance.md.";
  doc.measured = new Date().toISOString().slice(0, 10);
  doc.runs = RUNS;
  doc.machine = { ...machine(), ...extra };
  doc.models = doc.models ?? {};
  doc.models[label] = { file, medians };
  // Keep the models in the reference list's order.
  const ordered: Record<string, unknown> = {};
  for (const m of REFERENCE_MODELS) if (doc.models[m.label]) ordered[m.label] = doc.models[m.label];
  doc.models = ordered;
  writeFileSync(JSON_OUT, JSON.stringify(doc, null, 2) + "\n");
  if (existsSync(MD_OUT)) {
    const md = readFileSync(MD_OUT, "utf8");
    const start = "<!-- perf-table:start -->";
    const end = "<!-- perf-table:end -->";
    const i = md.indexOf(start);
    const j = md.indexOf(end);
    if (i >= 0 && j > i) {
      const out = `${md.slice(0, i + start.length)}\n${tableMarkdown(doc.models)}\n${md.slice(j)}`;
      writeFileSync(MD_OUT, out);
    }
  }
}

const models = REFERENCE_MODELS.filter((m) => !ONLY.length || ONLY.some((o) => m.label.includes(o)));

test.describe("performance baseline (#406)", () => {
  for (const { label, file } of models) {
    test(`baseline: ${label}`, async ({ page, browser }) => {
      test.skip(!RUN, "measurement — set PERF_BASELINE=1 to run");
      test.setTimeout(RUNS * 240_000);
      await page.setViewportSize({ width: 1600, height: 1000 });
      // The layout people get: Like show_graph, not the suite's Layered.
      await page.addInitScript(() => localStorage.removeItem("psyneuview.graph.layoutDefault"));
      await installProbes(page);
      const samples: Sample[] = [];
      for (let r = 0; r < RUNS; r++) samples.push(await measureOnce(page, label));
      writeResults(label, file.replace(/\.py$/, ""), samples, {
        browser: `Chromium ${browser.version()}`,
        psyneulink: psyneulinkVersion(),
      });
    });
  }
});
