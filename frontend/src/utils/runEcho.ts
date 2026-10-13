/**
 * Whether an input node's OUT row in the Run tab would only repeat its IN row
 * (#49). The Run tab drops it then; otherwise it is the model's answer (a
 * Hopfield layer is both input and output) and must be shown.
 */

/** The inputs a run submitted to one node: `trials[t]` is trial t's vector. */
export interface SubmittedNodeInput {
  name: string;
  varName: string;
  trials: number[][];
}

/** Every number in a (possibly nested) value, in order. */
function flatNumbers(v: unknown): number[] {
  if (typeof v === "number") return [v];
  if (Array.isArray(v)) return v.flatMap(flatNumbers);
  return [];
}

/**
 * Whether an input node's logged values are exactly what was submitted to it,
 * trial by trial — so its OUT row would only repeat its IN row (#49).
 */
export function echoesSubmitted(
  name: string,
  log: { trials: number[]; values: unknown[] },
  submitted: SubmittedNodeInput[] | null,
): boolean {
  const bare = (k: string) => k.replace(/-\d+$/, "");
  const input = (submitted || []).find((s) =>
    [s.name, s.varName].some((k) => k === name || bare(k) === bare(name)),
  );
  if (!input) return false;
  return log.trials.every((t, i) => {
    const sent = input.trials[t];
    if (sent === undefined) return false;
    const got = flatNumbers(log.values[i]);
    const want = flatNumbers(sent);
    return got.length === want.length && got.every((x, j) => Math.abs(x - want[j]) < 1e-9);
  });
}
