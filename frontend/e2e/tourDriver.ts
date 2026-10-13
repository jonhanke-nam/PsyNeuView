/**
 * The CI half of "one list, two runners" (#1181).
 *
 * Walks a walkthrough the way a learner would: read the step, check the app is
 * asking for what the step says, do the thing, check the app agrees it is
 * done. The in-app overlay reads the same file.
 *
 * That shared file is the point. A spec that re-describes the walkthrough in
 * its own words is a second copy, and a second copy drifts — the doc says one
 * thing, the app does another, and nothing notices. Here, changing a step's
 * wording changes what this asserts, automatically.
 *
 * It reads the YAML from disk rather than importing the app's parser: this
 * suite drives the built app from outside and does not compile app modules
 * into itself. The file is data, so both can have it without sharing code.
 */
import { expect, type Page } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

import { clickCanvasNode } from "./test-base";

export interface TourStep {
  id: string;
  anchor: { node?: string; testid?: string };
  instruct: string;
  /** The caption, read aloud when narration is on (#1310). */
  say?: string;
  /** The pointer glides to the anchor before the instruction shows (#1310). */
  pointer?: boolean;
  done: {
    selectedNode?: string;
    nodeExists?: string;
    trialsAtLeast?: number;
    runsAtLeast?: number;
    paramEquals?: { node: string; param: string; value: string };
    lastRunInputs?: Record<string, Array<number | number[]>>;
    functionIs?: { node: string; type: string };
    lastTraining?: {
      targets?: Record<string, Array<number | number[]>>;
      inputs?: Record<string, Array<number | number[]>>;
      epochsAtLeast?: number;
    };
    visible?: string;
    hidden?: string;
    next?: true;
    traceStepAtLeast?: number;
    fileNamed?: string;
  };
  act?: {
    selectNode?: string;
    addFromPalette?: string;
    runModel?: boolean;
    newModel?: string;
    openModel?: string;
    setParameter?: { node: string; param: string; value: string };
    setTrialInputs?: Record<string, Array<number | number[]>>;
    setFunction?: { node: string; type: string };
    train?: {
      inputs: Record<string, Array<number | number[]>>;
      /** Left out for a model that learns without targets (Hebbian, #48). */
      targets?: Record<string, Array<number | number[]>>;
      epochs: number;
    };
    pickSet?: { tab: "run" | "learn"; name: string };
    click?: string;
    next?: true;
    pressKey?: string;
    undo?: true;
    redo?: true;
    replaceInCode?: { find: string; replace: string };
  };
}

export interface Walkthrough {
  id: string;
  title: string;
  model?: string;
  orientation?: number;
  docs?: string | string[];
  developerMode?: boolean;
  minutes?: number;
  steps: TourStep[];
}

const WALKTHROUGH_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/walkthroughs",
);

export function loadWalkthrough(id: string): Walkthrough {
  const text = readFileSync(path.join(WALKTHROUGH_DIR, `${id}.yaml`), "utf8");
  return yaml.load(text) as Walkthrough;
}

/**
 * Perform the learner's part of a step.
 *
 * An unknown or missing action throws rather than passing: a step the driver
 * cannot act on would otherwise hang until the step's own timeout and report
 * as a vague failure, when the real problem is a walkthrough asking for
 * something CI has never been taught to do.
 */
async function act(page: Page, step: TourStep): Promise<void> {
  // The orientation's verbs (#1310): plain UI actions on stable test ids.
  if (step.act?.click) {
    await page.getByTestId(step.act.click).click();
    return;
  }
  if (step.act?.next) {
    await page.getByTestId("tour-next").click();
    return;
  }
  if (step.act?.pressKey) {
    await page.keyboard.press(step.act.pressKey);
    return;
  }
  if (step.act?.undo) {
    await page.getByTestId("undo-button").click();
    return;
  }
  if (step.act?.redo) {
    await page.getByTestId("redo-button").click();
    return;
  }
  if (step.act?.replaceInCode) {
    // What a learner does: select the text in the editor and type over it.
    // The walkthrough names only the fragment it changes, not the file.
    const { find, replace } = step.act.replaceInCode;
    const editor = page.locator(".cm-content").first();
    await expect(editor).toBeVisible();
    const continues = Boolean(step.act.pickSet || step.act.runModel);
    // The app runs an edited buffer from a preview copy it writes after the
    // edit. Running before that lands would run the code as it was (#49).
    const previewed = continues
      ? page.waitForResponse(
          (r) => r.url().includes("/api/model/preview") && r.request().method() === "POST",
          { timeout: 30_000 },
        )
      : null;
    // Find the fragment in the editor's own text, which CodeMirror keeps on
    // its view, reached through the content element. Not the rendered text:
    // CodeMirror draws only the lines near the view, and its innerText gives
    // a blank line twice, so retyping the whole file from it doubled every
    // blank line in the Hopfield demo (#49).
    const found = await editor.evaluate((el, fragment) => {
      type View = {
        state: { doc: { toString(): string } };
        dispatch(tr: { selection: { anchor: number; head: number }; scrollIntoView: boolean }): void;
        focus(): void;
      };
      const view = (el as unknown as { cmTile?: { root?: { view?: View } } }).cmTile?.root?.view;
      if (!view) return "no-view";
      const at = view.state.doc.toString().indexOf(fragment);
      if (at < 0) return "missing";
      view.focus();
      view.dispatch({ selection: { anchor: at, head: at + fragment.length }, scrollIntoView: true });
      return "selected";
    }, find);
    if (found === "no-view") {
      throw new Error(`walkthrough step "${step.id}": can't read the code editor's text (has CodeMirror moved its view?)`);
    }
    if (found === "missing") throw new Error(`walkthrough step "${step.id}": "${find}" is not in the editor`);
    await page.keyboard.insertText(replace);
    if (!previewed) return;
    await previewed;
    await expect(page.getByTestId("status-bar")).toHaveCount(0, { timeout: 30_000 });
  }
  if (step.act?.openModel) {
    // Open the menu unless an earlier step left it open: the button toggles.
    if (!(await page.getByTestId("open-menu-list").isVisible())) {
      await page.getByTestId("open-menu").click();
    }
    // As a button, by exact name. Plain text would also match the step's own
    // instruction whenever it names the model, as "Open the Bistable
    // Attractor demo" does.
    await page.getByRole("button", { name: step.act.openModel, exact: true }).click();
    // Wait for the load to finish ("Loading demo: …" in the status bar), on
    // the app's own 30 s load budget. The step's check below allows 10 s,
    // which a big model (EGO: a nested EMComposition) can exceed on a CI
    // runner (#55).
    await expect(page.getByTestId("status-bar")).toHaveCount(0, { timeout: 30_000 });
    return;
  }
  if (step.act?.newModel) {
    await page.getByTestId("open-menu").click();
    await page.getByRole("button", { name: /New Model/ }).click();
    const name = page.locator('input[placeholder="my_model"]');
    await expect(name).toBeVisible();
    await name.fill(step.act.newModel);
    await name.press("Enter");
    return;
  }
  if (step.act?.addFromPalette) {
    const type = step.act.addFromPalette;
    const palette = page.getByTestId("palette-sidebar");
    await palette.getByPlaceholder("Search components...").fill(type);
    // By tooltip, not visible text: the palette shows a short display label
    // ("Transfer"), and `exact` keeps "TransferMechanism" off
    // "RecurrentTransferMechanism", which the same search also returns.
    await palette.getByTitle(`${type} \u2014 drag or click to add`, { exact: true }).click();
    return;
  }
  if (step.act?.selectNode) {
    await clickNodeOrProjection(page, step.act.selectNode);
    return;
  }
  if (step.act?.setParameter) {
    const { node, param, value } = step.act.setParameter;
    // Select the node first: the Inspector shows one node's parameters at a
    // time, so there is nothing to type into until it is selected.
    const isProjection = await clickNodeOrProjection(page, node);
    await page.getByTestId("tab-inspector").click();
    // A projection's Inspector shows `matrix` twice, under its function and
    // under "Projection Parameters"; only the second edits the code (#45).
    const scope = isProjection ? page.getByTestId("projection-params") : page;
    const field = scope.getByTestId(`param-${param}`);
    await expect(field, `no "${param}" parameter on "${node}"`).toBeVisible({ timeout: 10_000 });
    // Click first, then fill, then Enter — the same order the live-editing
    // tutorial uses. The row commits from React state on Enter, so the input
    // has to be focused and the change flushed before the key lands.
    await field.click();
    await field.fill(value);
    // Committing rewrites the source and reloads the model. Wait for that
    // round trip, not just for the field to show the value (it does at once):
    // a reload landing after the next step has started used to reset what
    // that step had just set up (#57).
    const committed = page.waitForResponse(
      (r) => r.url().includes("/api/model/update-param") && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await field.press("Enter");
    await committed;
    await expect(field).toHaveValue(value, { timeout: 10_000 });
    await expect(page.getByTestId("status-bar")).toHaveCount(0, { timeout: 30_000 });
    return;
  }
  if (step.act?.pickSet) {
    const { tab, name } = step.act.pickSet;
    await page.getByTestId(`tab-${tab}`).click();
    const menu = page.getByTestId(tab === "run" ? "run-input-set" : "learn-training-set");
    await expect(menu, `no "From" menu in the ${tab} tab`).toBeVisible({ timeout: 10_000 });
    await menu.selectOption(name);
    if (tab === "learn") {
      await page.getByRole("button", { name: "Start Learning" }).click();
      // As with train: wait on the step's own check, not the final-loss line.
      await expect(page.getByTestId("tour-instruction")).toHaveText("✓ Done.", { timeout: 120_000 });
      return;
    }
    if (!step.act.runModel) return;
  }
  if (step.act?.train) {
    const { inputs, targets = {}, epochs } = step.act.train;
    await page.getByTestId("tab-learn").click();
    // The trial count first: it reshapes every grid. Every node's list has the
    // same length, since a training set is one list of trials. A model with no
    // targets (Hebbian) takes it from its inputs.
    const trials = (Object.values(targets)[0] ?? Object.values(inputs)[0])?.length ?? 1;
    await page.getByTestId("learn-trials").fill(String(trials));
    const cellId = (kind: string, node: string, t: number, i: number) => {
      const escaped = node.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`^learn-${kind}-${escaped}(-\\d+)?-${t}-${i}$`);
    };
    for (const [kind, sets] of [["input", inputs], ["output", targets]] as const) {
      for (const [node, rows] of Object.entries(sets)) {
        for (const [t, row] of rows.entries()) {
          const values = Array.isArray(row) ? row : [row];
          for (const [i, v] of values.entries()) {
            await page.getByTestId(cellId(kind, node, t, i)).fill(String(v));
          }
        }
      }
    }
    await page.getByTestId("learn-epochs").fill(String(epochs));
    await page.getByRole("button", { name: "Start Learning" }).click();
    // Wait on the step's own check, not the "final loss … after N epochs"
    // line: on a second training that line is still showing from the first.
    // The check passes only once *these* targets have finished training.
    // Generous, because training is the slowest thing a walkthrough does.
    await expect(page.getByTestId("tour-instruction")).toHaveText("✓ Done.", { timeout: 120_000 });
    return;
  }
  if (step.act?.setFunction) {
    const { node, type } = step.act.setFunction;
    await clickCanvasNode(page, node);
    await page.getByTestId("tab-inspector").click();
    // The Inspector's function-class dropdown, by its title: the one select
    // there whose job is exactly this.
    const picker = page.getByTitle(/^Change function class/);
    await expect(picker, `no function-class dropdown for "${node}"`).toBeVisible({ timeout: 10_000 });
    await picker.selectOption(type);
    // Switching rewrites the source and reloads the model; the step's `done`
    // reads the reloaded node, so wait for the dropdown to show the new class.
    await expect(page.getByTitle(/^Change function class/)).toHaveValue(type, { timeout: 30_000 });
    return;
  }
  if (step.act?.setTrialInputs) {
    // Through each node's Paste CSV box, one line per trial: what a learner
    // would do for ten trials rather than editing twenty cells. Pasting one
    // node's rows sets the shared trial count and zero-pads the others, so
    // filling the nodes in turn gives the right grid.
    await page.getByTestId("tab-run").click();
    for (const [node, trials] of Object.entries(step.act.setTrialInputs)) {
      // The card's id carries the node's model name; a long session can add
      // a "-<n>" suffix, matched the same way the canvas helpers do.
      const escaped = node.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const card = page.getByTestId(new RegExp(`^run-input-${escaped}(-\\d+)?$`));
      await expect(card, `no Run-panel input for "${node}"`).toBeVisible({ timeout: 10_000 });
      // Paste CSV is a <details> toggle and stays open after Apply, so a
      // second visit (the next step) must not click it shut again.
      const box = card.locator("textarea");
      if (!(await box.isVisible())) await card.getByText("Paste CSV").click();
      const csv = trials.map((t) => (Array.isArray(t) ? t.join(", ") : String(t))).join("\n");
      await box.fill(csv);
      await card.getByRole("button", { name: "Apply to cells" }).click();
    }
    // Setting inputs is only half a step: its `done` judges a completed run.
    if (!step.act.runModel) return;
  }
  if (step.act?.runModel) {
    await page.getByTestId("tab-run").click();
    await page.getByTestId("run-panel").getByRole("button", { name: /Run Model/ }).click();
    // The step's own `done` is what decides completion; this only keeps the
    // driver from racing ahead while the backend is still executing.
    await expect(
      page.getByTestId("run-panel").getByText(/Results \(\d+ trials?\)/),
    ).toBeVisible({ timeout: 60_000 });
    return;
  }
  throw new Error(
    `walkthrough step "${step.id}" has no action this driver understands — ` +
      `add a verb to tourDriver.act(), or give the step an \`act:\``,
  );
}

/**
 * Click a canvas node by name, or a projection's arrow when no node has that
 * name (#45): a lesson about a weight matrix selects the projection. Returns
 * whether it was a projection.
 */
async function clickNodeOrProjection(page: Page, name: string): Promise<boolean> {
  const edge = page.getByTestId(`rf__edge-${name}`);
  if ((await edge.count()) > 0) {
    // The arrow is a thin path; React Flow widens its hit area, but the
    // group itself can report as covered by the label, so click through.
    await edge.first().click({ force: true });
    return true;
  }
  await clickCanvasNode(page, name);
  return false;
}

/**
 * Walk every step: assert what is shown, act, assert completion.
 *
 * `onStep` runs while the step is still displayed — the hook the tutorial
 * specs use to capture their screenshots, so the docs show the real thing.
 */
export async function runWalkthrough(
  page: Page,
  walkthrough: Walkthrough,
  onStep?: (step: TourStep, index: number) => Promise<void>,
): Promise<void> {
  for (const [index, step] of walkthrough.steps.entries()) {
    const instruction = page.getByTestId("tour-instruction");

    await expect(instruction, `step "${step.id}" should be showing its instruction`).toHaveText(
      step.instruct,
      { timeout: 15_000 },
    );
    // When the step's node is off-screen the app offers to fit the graph, and
    // a learner would take it. A zoom saved with the model by an earlier test
    // (the demo walkthrough zooms in to check the ring scales) otherwise leaves
    // the node off-screen and the ring undrawn, and the step fails for a
    // reason no learner hits.
    const fit = page.getByTestId("tour-fit");
    await expect(page.getByTestId("tour-highlight").or(fit).first()).toBeVisible();
    if (await fit.isVisible()) await fit.click();
    await expect(
      page.getByTestId("tour-highlight"),
      `step "${step.id}" should be pointing at ${JSON.stringify(step.anchor)}`,
    ).toBeVisible();

    if (onStep) await onStep(step, index);

    await act(page, step);

    // "✓ Done." shows for a beat (1.2 s), then the next step takes over. An
    // action that waits on something slow to draw (150 trials of results on
    // CI) can come back after that beat, so the next step's instruction is
    // proof of completion too.
    const next = walkthrough.steps[index + 1];
    const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (next) {
      await expect(instruction, `step "${step.id}" should complete after its action`).toHaveText(
        new RegExp(`^(✓ Done\\.|${escape(next.instruct)})$`),
        { timeout: 10_000 },
      );
    } else {
      // The last step's "✓ Done." shows for 0.9 s, then the walkthrough ends
      // and its bar goes away. That is completion too.
      await expect
        .poll(
          async () =>
            (await page.getByTestId("tour-bar").count()) === 0 ||
            ((await instruction.count()) > 0 && (await instruction.innerText()).trim() === "✓ Done."),
          { message: `step "${step.id}" should complete after its action`, timeout: 10_000 },
        )
        .toBe(true);
    }
  }
}
