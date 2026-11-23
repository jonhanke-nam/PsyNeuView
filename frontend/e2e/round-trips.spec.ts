/**
 * Round trips: an edit in the graph reaches the code and survives a reload;
 * an edit in the code reaches the graph (#319).
 *
 * For each kind of edit, both ways where the other specs don't already:
 *
 *   edit              graph → code → reopen        code → graph
 *   add a node        here                         preview-not-save.spec.ts
 *   delete a node     here                         here
 *   rename a node     here                         here
 *   connect           here                         here
 *   shape an arrow    edge-curve-handles.spec.ts   (a shape lives in the layout file, not the code)
 *   a parameter       here, from the Inspector     here
 *
 * "Reopen" opens the file afresh in a new page, as after quitting, and the
 * graph must come back with the same nodes and arrows. Code edits are typed
 * into PsyNeuView's own editor; external-edit-sync.spec.ts covers a save from
 * another program.
 */
import { readOnlyTest as test, expect, closePalette } from "./test-base";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

type Page = import("@playwright/test").Page;

const BASE = `import psyneulink as pnl

a = pnl.TransferMechanism(name='a', input_shapes=[2])
b = pnl.TransferMechanism(name='b', input_shapes=[2], function=pnl.Logistic(gain=1.7))
c = pnl.TransferMechanism(name='c', input_shapes=[2])

a_to_b = pnl.MappingProjection(sender=a, receiver=b, name='a_to_b')

comp = pnl.Composition(name='comp')
comp.add_node(a)
comp.add_node(b)
comp.add_node(c)
comp.add_projection(a_to_b)
`;

function scratch(source = BASE): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "roundtrip319-")), "roundtrip.py");
  writeFileSync(file, source);
  return file;
}

async function open(page: Page, file: string, palette = false) {
  await page.goto("/");
  if (!palette) await closePalette(page);
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 90_000 });
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const written = (page: Page, endpoint = "/api/model/structural-change") =>
  page.waitForResponse((r) => r.url().endsWith(endpoint) && r.ok(), { timeout: 60_000 });

/** The graph as a list of its nodes and arrows, by id. */
async function graph(page: Page) {
  const ids = (sel: string) =>
    page.locator(sel).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id ?? "").sort());
  return { nodes: await ids(".react-flow__node-mechanismNode"), arrows: await ids(".react-flow__edge") };
}

/** Read the graph until two reads a moment apart agree. */
async function settledGraph(page: Page) {
  let last = JSON.stringify(await graph(page));
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(300);
    const now = JSON.stringify(await graph(page));
    if (now === last) break;
    last = now;
  }
  return JSON.parse(last) as Awaited<ReturnType<typeof graph>>;
}

/** Opened afresh, the graph is the one the edit left. */
async function expectSameAfterReopen(page: Page, file: string) {
  const before = await settledGraph(page);
  await open(page, file);
  expect(await settledGraph(page)).toEqual(before);
  return before;
}

async function typeIntoEditor(page: Page, text: string) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

/** The Inspector's input holding `value` (the parameter values are what tell them apart). */
async function inspectorInput(page: Page, value: string) {
  await expect
    .poll(async () => page.locator("input").evaluateAll((els, v) => els.some((e) => (e as HTMLInputElement).value === v), value), {
      timeout: 30_000,
    })
    .toBe(true);
  const all = page.locator("input");
  const n = await all.count();
  for (let k = 0; k < n; k++) if ((await all.nth(k).inputValue().catch(() => "")) === value) return all.nth(k);
  throw new Error(`no input holds ${value}`);
}

test.describe("round trips between the graph and the code (#319)", { tag: "@ci" }, () => {
  test("add a node: placed in the graph, written to the code, there after reopening", async ({ page }) => {
    test.setTimeout(120_000);
    const file = scratch();
    await open(page, file, true);
    await page.getByPlaceholder("Search components…").fill("TransferMechanism");
    const item = page.locator('[data-testid="palette-item"][data-type="TransferMechanism"]').first();
    await item.click();
    const pane = (await page.locator(".react-flow__pane").boundingBox())!;
    const done = written(page);
    await page.mouse.click(pane.x + pane.width * 0.85, pane.y + pane.height * 0.85);
    await done;
    await expect(node(page, "New_TransferMechanism_1")).toBeVisible({ timeout: 30_000 });
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(/^New_TransferMechanism_1 = pnl\.TransferMechanism\(/m);
    expect(source).toContain("comp.add_node(New_TransferMechanism_1)");
    const after = await expectSameAfterReopen(page, file);
    expect(after.nodes).toContain("New_TransferMechanism_1");
  });

  test("delete a node: from the graph to the code and back; and from the code to the graph", async ({ page }) => {
    test.setTimeout(150_000);
    const file = scratch();
    await open(page, file);
    page.on("dialog", (d) => void d.accept());
    await node(page, "c").click({ button: "right" });
    const done = written(page);
    await page.getByTestId("node-menu-delete").click();
    await done;
    await expect(node(page, "c")).toHaveCount(0, { timeout: 30_000 });
    expect(readFileSync(file, "utf8")).not.toMatch(/^c = /m);
    const after = await expectSameAfterReopen(page, file);
    expect(after.nodes).toEqual(["a", "b"]);

    // The other way: delete b, and the arrow into it, in the code.
    await typeIntoEditor(
      page,
      readFileSync(file, "utf8")
        // (The graph's writes may leave the last line without a newline.)
        .replace(/^b = .*(\n|$)/m, "")
        .replace(/^a_to_b = .*(\n|$)/m, "")
        .replace(/^comp\.add_node\(b\)(\n|$)/m, "")
        .replace(/^comp\.add_projection\(a_to_b\)(\n|$)/m, ""),
    );
    await expect(node(page, "b")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  });

  test("rename a node: in the Inspector, to the code and back; and in the code, to the graph", async ({ page }) => {
    test.setTimeout(150_000);
    const file = scratch();
    await open(page, file);
    await node(page, "c").click();
    await page.getByTitle("Double-click to rename").first().dblclick();
    const input = page.locator("input:focus");
    const done = written(page, "/api/model/rename-node");
    await input.fill("renamed");
    await input.press("Enter");
    await done;
    await expect(node(page, "renamed")).toBeVisible({ timeout: 30_000 });
    expect(readFileSync(file, "utf8")).toMatch(/name='renamed'/);
    const after = await expectSameAfterReopen(page, file);
    expect(after.nodes).toContain("renamed");

    await typeIntoEditor(page, readFileSync(file, "utf8").replace("name='a'", "name='typed_name'"));
    await expect(node(page, "typed_name")).toBeVisible({ timeout: 60_000 });
    await expect(node(page, "a")).toHaveCount(0);
  });

  test("connect: dragged in the graph, to the code and back; and typed in the code, to the graph", async ({ page }) => {
    test.setTimeout(150_000);
    const file = scratch();
    await open(page, file);
    const arrows = page.locator(".react-flow__edge");
    await expect(arrows).toHaveCount(1, { timeout: 30_000 });
    const connector = node(page, "b").getByTestId("node-connector");
    await expect(async () => {
      await node(page, "b").hover();
      await expect(connector).toHaveCSS("opacity", "1", { timeout: 1000 });
    }).toPass({ timeout: 30_000 });
    const cb = (await connector.boundingBox())!;
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.mouse.down();
    const t = (await node(page, "c").boundingBox())!;
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
    const done = written(page);
    await page.mouse.up();
    await done;
    await expect(arrows).toHaveCount(2, { timeout: 30_000 });
    expect(readFileSync(file, "utf8")).toMatch(/pnl\.MappingProjection\(\s*sender=b[.\s]/);
    const after = await expectSameAfterReopen(page, file);
    expect(after.arrows).toHaveLength(2);

    await typeIntoEditor(
      page,
      `${readFileSync(file, "utf8")}\na_to_c = pnl.MappingProjection(sender=a, receiver=c, name='a_to_c')\ncomp.add_projection(a_to_c)\n`,
    );
    await expect(arrows).toHaveCount(3, { timeout: 60_000 });
  });

  test("a parameter: changed in the Inspector, to the code and back; and in the code, to the Inspector", async ({ page }) => {
    test.setTimeout(150_000);
    const file = scratch();
    await open(page, file);
    await node(page, "b").click();
    const gain = await inspectorInput(page, "1.7");
    const done = written(page, "/api/model/update-param");
    await gain.click();
    await gain.fill("2.5");
    await gain.press("Enter");
    await done;
    await expect.poll(() => readFileSync(file, "utf8")).toMatch(/gain\s*=\s*2\.5/);
    await expectSameAfterReopen(page, file);
    await node(page, "b").click();
    await inspectorInput(page, "2.5");

    await typeIntoEditor(page, readFileSync(file, "utf8").replace(/gain\s*=\s*2\.5/, "gain=3.3"));
    await expect(page.locator(".react-flow__node").first()).toBeVisible();
    await node(page, "b").click();
    await inspectorInput(page, "3.3");
  });
});
