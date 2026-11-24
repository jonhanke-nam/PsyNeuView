/**
 * Does a saved run match the open file? (#357)
 *
 * "matches": it ran exactly the source that is open. "earlier": the same file,
 * since edited (its source hash differs, #337). "other-file": it ran another
 * file. `null`: can't tell (a record from before runs were hashed, or the
 * open source not hashed yet).
 */
export type RecordVersion = "matches" | "earlier" | "other-file";

export function recordVersion(
  record: { modelPath?: string; sourceHash?: string },
  openPath: string | null,
  openSourceHash: string | null,
): RecordVersion | null {
  if (openPath && record.modelPath && record.modelPath !== openPath) return "other-file";
  if (!record.sourceHash || !openSourceHash) return null;
  return record.sourceHash === openSourceHash ? "matches" : "earlier";
}
