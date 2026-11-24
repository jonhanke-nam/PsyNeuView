/**
 * Every browser spec is accounted for: CI runs it (`@ci`), or it says why not.
 *
 * `npm run test:e2e:ci` runs `playwright test --grep "@ci\b"`, so a spec is
 * in the CI e2e job exactly when it carries the tag. A tag is easy to drop by
 * accident (a rewritten describe, a copied test without its options), and
 * nothing would fail: the tests would just stop running in CI. So every spec
 * outside the tutorials must either carry `@ci` or have a `Not in CI: <why>`
 * line in its header comment, with one of the reasons the What's tested page knows
 * (scripts/test_map.py, NOT_IN_CI). Dropping the tag without writing down why
 * fails here.
 *
 * There used to be a checked-in list of the tagged files
 * (e2e/ci-specs.txt). Every pull request that added a spec edited it, so
 * they all conflicted with each other; the check reads the spec files instead
 * (#380).
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const E2E = path.resolve(import.meta.dirname, "../e2e");

// `@ci` inside a string literal: `{ tag: "@ci" }`, `tag: ["@smoke", "@ci"]`,
// or a title like "@ci something". A mention in a comment does not count.
const CI_TAG = /["'`][^"'`\n]*@ci\b/;

// The same reasons as NOT_IN_CI in scripts/test_map.py.
const NOT_IN_CI =
  /Not in CI:\s*(slow|needs a network|superseded|broken|measurement|pictures only|local only|should be added)\b/i;

/**
 * The spec's leading comment: a `/** *\/` block or a run of `//` lines, with
 * imports allowed before it. The same as `ts_header` in scripts/test_map.py.
 * Only a `Not in CI:` line here counts (#392): one further down, in a test's
 * comment or a string, is not the file saying why it stays out of CI.
 */
function headerComment(src: string): string {
  const body = src.replace(/^(\s*import[^;]*;\s*)+/, "");
  const block = /^\s*\/\*\*?([\s\S]*?)\*\//.exec(body);
  if (block) return block[1].split("\n").map((l) => l.replace(/^\s*\* ?/, "")).join("\n");
  const lines: string[] = [];
  for (const line of body.trimStart().split("\n")) {
    if (line.trim().startsWith("//")) lines.push(line.replace(/^\s*\/\/ ?/, ""));
    else if (lines.length || line.trim()) break;
  }
  return lines.join("\n");
}

/** Whether the spec's header says why it isn't in CI (#392). */
function saysNotInCi(src: string): boolean {
  return NOT_IN_CI.test(headerComment(src));
}

function specFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...specFiles(p));
    else if (name.endsWith(".spec.ts")) out.push(path.relative(E2E, p).split(path.sep).join("/"));
  }
  return out.sort();
}

const specs = specFiles(E2E).map((f) => ({ f, src: readFileSync(path.join(E2E, f), "utf8") }));
const tutorials = specs.filter(({ f }) => f.startsWith("tutorials/"));
const browser = specs.filter(({ f }) => !f.startsWith("tutorials/"));
// *.local.spec.ts are ignored by playwright.config.ts (testIgnore), so a tag
// there would claim a CI run that never happens.
const local = browser.filter(({ f }) => f.endsWith(".local.spec.ts"));

describe("CI e2e specs: every spec is tagged @ci or says why not", () => {
  it("finds the specs (a moved e2e folder must not pass by finding none)", () => {
    expect(browser.length).toBeGreaterThan(100);
    expect(browser.filter(({ src }) => CI_TAG.test(src)).length).toBeGreaterThan(100);
  });

  it("every browser spec is tagged @ci or has a 'Not in CI: <why>' line", () => {
    const unaccounted = browser
      .filter(({ f, src }) => (f.endsWith(".local.spec.ts") || !CI_TAG.test(src)) && !saysNotInCi(src))
      .map(({ f }) => f);
    expect(
      unaccounted,
      `Not tagged @ci and no 'Not in CI:' line in the header comment: ${unaccounted.join(", ")}.\n` +
        '  Should it run in CI? Tag its describe (or each top-level test) { tag: "@ci" }.\n' +
        "  Kept out on purpose? Add a header line 'Not in CI: <slow | needs a network | superseded | broken |\n" +
        "  measurement | pictures only | local only | should be added>: <why>'.",
    ).toEqual([]);
  });

  it("only a 'Not in CI:' line in the header comment counts (#392)", () => {
    const why = "Not in CI: slow: takes an hour.";
    expect(saysNotInCi(`/**\n * A spec.\n *\n * ${why}\n */\ntest("a", async () => {});\n`)).toBe(true);
    expect(saysNotInCi(`// A spec.\n// ${why}\ntest("a", async () => {});\n`)).toBe(true);
    expect(saysNotInCi(`import { test } from "./test-base";\n\n// ${why}\ntest("a", async () => {});\n`)).toBe(true);
    // Further down: in a test's comment, or a string, it does not count.
    expect(saysNotInCi(`/** A spec. */\ntest("a", async () => {\n  // ${why}\n});\n`)).toBe(false);
    expect(saysNotInCi(`// A spec.\n\nconst note = "${why}";\ntest("a", async () => {});\n`)).toBe(false);
    expect(saysNotInCi(`test("a", async () => {});\n/** ${why} */\n`)).toBe(false);
  });

  it("no *.local.spec.ts is tagged @ci (CI ignores those files)", () => {
    expect(local.filter(({ src }) => CI_TAG.test(src)).map(({ f }) => f)).toEqual([]);
  });

  it("no tutorial spec is tagged @ci (tutorials run in their own job)", () => {
    expect(tutorials.filter(({ src }) => CI_TAG.test(src)).map(({ f }) => f)).toEqual([]);
  });
});
