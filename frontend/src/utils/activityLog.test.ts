/**
 * The activity log's rules (#1287): the cap, the order, `~` for the home
 * folder, and no secrets — the value of a key that looks like a token or a
 * password is never recorded, however it gets in.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  ACTIVITY_CAP,
  abbreviateHome,
  activityCount,
  activityEntries,
  clearActivity,
  isSensitiveKey,
  record,
  recordSettingChanged,
  scrub,
  scrubText,
} from "./activityLog";

beforeEach(() => clearActivity());

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
