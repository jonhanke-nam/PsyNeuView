// "Load from disk" takes the file as it is when clicked, not the text from
// when the change was first seen (#1).
import { describe, expect, it, vi } from "vitest";
import { readDiskVersion } from "./useFileWatcher";

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
});
