/**
 * Manual measurement harness (#558): how much heap one History step holds on
 * a large model, whole and compact, against the store's own estimate. The
 * budget in stores/historyStore.ts (DEFAULT_BUDGET) and the numbers in
 * docs/saving-autosave-and-undo.md come from this.
 *
 * Skipped by default (it only logs). Run:
 *   PERF_MEASURE=1 npx playwright test e2e/_measure-undo-memory.spec.ts
 *
 * Steps are recorded through the automation hook (`window.__pnvUndoTest`,
 * utils/history.ts) with a fresh copy of the graph each, as a code edit that
 * rebuilds the model gives; heap is read through the DevTools protocol after
 * a forced garbage collection.
 */
import { mutatingTest as test, expect } from "./test-base";
import { copyFileSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const RUN = !!process.env.PERF_MEASURE;
const N = 100;

const here = path.dirname(fileURLToPath(import.meta.url));
const MODELS = [
  { tag: "EGO (Giallanza 2024, study 2)", file: path.join(here, "..", "..", "backend", "reference_models", "Giallanza2024_ego_study2.py") },
  { tag: "two_mech_projection (small)", file: path.join(here, "fixtures", "two_mech_projection.py") },
];

type Page = import("@playwright/test").Page;

async function openFromPath(page: Page, model: string) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 120_000 });
}

for (const { tag, file } of MODELS) {
  test(`measure History memory per step: ${tag}`, async ({ page }) => {
    test.skip(!RUN, "measurement harness — set PERF_MEASURE=1 to run");
    test.setTimeout(300_000);
    const dir = mkdtempSync(path.join(tmpdir(), "undo558-"));
    const model = path.join(dir, path.basename(file));
    copyFileSync(file, model);
    const base = readFileSync(model, "utf8");
    await openFromPath(page, model);
    await page.waitForTimeout(3000);

    const cdp = await page.context().newCDPSession(page);
    const heap = async () => {
      await cdp.send("HeapProfiler.collectGarbage");
      await cdp.send("HeapProfiler.collectGarbage");
      return (await cdp.send("Runtime.getHeapUsage")).usedSize;
    };
    const hooked = await page.evaluate(() => Boolean((window as any).__pnvUndoTest));
    expect(hooked, "automation hook present").toBe(true);

    const record = (from: number, n: number, fresh: boolean) =>
      page.evaluate(
        ({ base, from, n, fresh }) => {
          const hook = (window as any).__pnvUndoTest;
          for (let i = from; i < from + n; i++) hook.recordCodeEdit(`${base}\n# edit ${i}\n`, `Edit ${i}`, { freshGraph: fresh });
        },
        { base, from, n, fresh },
      );
    const stats = () => page.evaluate(() => (window as any).__pnvUndoTest.stats());

    const clear = () => page.evaluate(() => (window as any).__pnvUndoTest.clear());
    const setBudget = (b: { fullBytes?: number; totalBytes?: number }) =>
      page.evaluate((b) => (window as any).__pnvUndoTest.setBudget(b), b);

    // What History alone holds: the heap it frees when cleared, so the
    // editor's own undo, the activity log and the like are not counted.
    const phase = async (fresh: boolean, fullBytes: number) => {
      await clear();
      await setBudget({ fullBytes, totalBytes: 8e9 });
      await record(0, N, fresh);
      const s = await stats();
      const held = await heap();
      // The state before the last change is held until the next one (a
      // subscriber keeps it), so clear twice before reading the heap.
      await clear();
      await setBudget({});
      await clear();
      const freed = held - (await heap());
      return { s, freed };
    };

    const whole = await phase(true, 4e9);
    const shared = await phase(false, 4e9);
    const compacted = await phase(true, 1);
    const wholeHeap = whole.freed / whole.s.steps;
    const sharedHeap = shared.freed / shared.s.steps;
    const compactHeap = (compacted.freed - compacted.s.full * wholeHeap) / compacted.s.compact;
    const kb = (b: number) => (b / 1024).toFixed(1);

    console.log(
      [
        `[undo558] ${tag}: source ${base.length} chars, ${await page.locator(".react-flow__node").count()} nodes on the canvas`,
        `[undo558]   whole, fresh graph : heap ${kb(wholeHeap)} KB/step, estimate ${kb(whole.s.fullBytes / whole.s.full)} KB/step`,
        `[undo558]   whole, shared graph: heap ${kb(sharedHeap)} KB/step, estimate ${kb(shared.s.fullBytes / shared.s.full)} KB/step`,
        `[undo558]   compact (${compacted.s.compact} of ${compacted.s.steps}): heap ${kb(compactHeap)} KB/step, estimate ${kb((compacted.s.bytes - compacted.s.fullBytes) / compacted.s.compact)} KB/step`,
      ].join("\n"),
    );
  });
}
