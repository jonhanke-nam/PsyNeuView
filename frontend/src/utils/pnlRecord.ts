/**
 * The Mac app's record of the PsyNeuLink source vs. what is installed
 * (PsyNeuView-MacApp#9, PsyNeuView#16).
 *
 * The app keeps a record ("github:devel", "pypi", "local:<path>") of the
 * source it set up, and rebuilds environments from it. A switch made here,
 * through the backend, didn't reach that record, so an app update could put
 * a user back on GitHub `devel` from their own checkout. Settings compares
 * the two and offers to bring the record in step.
 */
import type { PsyNeuLinkInfo } from "./pnlSources";

/** The live install in the record's own words, or null when it can't be said. */
export function recordForLiveInstall(live: PsyNeuLinkInfo | null | undefined): string | null {
  if (!live) return null;
  switch (live.source) {
    case "editable":
      return live.path ? `local:${live.path}` : null;
    case "github":
      // A managed clone also reads as GitHub; the app records it by branch.
      return live.branch ? `github:${live.branch}` : null;
    case "pypi":
      return "pypi";
    default:
      return null;
  }
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

function normalise(record: string): string {
  return record.startsWith("local:") ? `local:${trimSlash(record.slice("local:".length))}` : record;
}

/**
 * When the app's record and the live install disagree: what each says, for
 * the Settings notice. Null when they agree, or when either is unknown (an
 * app before the record was shared, or an install we can't describe) —
 * never claim a mismatch we can't show.
 */
export function pnlRecordMismatch(
  record: string | null | undefined,
  live: PsyNeuLinkInfo | null | undefined,
): { record: string; live: string } | null {
  if (!record) return null;
  const liveRecord = recordForLiveInstall(live);
  if (!liveRecord) return null;
  return normalise(record) === normalise(liveRecord) ? null : { record, live: liveRecord };
}

/** "github:devel" → "GitHub (devel)"; "local:/p" → "your checkout at /p"; "pypi" → "an official release (PyPI)". */
export function describeRecord(record: string): string {
  if (record === "pypi") return "an official release (PyPI)";
  if (record.startsWith("github:")) return `GitHub (${record.slice("github:".length)})`;
  if (record.startsWith("local:")) return `your checkout at ${record.slice("local:".length)}`;
  return record;
}
