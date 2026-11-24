/**
 * The "Passed only on retry" job summary (#359): scripts/retry-summary.mjs
 * reads the merged Playwright JSON report and lists every test that failed
 * first and passed on retry.
 */
import { describe, expect, it } from "vitest";
import { retriedTests, summaryMarkdown } from "../scripts/retry-summary.mjs";

const attempt = (status: string, message?: string) => ({
  status,
  retry: 0,
  ...(message ? { error: { message } } : {}),
});

// The shape Playwright's JSON reporter writes: a top-level suite per file,
// describe blocks as nested suites, specs holding one test per project.
const report = {
  suites: [
    {
      title: "a.spec.ts",
      file: "a.spec.ts",
      specs: [
        {
          title: "passes",
          file: "a.spec.ts",
          line: 3,
          tests: [{ projectName: "chromium", status: "expected", results: [attempt("passed")] }],
        },
        {
          title: "fails then passes",
          file: "a.spec.ts",
          line: 7,
          tests: [
            {
              projectName: "chromium",
              status: "flaky",
              results: [
                attempt("failed", "\u001b[31mError: expected 1 | got 2\u001b[39m\n    at a.spec.ts:8"),
                attempt("passed"),
              ],
            },
          ],
        },
      ],
      suites: [
        {
          title: "a group",
          file: "a.spec.ts",
          specs: [
            {
              title: "times out then passes",
              file: "a.spec.ts",
              line: 12,
              tests: [
                {
                  projectName: "chromium",
                  status: "flaky",
                  results: [attempt("timedOut", "Test timeout of 120000ms exceeded."), attempt("passed")],
                },
              ],
            },
            {
              title: "fails twice",
              file: "a.spec.ts",
              line: 20,
              tests: [
                {
                  projectName: "chromium",
                  status: "unexpected",
                  results: [attempt("failed", "boom"), attempt("failed", "boom")],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("retry summary (#359)", () => {
  it("lists only the tests that passed on retry, with describe titles", () => {
    const tests = retriedTests(report);
    expect(tests.map((t) => t.title)).toEqual(["fails then passes", "a group › times out then passes"]);
    expect(tests[1]).toMatchObject({ file: "a.spec.ts", line: 12, attempts: 2, project: "chromium" });
  });

  it("keeps the first line of the failed attempt's error, without colour codes", () => {
    expect(retriedTests(report)[0].error).toBe("Error: expected 1 | got 2");
    expect(retriedTests(report)[1].error).toBe("Test timeout of 120000ms exceeded.");
  });

  it("writes a Markdown table, escaping pipes inside cells", () => {
    const md = summaryMarkdown(report);
    expect(md).toContain("## Passed only on retry");
    expect(md).toContain("2 tests failed first, then passed on retry.");
    expect(md).toContain("| fails then passes | `a.spec.ts:7` | Error: expected 1 \\| got 2 |");
    expect(md).not.toContain("fails twice");
  });

  it("says so when nothing needed a retry", () => {
    expect(summaryMarkdown({ suites: [] })).toContain("No test needed a retry.");
  });
});
