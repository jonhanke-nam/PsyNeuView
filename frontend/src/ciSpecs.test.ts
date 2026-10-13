/**
 * The CI e2e set is the specs tagged `@ci`; e2e/ci-specs.txt names their files.
 *
 * `npm run test:e2e:ci` runs `playwright test --grep "@ci\b"`, so a spec is
 * in the CI e2e job exactly when it carries the tag. A tag is easy to drop by
 * accident (a rewritten describe, a copied test without its options), and
 * nothing would fail — the tests would just stop running in CI. This check
 * keeps the set of files carrying `@ci` equal to the checked-in list.
 *
 * The list is one file per line, sorted, so two PRs adding different specs
 * rarely touch the same line.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const E2E = path.resolve(import.meta.dirname, "../e2e");
const LIST = path.join(E2E, "ci-specs.txt");

// `@ci` inside a string literal: `{ tag: "@ci" }`, `tag: ["@smoke", "@ci"]`,
// or a title like "@ci something". A mention in a comment does not count.
const CI_TAG = /["'`][^"'`\n]*@ci\b/;

function specFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...specFiles(p));
    else if (name.endsWith(".spec.ts")) out.push(path.relative(E2E, p).split(path.sep).join("/"));
  }
  return out;
}

const listed = readFileSync(LIST, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

const tagged = specFiles(E2E)
  .filter((f) => CI_TAG.test(readFileSync(path.join(E2E, f), "utf8")))
  .sort();

describe("CI e2e specs (@ci tag ↔ e2e/ci-specs.txt)", () => {
  it("the list is sorted, one file per line, with no repeats", () => {
    const sorted = [...new Set(listed)].sort();
    expect(listed, "keep frontend/e2e/ci-specs.txt sorted with each file once").toEqual(sorted);
  });

  it("the files tagged @ci are exactly the files listed", () => {
    const missingFromList = tagged.filter((f) => !listed.includes(f));
    const missingTag = listed.filter((f) => !tagged.includes(f));
    const problems: string[] = [];
    if (missingFromList.length)
      problems.push(
        `Tagged @ci but not in frontend/e2e/ci-specs.txt: ${missingFromList.join(", ")}.\n` +
          "  Added a spec to CI? Add its file to frontend/e2e/ci-specs.txt (sorted, one per line).",
      );
    if (missingTag.length)
      problems.push(
        `Listed in frontend/e2e/ci-specs.txt but no @ci tag in the file: ${missingTag.join(", ")}.\n` +
          '  Removed it from CI on purpose? Remove its line from ci-specs.txt. Otherwise put back its { tag: "@ci" }.',
      );
    expect(problems.join("\n"), problems.join("\n")).toBe("");
  });

  it("no tutorial spec is tagged @ci (tutorials run in their own job)", () => {
    expect(tagged.filter((f) => f.startsWith("tutorials/"))).toEqual([]);
  });
});
