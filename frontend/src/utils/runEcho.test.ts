/**
 * An input node's OUT row is dropped only when it would repeat its IN row (#49).
 *
 * The Run tab hid every input node's logged value, since it usually equals
 * what was submitted. A node that is both input and output breaks that: the
 * Hopfield layer's answer is not its cue, so the run's whole result was hidden.
 */
import { describe, expect, it } from "vitest";

import { echoesSubmitted } from "./runEcho";

const sent = [{ name: "vector_b", varName: "vector_b", trials: [[7, 8, 9], [1, 0, 0]] }];

describe("echoesSubmitted", () => {
  it("is true when the node passed its input through unchanged", () => {
    expect(echoesSubmitted("vector_b", { trials: [0, 1], values: [[[7, 8, 9]], [[1, 0, 0]]] }, sent)).toBe(true);
  });

  it("is false when the node changed it (slope 2, or a Hopfield update)", () => {
    expect(echoesSubmitted("vector_b", { trials: [0, 1], values: [[[14, 16, 18]], [[2, 0, 0]]] }, sent)).toBe(false);
  });

  it("is false for a node nothing was submitted to", () => {
    expect(echoesSubmitted("vector_c", { trials: [0], values: [[[50, 122]]] }, sent)).toBe(false);
  });

  it("matches a session-suffixed log name", () => {
    expect(echoesSubmitted("vector_b-3", { trials: [0, 1], values: [[[7, 8, 9]], [[1, 0, 0]]] }, sent)).toBe(true);
  });
});
