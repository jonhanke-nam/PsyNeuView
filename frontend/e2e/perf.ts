/**
 * Timing helpers for the performance baseline (#406).
 *
 * Every number is taken inside the page with `performance.now()`, so it does
 * not include Playwright's own round trips. The pattern is:
 *
 *   - `startClock` / `clickTimed` set the start time in the page, in the same
 *     task as the click, so the clock starts when the user's click lands;
 *   - `waitGraph` then watches the canvas every frame and reports when the new
 *     graph first painted and when it settled (nodes, sizes and the view stop
 *     changing, no model request in flight, no busy wheel);
 *   - `frameAfter` / `recordFrames` / `keyLatency` measure how long the page
 *     takes to paint after an input.
 *
 * `installProbes` must run before the page loads (it is an init script): it
 * counts model requests in flight and records long tasks.
 *
 * Used by the local measurement spec (_measure-perf-baseline.spec.ts) and the
 * CI smoke check (perf-smoke.spec.ts).
 */
import type { Locator, Page } from "@playwright/test";

/** The reference models, by their Open-menu label, with their file names. Same set as show-graph-agreement's REFERENCE_MODELS. */
export const REFERENCE_MODELS: { label: string; file: string }[] = [
  { label: "Conflict Monitoring — Stroop (Botvinick et al. 2001)", file: "Botvinick_conflict_monitoring_model.py" },
  { label: "Stroop — Horse Race (Cohen & Huston 1994)", file: "Cohen_Huston1994_horse_race.py" },
  { label: "Stroop — Bidirectional (Cohen & Huston 1994)", file: "Cohen_Huston1994.py" },
  { label: "EGO — Giallanza et al. 2024 (Study 2)", file: "Giallanza2024_ego_study2.py" },
  { label: "Locus Coeruleus — gain model (Gilzenrat et al.)", file: "GilzenratModel.py" },
  { label: "Stroop — PCTC (Kalanthroff, Davelaar & Usher 2018)", file: "Kalanthroff_PCTC_2018.py" },
  { label: "TD Learning / dopamine (Montague, Dayan & Sejnowski 1996)", file: "MontagueDayanSejnowski96.py" },
  { label: "Locus Coeruleus / P300 (Nieuwenhuis et al. 2005)", file: "Nieuwenhuis2005Model.py" },
  { label: "Stroop — Basic", file: "stroop_reference_basic.py" },
  { label: "Stroop — with Locus Coeruleus (LC)", file: "stroop_reference_with_lc.py" },
];

export function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function percentile(xs: number[], p: number): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)];
}

export const round = (x: number | null | undefined) => (x == null ? null : Math.round(x));

/** Count model requests in flight and record long tasks. Call before page.goto. */
export async function installProbes(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__pnvInflight = 0;
    w.__pnvLong = [] as { start: number; duration: number }[];
    const orig = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      // Model work only: progress polls and status checks run all the time.
      const counted = url.includes("/api/model/") && !url.includes("/progress");
      if (counted) w.__pnvInflight++;
      try {
        return await orig(input, init);
      } finally {
        if (counted) w.__pnvInflight--;
      }
    }) as typeof window.fetch;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__pnvLong.push({ start: e.startTime, duration: e.duration });
      }).observe({ type: "longtask", buffered: true });
    } catch {
      /* long tasks not supported: the sums read 0 */
    }
  });
}

/** The ids of the nodes on the canvas, sorted and joined. */
export async function graphIds(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="graph-canvas"] .react-flow__node')]
      .map((n) => n.getAttribute("data-id") ?? "")
      .sort()
      .join("|"),
  );
}

/** Start the page's clock now. */
export async function startClock(page: Page) {
  await page.evaluate(() => {
    (window as any).__pnvT0 = performance.now();
  });
}

/** Click an element from inside the page, starting the clock in the same task. */
export async function clickTimed(el: Locator) {
  await el.evaluate((e) => {
    (window as any).__pnvT0 = performance.now();
    (e as HTMLElement).click();
  });
}

/** Milliseconds of long tasks since the clock started. */
export async function longTaskMs(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as any;
    return (w.__pnvLong as { start: number; duration: number }[])
      .filter((t) => t.start >= w.__pnvT0)
      .reduce((s, t) => s + t.duration, 0);
  });
}

export interface GraphTiming {
  /** Clock start → the first frame with the new graph's nodes on screen. */
  firstPaint: number;
  /** Clock start → the last change before the canvas went quiet. */
  settled: number;
}

/**
 * Wait, frame by frame, for a graph that differs from `prevIds` to paint, and
 * then for the canvas to settle: no change for `quietMs`, no model request in
 * flight, and no busy wheel. Times are from the clock start.
 */
export async function waitGraph(
  page: Page,
  opts: { prevIds?: string; quietMs?: number; timeoutMs?: number; needChange?: boolean } = {},
): Promise<GraphTiming> {
  const { prevIds = "", quietMs = 500, timeoutMs = 90_000, needChange = true } = opts;
  return page.evaluate(
    ({ prevIds, quietMs, timeoutMs, needChange }) =>
      new Promise<GraphTiming>((resolve, reject) => {
        const w = window as any;
        const t0: number = w.__pnvT0;
        const canvas = () => document.querySelector('[data-testid="graph-canvas"]');
        const ids = () =>
          [...(canvas()?.querySelectorAll(".react-flow__node") ?? [])]
            .map((n) => n.getAttribute("data-id") ?? "")
            .sort()
            .join("|");
        const sig = () => {
          const c = canvas();
          if (!c) return "";
          const nodes = [...c.querySelectorAll<HTMLElement>(".react-flow__node")]
            .map((n) => `${n.getAttribute("data-id")}@${n.style.transform}/${n.offsetWidth}x${n.offsetHeight}`)
            .join("|");
          const edges = c.querySelectorAll(".react-flow__edge").length;
          const vp = c.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform ?? "";
          return `${nodes}#${edges}#${vp}`;
        };
        let first: number | null = null;
        let last = sig();
        let lastChange = performance.now();
        const tick = () => {
          const now = performance.now();
          if (now - t0 > timeoutMs) {
            reject(new Error(`graph did not ${first == null ? "paint" : "settle"} within ${timeoutMs} ms`));
            return;
          }
          const s = sig();
          if (s !== last) {
            last = s;
            lastChange = now;
          }
          if (first == null) {
            const cur = ids();
            if (cur && (!needChange || cur !== prevIds)) {
              first = now;
              lastChange = now;
            }
          }
          const busy = document.documentElement.classList.contains("pnv-busy") || w.__pnvInflight > 0;
          if (first != null && !busy && now - lastChange >= quietMs) {
            resolve({ firstPaint: first - t0, settled: Math.max(first, lastChange) - t0 });
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { prevIds, quietMs, timeoutMs, needChange },
  );
}

/** Wait for a selector to be on screen; ms from the clock start. */
export async function waitSelector(page: Page, selector: string, timeoutMs = 120_000): Promise<number> {
  return page.evaluate(
    ({ selector, timeoutMs }) =>
      new Promise<number>((resolve, reject) => {
        const t0: number = (window as any).__pnvT0;
        const tick = () => {
          const el = document.querySelector<HTMLElement>(selector);
          if (el && el.offsetParent !== null) return resolve(performance.now() - t0);
          if (performance.now() - t0 > timeoutMs) return reject(new Error(`${selector} not shown within ${timeoutMs} ms`));
          requestAnimationFrame(tick);
        };
        tick();
      }),
    { selector, timeoutMs },
  );
}

/**
 * Click `el` from inside the page and time it to the frame painted after the
 * page has handled it (two animation frames: the one that renders, and the
 * one after the paint).
 */
export async function frameAfter(el: Locator): Promise<number> {
  return el.evaluate(
    (e) =>
      new Promise<number>((resolve) => {
        const t = performance.now();
        (e as HTMLElement).click();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t)));
      }),
  );
}

/** Start recording the gaps between animation frames. */
export async function startFrames(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__pnvFrames = [] as number[];
    w.__pnvFramesOn = true;
    let prev = performance.now();
    const tick = (now: number) => {
      if (!w.__pnvFramesOn) return;
      w.__pnvFrames.push(now - prev);
      prev = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Stop recording; the frame gaps seen. */
export async function stopFrames(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const w = window as any;
    w.__pnvFramesOn = false;
    return (w.__pnvFrames as number[]).slice(1);
  });
}

/**
 * Time each key press to the frame painted after it: the key event's own time
 * stamp to two animation frames later.
 */
export async function startKeyLatency(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__pnvKeys = [] as number[];
    w.__pnvKeyListener = (e: KeyboardEvent) => {
      const t = e.timeStamp;
      requestAnimationFrame(() => requestAnimationFrame(() => w.__pnvKeys.push(performance.now() - t)));
    };
    document.addEventListener("keydown", w.__pnvKeyListener, true);
  });
}

export async function stopKeyLatency(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const w = window as any;
    document.removeEventListener("keydown", w.__pnvKeyListener, true);
    return w.__pnvKeys as number[];
  });
}

/** Open a model from the Open menu by its label, timing it from the click. */
export async function openTimed(page: Page, label: string, opts: { quietMs?: number } = {}) {
  const prevIds = await graphIds(page);
  await page.getByTestId("open-menu").click();
  const item = page.getByText(label, { exact: true }).first();
  await item.waitFor({ state: "visible", timeout: 15_000 });
  await clickTimed(item);
  const t = await waitGraph(page, { prevIds, quietMs: opts.quietMs });
  return { ...t, longTasks: await longTaskMs(page) };
}

/**
 * Put the code editor's cursor at the end of the file. Select all, then the
 * right arrow: the same on every platform (Ctrl+End is not, on macOS).
 */
export async function toEndOfFile(page: Page) {
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ArrowRight");
}
