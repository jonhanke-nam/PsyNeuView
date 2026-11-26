// "Load from disk" takes the file as it is when clicked, not the text from
// when the change was first seen (#1).
import { describe, expect, it, vi } from "vitest";
import { readDiskVersion } from "./useFileWatcher";
import { useGraphSettings } from "@/stores/graphSettingsStore";

describe("readDiskVersion (#1)", () => {
  it("reads the file now, through the load endpoint", async () => {
    const doFetch = vi.fn(async () => new Response(JSON.stringify({ source: "newest", model: { nodes: [1] } }), { status: 200 }));
    const got = await readDiskVersion("/m/model.py", doFetch as unknown as typeof fetch);
    expect(got).toEqual({ source: "newest", model: { nodes: [1] } });
    const [url, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/model/load");
    expect(JSON.parse(init.body as string).file_path).toBe("/m/model.py");
  });

  it("returns null when the file can't be read, so the caller falls back", async () => {
    expect(await readDiskVersion("/m/x.py", (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch)).toBeNull();
    expect(await readDiskVersion("/m/x.py", (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
  });

  // #442: an outside edit is read through here, so it comes back in the view
  // this window shows, not the backend's default (nested).
  it.each([
    [{ flat: true, pytorch: false }],
    [{ flat: false, pytorch: true }],
    [{ flat: false, pytorch: false }],
  ])("asks for the view the window shows: %o", async (view) => {
    const before = useGraphSettings.getState();
    useGraphSettings.setState(view);
    try {
      const doFetch = vi.fn(async () => new Response(JSON.stringify({ source: "s", model: {} }), { status: 200 }));
      await readDiskVersion("/m/model.py", doFetch as unknown as typeof fetch);
      const [, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect({ flat: body.flat, pytorch: body.pytorch }).toEqual(view);
    } finally {
      useGraphSettings.setState({ flat: before.flat, pytorch: before.pytorch });
    }
  });
});
