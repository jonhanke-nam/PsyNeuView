/**
 * The activity log's rules (#1287): the cap, the order, `~` for the home
 * folder, and no secrets — the value of a key that looks like a token or a
 * password is never recorded, however it gets in.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  ACTION_LOGGING_KEY,
  ACTIVITY_CAP,
  abbreviateHome,
  actionLoggingOn,
  activityCount,
  activityEntries,
  activitySequence,
  clearActivity,
  entriesSince,
  isSensitiveKey,
  latestAction,
  onActionLoggingChanged,
  onRecorded,
  record,
  recordSettingChanged,
  scrub,
  scrubText,
  setActionLogging,
} from "./activityLog";

// The action-logging setting is remembered in localStorage (#177). The suite
// runs on node, not jsdom: stub it, as nodeOutlineStore.test.ts does.
const stored = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (stored.has(k) ? stored.get(k)! : null),
    setItem: (k: string, v: string) => void stored.set(k, String(v)),
    removeItem: (k: string) => void stored.delete(k),
    clear: () => stored.clear(),
  },
});

beforeEach(() => {
  stored.clear();
  clearActivity();
});

describe("recording", () => {
  it("keeps entries in the order they were recorded, each with an ISO time", () => {
    record("menu", "Open ▾ › Open from path...");
    record("model", "Opened /Users/someone/models/a.py");
    const entries = activityEntries();
    expect(entries.map((e) => e.kind)).toEqual(["menu", "model"]);
    expect(entries[0].t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(entries[0].t <= entries[1].t).toBe(true);
  });

  it("keeps the last entries once the cap is reached", () => {
    for (let i = 0; i < ACTIVITY_CAP + 150; i++) record("run", `run ${i}`);
    expect(activityCount()).toBe(ACTIVITY_CAP);
    const entries = activityEntries();
    expect(entries[0].text).toBe("run 150");
    expect(entries[entries.length - 1].text).toBe(`run ${ACTIVITY_CAP + 149}`);
  });

  it("returns copies, so a reader can't change the log", () => {
    record("run", "x", { a: 1 });
    const entries = activityEntries();
    entries[0].text = "changed";
    entries[0].data!.a = 2;
    expect(activityEntries()[0]).toEqual(expect.objectContaining({ text: "x", data: { a: 1 } }));
  });

  it("leaves `data` out when it would be empty", () => {
    record("run", "x", {});
    expect(activityEntries()[0]).not.toHaveProperty("data");
  });
});

describe("the home folder is ~", () => {
  it("in text and in data, on macOS and Linux homes, and only at the start of a path", () => {
    expect(abbreviateHome("/Users/someone/models/a.py")).toBe("~/models/a.py");
    expect(abbreviateHome("/home/someone")).toBe("~");
    expect(abbreviateHome("Opened /Users/someone/a.py (from /home/other/b.py)")).toBe("Opened ~/a.py (from ~/b.py)");
    expect(abbreviateHome("/opt/Users/x/y")).toBe("/opt/Users/x/y");
    record("model", "Saved /Users/someone/a.py", { path: "/Users/someone/a.py", nested: { paths: ["/home/u/x"] } });
    const [entry] = activityEntries();
    expect(entry.text).toBe("Saved ~/a.py");
    expect(entry.data).toEqual({ path: "~/a.py", nested: { paths: ["~/x"] } });
  });
});

describe("no secrets", () => {
  it("knows a sensitive key when it sees one", () => {
    for (const key of ["token", "githubToken", "GITHUB_TOKEN", "password", "client_secret", "apiKey", "Authorization"]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
    for (const key of ["developer-mode", "graph-pointer", "path", "reportSendWith"]) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });

  it("drops the value of a sensitive setting, and records a safe one", () => {
    recordSettingChanged("github-token", "ghp_abcdef");
    recordSettingChanged("graph-pointer", "hand");
    recordSettingChanged("mac-report-send-to");
    const [secret, safe, address] = activityEntries();
    expect(secret.data).toEqual({ key: "github-token" });
    expect(secret.text).toBe("github-token changed");
    expect(JSON.stringify(secret)).not.toContain("ghp_");
    expect(safe.data).toEqual({ key: "graph-pointer", value: "hand" });
    expect(safe.text).toBe("graph-pointer = hand");
    expect(address.data).toEqual({ key: "mac-report-send-to" });
  });

  it("redacts sensitive keys anywhere in data, and credentials in links", () => {
    record("psyneulink", "Cloning https://x-access-token:ghp_secret@github.com/org/repo", {
      settings: { password: "hunter2", repo: "org/repo", credentials: { user: "x" }, tokens: ["a"] },
    });
    const [entry] = activityEntries();
    expect(entry.text).toBe("Cloning https://[redacted]@github.com/org/repo");
    expect(entry.data).toEqual({ settings: { password: "[redacted]", repo: "org/repo", credentials: "[redacted]", tokens: "[redacted]" } });
    expect(scrubText("https://user:pw@host/x")).toBe("https://[redacted]@host/x");
  });

  it("keeps a boolean or a number under a sensitive key: it says one exists, not what it is", () => {
    expect(scrub({ capabilities: { github_token: true, token_count: 2, api_key: null } })).toEqual({
      capabilities: { github_token: true, token_count: 2, api_key: null },
    });
  });

  it("scrub leaves out what isn't JSON and keeps the rest", () => {
    expect(scrub({ f: () => 1, n: 1, s: new Set(["/Users/u/a"]), u: undefined, nil: null })).toEqual({
      n: 1,
      s: ["~/a"],
      nil: null,
    });
  });
});

describe("the action-logging setting (#177)", () => {
  it("is on unless Settings turned it off, and remembers the choice", () => {
    expect(actionLoggingOn()).toBe(true);
    setActionLogging(false);
    expect(actionLoggingOn()).toBe(false);
    expect(stored.get(ACTION_LOGGING_KEY)).toBe("off");
    clearActivity();
    expect(actionLoggingOn()).toBe(false);
    setActionLogging(true);
    expect(stored.get(ACTION_LOGGING_KEY)).toBe("on");
  });

  it("off: user actions aren't recorded, but errors, messages, waits and what the app did are", () => {
    setActionLogging(false);
    record("menu", "Open › a");
    record("click", "Toolbar › Save");
    record("canvas", "Selected node a");
    record("edit", "Moved node a");
    record("step", "Step 2 of 9");
    record("error", "Model error: x");
    record("notification", "Loaded", { type: "success" });
    record("run", "Run started: c");
    record("model", "Saved ~/a.py");
    expect(activityEntries().map((e) => e.kind)).toEqual(["setting", "error", "notification", "run", "model"]);
    expect(activityEntries()[0].text).toBe("activity-log-actions = off");
  });

  it("turning it off drops the actions already recorded and keeps the rest", () => {
    record("menu", "Open › a");
    record("error", "Model error: x");
    record("click", "Toolbar › Save");
    const changes: boolean[] = [];
    const stop = onActionLoggingChanged((on) => changes.push(on));
    setActionLogging(false);
    stop();
    expect(activityEntries().map((e) => e.text)).toEqual(["Model error: x", "activity-log-actions = off"]);
    expect(changes).toEqual([false]);
    // Setting it off again changes nothing and records nothing.
    setActionLogging(false);
    expect(activityCount()).toBe(2);
  });

  it("off: no wait is linked to an action, because the log doesn't have it", () => {
    record("run", "Run started: c");
    expect(latestAction()?.text).toBe("Run started: c");
    setActionLogging(false);
    expect(latestAction()).toBeNull();
  });

  it("a click, a canvas selection and an edit are actions a wait can be from", () => {
    record("click", "Toolbar › Save");
    expect(latestAction()?.text).toBe("Toolbar › Save");
    record("edit", "Moved node a");
    expect(latestAction()?.text).toBe("Moved node a");
    record("notification", "Saved", { type: "success" });
    expect(latestAction()?.text).toBe("Moved node a");
  });
});

describe("sequence numbers, for the saver (#177)", () => {
  it("gives what was recorded after a sequence number, through the cap and a clear-out", () => {
    const seen: string[] = [];
    const stop = onRecorded((e) => seen.push(e.text));
    record("menu", "a");
    const mark = activitySequence();
    record("error", "b");
    record("click", "c");
    expect(entriesSince(mark).map((e) => e.text)).toEqual(["b", "c"]);
    expect(entriesSince(0).map((e) => e.text)).toEqual(["a", "b", "c"]);
    expect(seen).toEqual(["a", "b", "c"]);
    stop();
    // Dropping the actions doesn't renumber what's left.
    setActionLogging(false);
    expect(entriesSince(mark).map((e) => e.text)).toEqual(["b", "activity-log-actions = off"]);
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("past the cap, what fell off is no longer returned", () => {
    for (let i = 0; i < ACTIVITY_CAP + 10; i++) record("run", `r${i}`);
    expect(entriesSince(0)).toHaveLength(ACTIVITY_CAP);
    expect(entriesSince(0)[0].text).toBe("r10");
    expect(entriesSince(ACTIVITY_CAP + 8).map((e) => e.text)).toEqual([`r${ACTIVITY_CAP + 8}`, `r${ACTIVITY_CAP + 9}`]);
  });
});
