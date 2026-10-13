/**
 * Proves the test harness wiring end-to-end (#147):
 *   playwright.config env vars → backend in test mode →
 *   /api/test/reset open → mutatingTest fixture fires it.
 *
 * If this passes we know readOnlyTest vs mutatingTest can be picked
 * meaningfully at the import site for surface tests added later.
 */
import { mutatingTest as test, expect } from "./test-base";

test.describe("@smoke harness", { tag: "@ci" }, () => {
  test("mutatingTest fixture reaches /api/test/reset", async ({ request }) => {
    // The fixture already posted to /api/test/reset before this body ran
    // (the test wouldn't have started otherwise). A second explicit call
    // confirms the endpoint is reachable and shape-stable.
    const resp = await request.post("/api/test/reset");
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body).toHaveProperty("worker_restarted", true);
    expect(body).toHaveProperty("cleared");
    expect(Array.isArray(body.cleared)).toBe(true);
  });
});
