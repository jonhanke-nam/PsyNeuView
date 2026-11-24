// Types for retry-summary.mjs, for src/retrySummary.test.ts (#359).

export interface RetriedTest {
  /** The spec file, relative to the test directory. */
  file: string;
  line: number;
  /** describe titles and the test title, joined with " › ". */
  title: string;
  project: string;
  /** How many attempts ran, the passing one included. */
  attempts: number;
  /** The first line of the failed attempt's error, or "". */
  error: string;
}

export function retriedTests(report: unknown): RetriedTest[];
export function summaryMarkdown(report: unknown): string;
