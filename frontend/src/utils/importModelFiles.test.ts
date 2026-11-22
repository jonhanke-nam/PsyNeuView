import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  IMPORT_ACCEPT_ATTR,
  IMPORTABLE_EXTENSIONS,
  importModelFiles,
  isImporting,
} from "./importModelFiles";
import { useModelStore } from "@/stores/modelStore";
import { useNotificationStore } from "@/stores/notificationStore";

function file(name: string, body = "") {
  return new File([body], name);
}

function notifications() {
  return useNotificationStore.getState().notifications ?? [];
}

beforeEach(() => {
  useNotificationStore.setState({ notifications: [] } as never);
  useModelStore.setState({ filePath: null, source: "", savedSource: "" } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("accept attribute", () => {
  it("covers exactly the formats the importer handles", () => {
    // The file picker must not offer a type the importer would then reject.
    expect(IMPORTABLE_EXTENSIONS).toEqual([".py", ".pnlproject"]);
    expect(IMPORT_ACCEPT_ATTR).toBe(".py,.pnlproject");
  });
});

describe("unsupported input", () => {
  it("rejects a file it cannot handle and says what is accepted", async () => {
    const ok = await importModelFiles([file("notes.txt")]);
    expect(ok).toBe(false);
    expect(JSON.stringify(notifications())).toMatch(/\.py or \.pnlproject/);
  });

  it("words the message for how the file arrived", async () => {
    await importModelFiles([file("notes.txt")], "drop");
    expect(JSON.stringify(notifications())).toMatch(/Drop a/);
    useNotificationStore.setState({ notifications: [] } as never);
    await importModelFiles([file("notes.txt")], "choose");
    expect(JSON.stringify(notifications())).toMatch(/Choose a/);
  });

  it("handles an empty selection without throwing", async () => {
    expect(await importModelFiles([])).toBe(false);
  });
});

describe("unsaved edits", () => {
  // The suite runs in vitest's `node` environment by design (pure logic, no
  // DOM), so `window` has to be stubbed rather than spied on.
  function stubConfirm(answer: boolean) {
    const confirm = vi.fn().mockReturnValue(answer);
    vi.stubGlobal("window", { confirm });
    return confirm;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not import when the user declines to discard them", async () => {
    useModelStore.setState({
      filePath: "/a/b.py", source: "edited", savedSource: "original",
    } as never);
    const confirm = stubConfirm(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(await importModelFiles([file("m.py", "x = 1")])).toBe(false);
    expect(confirm).toHaveBeenCalled();
    // The decisive part: nothing was sent to the server.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not prompt when there is nothing to lose", async () => {
    const confirm = stubConfirm(true);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ default_save_dir: "/models" }), { status: 200 }),
    );
    await importModelFiles([file("m.py", "x = 1")]);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("format precedence", () => {
  it("prefers a bundle over a loose .py in the same selection", async () => {
    // A bundle carries layout and sidecars; the .py beside it does not.
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({}), { status: 200 });
    });
    await importModelFiles([file("m.py"), file("m.pnlproject")]);
    expect(calls.some((u) => u.includes("import-project"))).toBe(true);
    expect(calls.some((u) => u.includes("save-source"))).toBe(false);
  });
});

describe("a dropped .py file (#227)", () => {
  type Reply = { status: number; body: unknown };
  /** Answers each endpoint from `replies`, recording the order of calls. */
  function serve(replies: Record<string, Reply>) {
    const calls: { url: string; body: unknown }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const key = Object.keys(replies).find((k) => u.endsWith(k));
      const r = key ? replies[key] : { status: 500, body: { detail: "unexpected" } };
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    return calls;
  }
  const loaded = {
    status: 200,
    body: { source: "x = 1", model: { compositions: [], lineMap: {} } },
  };

  it("creates a file whose name is new to the models folder, then opens it", async () => {
    // save-source answers 404 for a file that is not there yet; that answer,
    // not a thrown error, has to lead to save-as.
    const calls = serve({
      "/api/models/dirs": { status: 200, body: { default_save_dir: "/models" } },
      "/api/model/save-source": { status: 404, body: { detail: "File not found: /models/new.py" } },
      "/api/models/save-as": { status: 200, body: { file_path: "/models/new.py" } },
      "/api/model/load": loaded,
    });
    expect(await importModelFiles([file("new.py", "x = 1")], "drop")).toBe(true);

    expect(calls.map((c) => c.url)).toEqual([
      "/api/models/dirs", "/api/model/save-source", "/api/models/save-as", "/api/model/load",
    ]);
    expect(calls[2].body).toMatchObject({ source: "x = 1", file_name: "new.py" });
    expect(calls[3].body).toMatchObject({ file_path: "/models/new.py" });
    expect(useModelStore.getState().filePath).toBe("/models/new.py");
    expect(JSON.stringify(notifications())).not.toMatch(/Import failed/);
    expect(JSON.stringify(notifications())).toMatch(/Imported new\.py/);
  });

  it("writes over a file of that name already there, without save-as", async () => {
    const calls = serve({
      "/api/models/dirs": { status: 200, body: { default_save_dir: "/models" } },
      "/api/model/save-source": { status: 200, body: {} },
      "/api/model/load": loaded,
    });
    await importModelFiles([file("old.py", "x = 1")], "drop");
    expect(calls.some((c) => c.url.includes("save-as"))).toBe(false);
    expect(useModelStore.getState().filePath).toBe("/models/old.py");
  });

  it("says why, and loads nothing, when the file cannot be written", async () => {
    const calls = serve({
      "/api/models/dirs": { status: 200, body: { default_save_dir: "/models" } },
      "/api/model/save-source": { status: 404, body: { detail: "File not found" } },
      "/api/models/save-as": { status: 403, body: { detail: "That folder is read-only" } },
    });
    await importModelFiles([file("new.py", "x = 1")], "drop");
    expect(calls.some((c) => c.url.includes("/api/model/load"))).toBe(false);
    expect(JSON.stringify(notifications())).toMatch(/Import failed: That folder is read-only/);
  });
});

describe("reentrancy", () => {
  it("is not importing once a call settles", async () => {
    // One drop gesture fires several times; the guard must not latch on.
    await importModelFiles([file("notes.txt")]);
    expect(isImporting()).toBe(false);
  });
});
