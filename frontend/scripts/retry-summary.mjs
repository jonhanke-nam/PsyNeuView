// Lists the tests that passed only on retry, from a Playwright JSON report
// (#359). CI runs it on the merged report and appends the result to the job
// summary, so a test that needed a second attempt is visible even though the
// run is green:
//
//   node scripts/retry-summary.mjs playwright-report/results.json >> "$GITHUB_STEP_SUMMARY"
//
// The failed attempt's trace and screenshot are in the merged HTML report
// (the playwright-results-<run id> artifact), under the test's "Retry #0" tab.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";

/** The first line of an attempt's error, without terminal colour codes. */
function firstErrorLine(result) {
  const message = result?.error?.message ?? result?.errors?.[0]?.message ?? "";
  const line = message.replace(/\u001b\[[0-9;]*m/g, "").split("\n").find((l) => l.trim());
  return line ? line.trim() : "";
}

/**
 * Every test whose final outcome is "flaky" (Playwright's word for failed,
 * then passed on retry), in report order.
 */
export function retriedTests(report) {
  const found = [];
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status !== "flaky") continue;
        const results = test.results ?? [];
        const failed = results.find((r) => r.status !== "passed" && r.status !== "skipped");
        found.push({
          file: spec.file ?? suite.file ?? "",
          line: spec.line ?? 0,
          title: [...titles, spec.title].join(" › "),
          project: test.projectName ?? "",
          attempts: results.length,
          error: firstErrorLine(failed),
        });
      }
    }
    for (const child of suite.suites ?? []) {
      walk(child, [...titles, child.title]);
    }
  };
  // A top-level suite is a file; its title is the path, which goes in `file`.
  for (const top of report.suites ?? []) walk(top, []);
  return found;
}

const escapeCell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The job-summary section, as Markdown. */
export function summaryMarkdown(report) {
  const tests = retriedTests(report);
  const lines = ["## Passed only on retry", ""];
  if (tests.length === 0) {
    lines.push("No test needed a retry.");
    return lines.join("\n") + "\n";
  }
  lines.push(
    `${tests.length} test${tests.length === 1 ? "" : "s"} failed first, then passed on retry. ` +
      "The failed attempt's trace and screenshot are in the merged HTML report " +
      "(the `playwright-results-<run id>` artifact), under the test's \"Retry #0\" tab.",
    "",
    "| Test | Where | First attempt's error |",
    "| --- | --- | --- |",
  );
  for (const t of tests) {
    const error = t.error.length > 160 ? `${t.error.slice(0, 157)}...` : t.error;
    lines.push(`| ${escapeCell(t.title)} | \`${t.file}:${t.line}\` | ${escapeCell(error)} |`);
  }
  return lines.join("\n") + "\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/retry-summary.mjs <results.json>");
    process.exit(2);
  }
  process.stdout.write(summaryMarkdown(JSON.parse(readFileSync(file, "utf8"))));
}
