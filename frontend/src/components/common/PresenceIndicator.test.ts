import { describe, it, expect, beforeEach } from "vitest";
import { usePresenceStore } from "@/stores/presenceStore";

beforeEach(() => {
  usePresenceStore.setState({ available: false, others: [] });
});

describe("presence store", () => {
  it("starts unable to tell, not alone", () => {
    // The distinction the whole feature rests on: before the backend says
    // anything, we do not know — and must not imply nobody is there.
    const s = usePresenceStore.getState();
    expect(s.available).toBe(false);
    expect(s.others).toEqual([]);
  });

  it("records who else is connected", () => {
    usePresenceStore.getState().setPresence(true, ["alex"]);
    expect(usePresenceStore.getState().others).toEqual(["alex"]);
    expect(usePresenceStore.getState().available).toBe(true);
  });

  it("distinguishes alone from cannot-tell", () => {
    usePresenceStore.getState().setPresence(true, []);
    expect(usePresenceStore.getState().available).toBe(true);

    usePresenceStore.getState().setPresence(false, []);
    expect(usePresenceStore.getState().available).toBe(false);
  });

  it("stops claiming to know when the socket drops", () => {
    // Losing the connection makes the answer unknown, not "nobody".
    usePresenceStore.getState().setPresence(true, ["alex"]);
    usePresenceStore.getState().reset();
    expect(usePresenceStore.getState().available).toBe(false);
    expect(usePresenceStore.getState().others).toEqual([]);
  });
});
