// Inspector and canvas edits flush typed code first; the flush must not write
// over a change made in another editor (#1).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModelStore } from "./modelStore";
import { useExternalChangeStore } from "./externalChangeStore";

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("flushBuffer (#1)", () => {
  beforeEach(() => {
    useExternalChangeStore.getState().clearPending();
    useModelStore.setState({ filePath: "/m/model.py", source: "typed", savedSource: "as loaded", bundleOrigin: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends what it believes is on disk, so the server can refuse", async () => {
    const fetchMock = vi.fn(() => json(409, { detail: { disk_source: "theirs", disk_model: null } }));
    vi.stubGlobal("fetch", fetchMock);
    await useModelStore.getState().flushBuffer();
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ file_path: "/m/model.py", source: "typed", base_source: "as loaded" });
  });

  it("on a conflict, asks instead of writing, and tells the caller not to go on", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json(409, { detail: { disk_source: "theirs", disk_model: { nodes: [] } } })));
    const ok = await useModelStore.getState().flushBuffer();
    expect(ok).toBe(false);
    expect(useExternalChangeStore.getState().pending).toEqual({
      filePath: "/m/model.py",
      source: "theirs",
      model: { nodes: [] },
    });
    // The typed code is kept for the user to decide on.
    expect(useModelStore.getState().source).toBe("typed");
  });

  it("does nothing when there is nothing unsaved", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useModelStore.setState({ source: "same", savedSource: "same" });
    expect(await useModelStore.getState().flushBuffer()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
