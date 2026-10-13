/**
 * Guided walkthrough — driven from the walkthrough itself (#1181).
 *
 * This spec does not describe the walkthrough. It loads
 * `src/walkthroughs/demo.yaml` — the same file the in-app overlay reads — and
 * walks it. Change a step's wording, anchor or completion condition and this
 * follows automatically; break the app so a step can no longer be shown or
 * completed and this fails.
 *
 * That is what "one list, two runners" buys: a walkthrough that cannot quietly
 * stop matching the software it describes.
 */
// mutatingTest, not readOnlyTest: each walkthrough needs a clean slate. The
// build walkthrough adds a TransferMechanism to Stroop — Basic, and without a
// reset every later walkthrough that opens Stroop got that edited working copy
// (8 mechanisms, a custom layout). On some machines that layout left
// color_hidden off-screen, so the Stroop walkthrough had nothing to ring.
import { mutatingTest as test, expect } from "../test-base";
import { loadWalkthrough, runWalkthrough } from "../tourDriver";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync } from "fs";

const ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/tutorials/assets/tour",
);
mkdirSync(ASSETS, { recursive: true });
const shot = (name: string) => path.join(ASSETS, name);

const walkthrough = loadWalkthrough("demo");
const buildWalkthrough = loadWalkthrough("build");
const runWalkthroughDef = loadWalkthrough("run");
const ddm = loadWalkthrough("ddm");
const stroop = loadWalkthrough("stroop");
const dynamics = loadWalkthrough("dynamics");
const logistic = loadWalkthrough("logistic");
const perceptron = loadWalkthrough("perceptron");
const memory = loadWalkthrough("memory");
const semantic = loadWalkthrough("semantic");
const conflict = loadWalkthrough("conflict");
const ego = loadWalkthrough("ego");
const iscci = loadWalkthrough("iscci");
const hebbian = loadWalkthrough("hebbian");
const td = loadWalkthrough("td");
const vectors = loadWalkthrough("vectors");
const hopfield = loadWalkthrough("hopfield");

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe(`Guided walkthrough: ${walkthrough.title}`, () => {
  test("every step is shown, acted on, and completes", async ({ page }) => {
    await page.goto("/?tour=demo");
    // The walkthrough opens the model it was written for (#1224).
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });

    // The ring is anchored to the node, not parked at fixed screen coordinates:
    // it scales with the canvas. The property most likely to rot silently.
    // A zoom saved with the model by an earlier test can leave the node
    // off-screen, where the walkthrough offers to fit instead of drawing its
    // ring; a learner would take it (as runWalkthrough does).
    const fit = page.getByTestId("tour-fit");
    await expect(page.getByTestId("tour-highlight").or(fit).first()).toBeVisible({ timeout: 15000 });
    if (await fit.isVisible()) await fit.click();
    await expect(page.getByTestId("tour-highlight")).toBeVisible({ timeout: 15000 });
    const before = await page.getByTestId("tour-highlight").boundingBox();
    await page.locator(".react-flow__controls-zoomin").click();
    await page.waitForTimeout(400);
    const after = await page.getByTestId("tour-highlight").boundingBox();
    expect(Math.abs((after?.width ?? 0) - (before?.width ?? 0))).toBeGreaterThan(4);

    await runWalkthrough(page, walkthrough, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`step-${index + 1}.png`) });
    });

    await page.screenshot({ path: shot("complete.png") });
    // Walkthrough over: the overlay retires itself rather than lingering.
    await expect(page.getByTestId("tour-overlay")).toHaveCount(0, { timeout: 10000 });
  });
});

test.describe(`Guided walkthrough: ${buildWalkthrough.title}`, () => {
  /**
   * The walkthrough that carries #1180's premise: the learner *builds*, rather
   * than opening something finished. It exercises a different shape of step —
   * the anchor is the palette (outside the canvas) and completion is "a node
   * that did not exist now does".
   */
  test("teaches adding a component, and every step completes", async ({ page }) => {
    await page.goto("/?tour=build");
    // The walkthrough opens the model it was written for (#1224).
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });

    await runWalkthrough(page, buildWalkthrough, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`build-step-${index + 1}.png`) });
    });

    await expect(page.getByTestId("tour-overlay")).toHaveCount(0, { timeout: 10000 });
  });
});

test.describe(`Guided walkthrough: ${runWalkthroughDef.title}`, () => {
  /**
   * The third shape of step: make something *happen* and read the result.
   * Completion is neither a selection nor the node list but whether the model
   * actually produced trials — a fact only the backend can supply, so this is
   * the first walkthrough step that cannot complete without a real run.
   */
  test("teaches running a model, and completes on real trials", async ({ page }) => {
    await page.goto("/?tour=run");
    // The walkthrough opens the model it was written for (#1224).
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });

    await runWalkthrough(page, runWalkthroughDef, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`run-step-${index + 1}.png`) });
    });

    await expect(page.getByTestId("tour-overlay")).toHaveCount(0, { timeout: 10000 });
  });
});

test.describe(`Guided walkthrough: ${ddm.title}`, () => {
  /**
   * The first course model (#51), and the first walkthrough that opens NO
   * model — it builds one. That is the premise #1180 rests on: a learner who
   * assembles the model understands it in a way that someone who pressed Run
   * on a finished file does not.
   *
   * Mutating: it creates a model, so it needs a clean slate of its own.
   */
  test("builds a DDM from an empty canvas, runs it, and inspects it", async ({ page }) => {
    await page.goto("/?tour=ddm");
    // No model is opened — the first step creates one.
    await runWalkthrough(page, ddm, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`ddm-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-overlay")).toHaveCount(0, { timeout: 10000 });
  });
});

test.describe(`Guided walkthrough: ${stroop.title}`, () => {
  /**
   * The second course model (#56), and the opposite shape to the DDM: seven
   * mechanisms already wired, so the walkthrough explores rather than builds.
   * Its first step opens the model itself, so this starts from a bare app.
   */
  test("opens Stroop, walks both pathways, runs it and reaches the DDM", async ({ page }) => {
    await page.goto("/?tour=stroop");
    await runWalkthrough(page, stroop, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`stroop-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });
  });
});

test.describe(`Guided walkthrough: ${dynamics.title}`, () => {
  /**
   * The third course model (#50), and the first whose lesson is in the
   * *inputs*: one kick and then silence, versus inputs that stay different.
   * The Run panel's default inputs (1 on every trial) would teach neither, so
   * this is the walkthrough that needs setTrialInputs / lastRunInputs.
   */
  test("opens the bistable pair, kicks it, and pushes it apart", async ({ page }) => {
    await page.goto("/?tour=dynamics");
    await runWalkthrough(page, dynamics, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`dynamics-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });
  });
});

test.describe(`Guided walkthrough: ${logistic.title}`, () => {
  /**
   * The primer's logistic module (#46), built from New Model: switch the output
   * node's function to Logistic, then solve the course's exercise (output 1 for
   * input 1). It solves it the PsyNeuLink way, with x_0 rather than the
   * notebook's bias, since PsyNeuLink's Logistic adds its bias to the input.
   */
  test("builds a logistic unit and solves the course's exercise", async ({ page }) => {
    // Keep the last run's output. The canvas's value pill only shows while the
    // trace sits on a trial, so it can't be relied on after the walkthrough.
    let lastRun: { results?: { output: number[][] }[] } | null = null;
    page.on("response", async (r) => {
      if (r.url().includes("/api/model/run") && r.request().method() === "POST" && r.ok()) {
        lastRun = await r.json().catch(() => lastRun);
      }
    });
    await page.goto("/?tour=logistic");
    await runWalkthrough(page, logistic, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`logistic-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });
    // The exercise's point, checked on the model's own output rather than
    // trusted from the instructions: an input of 1 now gives exactly 1.
    const final = lastRun?.results?.at(-1)?.output.flat() ?? [];
    expect(final.at(-1), "output_node after the exercise").toBeCloseTo(1, 4);
  });
});

test.describe(`Guided walkthrough: ${perceptron.title}`, () => {
  /**
   * The primer's perceptron module (#47), and the first walkthrough that
   * *trains* a model. It checks the lesson on the model's own losses, not just
   * that training ran: AND must be learned (the loss collapses) and XOR must
   * not be (the loss stays near 0.25).
   */
  test("learns AND, and fails to learn XOR", async ({ page }) => {
    test.setTimeout(300_000);
    // Final loss per training job, in the order the jobs finished. Keyed by job
    // id: the panel can fetch a finished job's snapshot more than once.
    const lossByJob = new Map<string, number>();
    page.on("response", async (r) => {
      const m = r.url().match(/\/api\/jobs\/([^/?]+)$/);
      if (m && r.request().method() === "GET" && r.ok()) {
        const snap = await r.json().catch(() => null);
        const loss = snap?.result?.finalLoss;
        if (snap?.status === "done" && typeof loss === "number" && !lossByJob.has(m[1])) {
          lossByJob.set(m[1], loss);
        }
      }
    });
    await page.goto("/?tour=perceptron");
    await runWalkthrough(page, perceptron, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`perceptron-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });
    const losses = [...lossByJob.values()];
    expect(losses.length, "two completed trainings").toBeGreaterThanOrEqual(2);
    const [andLoss, xorLoss] = [losses.at(-2)!, losses.at(-1)!];
    expect(andLoss, "AND is learned").toBeLessThan(0.01);
    expect(xorLoss, "XOR is not").toBeGreaterThan(0.2);
  });
});

test.describe(`Guided walkthrough: ${memory.title}`, () => {
  /**
   * The course's episodic-memory module (#54): open an EMComposition and walk
   * a query's path through it, bottom to top, naming the nodes PsyNeuLink 0.19
   * actually builds (the notebook's STORE and MATCH nodes no longer exist).
   */
  test("walks a query from [QUERY] to [RETRIEVED]", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/?tour=memory");
    await runWalkthrough(page, memory, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`memory-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });
  });
});

test.describe(`Guided walkthrough: ${semantic.title}`, () => {
  /**
   * The course's backpropagation module (#53): open Rumelhart's semantic
   * network, ask it what a robin is before training, train it on every
   * noun-relation pair, then on the notebook's Exercise 3 variant. The lesson
   * is checked on the network's own answers from each training's last pass,
   * not just that training ran: after the first, robin + is says bird and not
   * fish, with the has and can outputs quiet; after the discounted one, the
   * has outputs sit near 0.5 instead.
   */
  test("trains the semantic network, and a robin becomes a bird", async ({ page }) => {
    test.setTimeout(420_000);
    // The last pass of each finished training job, keyed by job id: the panel
    // can fetch a finished job's snapshot more than once.
    const answersByJob = new Map<string, number[][][]>();
    page.on("response", async (r) => {
      const m = r.url().match(/\/api\/jobs\/([^/?]+)$/);
      if (m && r.request().method() === "GET" && r.ok()) {
        const snap = await r.json().catch(() => null);
        const results = snap?.result?.results as { output: number[][] }[] | undefined;
        if (snap?.status === "done" && results && !answersByJob.has(m[1])) {
          answersByJob.set(m[1], results.map((t) => t.output));
        }
      }
    });
    await page.goto("/?tour=semantic");
    await runWalkthrough(page, semantic, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`semantic-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    const trainings = [...answersByJob.values()];
    expect(trainings.length, "two completed trainings").toBeGreaterThanOrEqual(2);
    // Trial 15 is (robin, is); outputs are [output_I, output_is, output_has, output_can].
    const ROBIN_IS = 15;
    const IS = { living: 0, animal: 3, bird: 6, fish: 7 };
    const HAS = { skin: 4, feathers: 5, wings: 6, gills: 7 };
    const [afterRelevant, afterDiscounted] = [trainings.at(-2)!, trainings.at(-1)!];
    const [, isA, hasA, canA] = afterRelevant[ROBIN_IS];
    expect(isA[IS.bird], "bird").toBeGreaterThan(0.7);
    expect(isA[IS.living], "living").toBeGreaterThan(0.9);
    expect(isA[IS.fish], "not a fish").toBeLessThan(0.25);
    expect(Math.max(...hasA, ...canA), "has/can quiet when asked 'is'").toBeLessThan(0.2);
    const [, isB, hasB] = afterDiscounted[ROBIN_IS];
    expect(isB[IS.bird], "still a bird").toBeGreaterThan(0.7);
    for (const f of ["skin", "feathers", "wings"] as const) {
      expect(hasB[HAS[f]], `${f} about 0.5`).toBeGreaterThan(0.35);
      expect(hasB[HAS[f]], `${f} about 0.5`).toBeLessThan(0.65);
    }
    expect(hasB[HAS.gills], "no gills").toBeLessThan(0.15);
  });
});

test.describe(`Guided walkthrough: ${conflict.title}`, () => {
  /**
   * The course's conflict-monitoring module (#57): open the Botvinick model,
   * run the incongruent and congruent trial types, then sharpen TASK DEMAND
   * and run the incongruent one again. The lesson is checked on the model's
   * own decision energy from each run, not just that the steps ran:
   * incongruent far above congruent, and the edit bringing it back down.
   */
  test("runs incongruent and congruent trials, then resolves the conflict with control", async ({ page }) => {
    test.setTimeout(300_000);
    // Each run's last trial: [COLOR HIDDEN, RESPONSE, DECISION ENERGY, WORD HIDDEN, TASK DEMAND].
    const lastTrials: number[][][] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/api/model/run") && r.request().method() === "POST" && r.ok()) {
        const data = await r.json().catch(() => null);
        const last = data?.results?.at(-1)?.output as (string | number[])[] | undefined;
        if (last) lastTrials.push(last.map(asVector));
      }
    });
    await page.goto("/?tour=conflict");
    await runWalkthrough(page, conflict, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`conflict-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    expect(lastTrials.length, "three runs").toBe(3);
    const RESPONSE = 1, ENERGY = 2, TASK_DEMAND = 4;
    const [incongruent, congruent, controlled] = lastTrials;
    expect(incongruent[ENERGY][0], "incongruent energy").toBeCloseTo(1.87, 1);
    expect(congruent[ENERGY][0], "congruent energy").toBeCloseTo(0.82, 1);
    expect(incongruent[ENERGY][0]).toBeGreaterThan(2 * congruent[ENERGY][0]);
    // On the incongruent trial the word wins; on the congruent one red does.
    expect(incongruent[RESPONSE][1]).toBeGreaterThan(incongruent[RESPONSE][0]);
    expect(congruent[RESPONSE][0]).toBeGreaterThan(0.9);
    // After gain 2 on TASK DEMAND: word-reading demand suppressed, red wins,
    // energy about half of what it was.
    expect(controlled[TASK_DEMAND][1], "word-reading demand").toBeLessThan(0.2);
    expect(controlled[RESPONSE][0]).toBeGreaterThan(controlled[RESPONSE][1]);
    expect(controlled[ENERGY][0], "energy after control").toBeLessThan(1.1);
  });
});

test.describe(`Guided walkthrough: ${ego.title}`, () => {
  /**
   * The course's EGO notebook (#55): open the library's EGO model, set up for
   * Coffee Shop World, and run the same twelve visits blocked and then
   * interleaved. The lesson is checked on the model's own predictions, not
   * just that the runs finished: on the last trial (state 7, after 6, in the
   * cue-10 shop) blocked puts most of PREDICTION on 7, while interleaved
   * splits it between 7 and 8, the two shops' next states.
   */
  test("learns the coffee shops blocked, and confuses them interleaved", async ({ page }) => {
    test.setTimeout(300_000);
    // Each run's PREDICTION, trial by trial. Outputs are
    // [EM: PREVIOUS STATE [RETRIEVED], EM: CONTEXT [RETRIEVED], PREDICTION].
    const predictions: number[][][] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/api/model/run") && r.request().method() === "POST" && r.ok()) {
        const data = await r.json().catch(() => null);
        const results = data?.results as { output: (string | number[])[] }[] | undefined;
        if (results?.length) predictions.push(results.map((t) => asVector(t.output[2])));
      }
    });
    await page.goto("/?tour=ego");
    await runWalkthrough(page, ego, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`ego-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    expect(predictions.length, "two runs").toBe(2);
    const [blocked, interleaved] = predictions;
    expect(blocked.length).toBe(60);
    // Trial 60 is state 7: unit 6, counting from 0. State 8 is unit 7.
    const last = 59, STATE_7 = 6, STATE_8 = 7;
    expect(blocked[last][STATE_7], "blocked predicts 7").toBeCloseTo(0.93, 1);
    expect(blocked[last][STATE_8], "and not 8").toBeLessThan(0.1);
    expect(interleaved[last][STATE_7], "interleaved: 7 about half").toBeCloseTo(0.48, 1);
    expect(interleaved[last][STATE_8], "interleaved: 8 about half").toBeCloseTo(0.47, 1);
  });
});

test.describe(`Guided walkthrough: ${iscci.title}`, () => {
  /**
   * The course's ISC-CI notebook (#58): open the model, run the notebook's
   * test untrained, then train the demo's 24 episodes. Checked on the
   * numbers the walkthrough quotes: untrained, every context is 0.1 and every
   * answer 0.5; trained, the last pass gets all 24 answers right while the
   * context label stays unsure (it memorized; it didn't infer).
   */
  test("runs the owl and falcon test, then trains on 24 episodes", async ({ page }) => {
    test.setTimeout(300_000);
    // Outputs are [context_label, response].
    const runs: number[][][] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/api/model/run") && r.request().method() === "POST" && r.ok()) {
        const data = await r.json().catch(() => null);
        const results = data?.results as { output: (string | number[])[] }[] | undefined;
        if (results?.length) runs.push(results.map((t) => t.output.flatMap(asVector)));
      }
    });
    const lastPassByJob = new Map<string, { output: number[][] }[]>();
    page.on("response", async (r) => {
      const m = r.url().match(/\/api\/jobs\/([^/?]+)$/);
      if (m && r.request().method() === "GET" && r.ok()) {
        const snap = await r.json().catch(() => null);
        const results = snap?.result?.results as { output: number[][] }[] | undefined;
        if (snap?.status === "done" && results && !lastPassByJob.has(m[1])) lastPassByJob.set(m[1], results);
      }
    });
    await page.goto("/?tour=iscci");
    await runWalkthrough(page, iscci, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`iscci-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    expect(runs.length, "one run").toBe(1);
    for (const trial of runs[0]) {
      // Ten context units at 0.1, then yes and no at 0.5.
      for (const v of trial.slice(0, 10)) expect(v).toBeCloseTo(0.1, 2);
      for (const v of trial.slice(10)) expect(v).toBeCloseTo(0.5, 2);
    }

    const trainings = [...lastPassByJob.values()];
    expect(trainings.length, "one completed training").toBeGreaterThanOrEqual(1);
    const lastPass = trainings.at(-1)!;
    const targets = iscci.steps.find((s) => s.id === "train")!.done.lastTraining!.targets.response as number[][];
    expect(lastPass.length).toBe(24);
    lastPass.forEach((t, i) => {
      const [label, answer] = t.output.map((v) => asVector(v as unknown as string | number[]));
      const right = targets[i][0] === 1 ? answer[0] : answer[1];
      expect(right, `episode ${i + 1} answered right`).toBeGreaterThan(0.9);
      expect(Math.max(...label), `episode ${i + 1}: context still unsure`).toBeLessThan(0.5);
    });
  });
});

test.describe(`Guided walkthrough: ${hebbian.title}`, () => {
  /**
   * The course's Hebbian learning notebook (#48): run a triangle alone through
   * the untrained layer, then train the three objects with that triangle as a
   * fourth trial. Checked on the numbers the walkthrough quotes: untrained,
   * only the triangle comes on; the weight change falls as 1/epoch to 0.05;
   * on the last pass the triangle alone comes out as the large blue triangle.
   */
  test("recalls a whole object from a partial cue after Hebbian learning", async ({ page }) => {
    test.setTimeout(300_000);
    const runs: number[][] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/api/model/run") && r.request().method() === "POST" && r.ok()) {
        const data = await r.json().catch(() => null);
        const results = data?.results as { output: (string | number[])[] }[] | undefined;
        if (results?.length) runs.push(results[0].output.flatMap(asVector));
      }
    });
    const jobs = new Map<string, { values: number[]; lastPass: { output: (string | number[])[] }[] }>();
    page.on("response", async (r) => {
      const m = r.url().match(/\/api\/jobs\/([^/?]+)$/);
      if (m && r.request().method() === "GET" && r.ok()) {
        const snap = await r.json().catch(() => null);
        if (snap?.status === "done" && snap.result?.epochLosses && !jobs.has(m[1])) {
          jobs.set(m[1], { values: snap.result.epochLosses, lastPass: snap.result.results });
        }
      }
    });
    await page.goto("/?tour=hebbian");
    await runWalkthrough(page, hebbian, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`hebbian-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    expect(runs.length, "one run").toBe(1);
    expect(runs[0], "untrained: the triangle alone").toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1]);

    const trainings = [...jobs.values()];
    expect(trainings.length, "one completed training").toBeGreaterThanOrEqual(1);
    const { values, lastPass } = trainings.at(-1)!;
    expect(values.length).toBe(20);
    values.forEach((v, i) => expect(v, `epoch ${i + 1}`).toBeCloseTo(1 / (i + 1), 6));
    expect(lastPass.length).toBe(4);
    const recalled = lastPass[3].output.flatMap(asVector);
    [0, 0, 1, 0, 0, 1, 0, 0, 1].forEach((want, i) =>
      expect(recalled[i], `the cue recalls the large blue triangle, unit ${i}`).toBeCloseTo(want, 6),
    );
  });
});

test.describe(`Guided walkthrough: ${td.title}`, () => {
  /**
   * The course's reinforcement learning notebook (#52): train the TD demo with
   * the cue on throughout, then again with the cue coming on part-way through.
   * Checked on the numbers the walkthrough quotes: the first error falls from
   * about 0.06 to zero; the second starts at 0.1, dips to about 0.02, and
   * climbs back to about 0.1 (it moved to the cue rather than vanishing).
   */
  test("the prediction error vanishes, then with a late cue moves to the cue", async ({ page }) => {
    test.setTimeout(300_000);
    const trainings: number[][] = [];
    const seen = new Set<string>();
    page.on("response", async (r) => {
      const m = r.url().match(/\/api\/jobs\/([^/?]+)$/);
      if (m && r.request().method() === "GET" && r.ok()) {
        const snap = await r.json().catch(() => null);
        if (snap?.status === "done" && snap.result?.epochLosses && !seen.has(m[1])) {
          seen.add(m[1]);
          trainings.push(snap.result.epochLosses);
        }
      }
    });
    await page.goto("/?tour=td");
    await runWalkthrough(page, td, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`td-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    expect(trainings.length, "two completed trainings").toBe(2);
    const [conditioning, lateCue] = trainings;
    expect(conditioning.length).toBe(20);
    expect(conditioning[0], "starts at about 0.06").toBeCloseTo(0.06, 2);
    expect(conditioning.at(-1)!, "falls to zero").toBeLessThan(1e-6);

    expect(lateCue.length).toBe(50);
    expect(lateCue[0], "all at the reward: 0.1").toBeCloseTo(0.1, 3);
    expect(Math.min(...lateCue), "dips to about 0.02").toBeCloseTo(0.0225, 3);
    expect(lateCue.at(-1)!, "back to about 0.1").toBeCloseTo(0.0987, 3);
  });
});

test.describe(`Guided walkthrough: ${vectors.title}`, () => {
  /**
   * The course's first notebook (#45), scalars, vectors and matrices, as a
   * PsyNeuLink projection: run the notebook's b, its B, and the identity,
   * change one weight in the Inspector, then scale vector_b by 2. Checked on
   * vector_c's own outputs, the numbers the walkthrough has the learner check
   * by hand.
   */
  test("a projection multiplies by its matrix, one weight at a time", async ({ page }) => {
    test.setTimeout(240_000);
    const runs: number[][][] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/api/model/run") && r.request().method() === "POST" && r.ok()) {
        const data = await r.json().catch(() => null);
        const results = data?.results as { output: (string | number[])[] }[] | undefined;
        if (results?.length) runs.push(results.map((t) => t.output.flatMap(asVector)));
      }
    });
    await page.goto("/?tour=vectors");
    await runWalkthrough(page, vectors, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`vectors-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    expect(runs, "five runs, each vector_c per trial").toEqual([
      [[50, 122]], // A b
      [[50, 122], [68, 167]], // A B, a column at a time
      [[1, 4], [2, 5], [3, 6]], // the identity gives the weights back
      [[113, 122]], // one weight 1 -> 10: only the first output moves
      [[20, 8], [4, 10], [6, 12]], // slope 2: every number doubles
    ]);
  });
});

test.describe(`Guided walkthrough: ${hopfield.title}`, () => {
  /**
   * The course's Hopfield notebook (#49) as a RecurrentTransferMechanism: the
   * notebook's noisy Z comes back as Z in one update and stays; a cue between
   * A and Z goes to the nearer, Z; with four letters stored, the same noisy Z
   * settles on X. Checked on the network's own output, trial by trial.
   */
  test("recalls Z from a noisy copy, and fails once overloaded", async ({ page }) => {
    test.setTimeout(240_000);
    const Z = [1, 1, 1, 1, 1, -1, -1, -1, 1, -1, -1, -1, 1, -1, -1, -1, 1, -1, -1, -1, 1, 1, 1, 1, 1];
    const X = [1, -1, -1, -1, 1, -1, 1, -1, 1, -1, -1, -1, 1, -1, -1, -1, 1, -1, 1, -1, 1, -1, -1, -1, 1];
    const runs: number[][][] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/api/model/run") && r.request().method() === "POST" && r.ok()) {
        const data = await r.json().catch(() => null);
        const results = data?.results as { output: (string | number[])[] }[] | undefined;
        if (results?.length) runs.push(results.map((t) => t.output.flatMap(asVector).map(Math.round)));
      }
    });
    await page.goto("/?tour=hopfield");
    await runWalkthrough(page, hopfield, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`hopfield-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    expect(runs.length, "three runs").toBe(3);
    const [noisy, between, overloaded] = runs;
    const cue = hopfield.steps.find((s) => s.id === "run-noisy")!.done.lastRunInputs!.hopfield[0];
    expect(noisy[0], "trial 1 is the cue").toEqual(cue);
    noisy.slice(1).forEach((t, i) => expect(t, `noisy Z, update ${i + 1}`).toEqual(Z));
    between.slice(1).forEach((t, i) => expect(t, `A over Z, update ${i + 1}`).toEqual(Z));
    expect(overloaded[1], "four letters: not Z after one update").not.toEqual(Z);
    overloaded.slice(3).forEach((t, i) => expect(t, `four letters, update ${i + 3}`).toEqual(X));
  });
});

/** A run result's output vector: numpy's repr ("[0.5 0.8]") or a list. */
function asVector(v: string | number[]): number[] {
  if (Array.isArray(v)) return v.map(Number);
  return v.replace(/[[\]]/g, "").trim().split(/\s+/).map(Number);
}
