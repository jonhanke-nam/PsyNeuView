/**
 * The timeline (#177): the merge order, what each kind is marked as, a wait
 * as its start and stop lines, errors linked to their cause, and the text
 * file's one time format.
 */
import { describe, expect, it } from "vitest";

import type { ActivityEntry } from "./activityLog";
import { formatTimeline, formatTimelineTime, timelineFrom } from "./timeline";

const T0 = Date.parse("2026-11-03T09:15:04.850Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

function wait(start: number, label: string, stop: number | null, outcome: string | null, extra: Record<string, unknown> = {}): ActivityEntry {
  return {
    t: at(start),
    kind: "wait",
    text: label,
    data: {
      label,
      waitKind: "work",
      stop: stop === null ? null : at(stop),
      durationMs: (stop ?? 10_000) - start,
      outcome,
      action: null,
      actionCertain: null,
      ...extra,
    },
  };
}

describe("timelineFrom", () => {
  it("lays actions, events, waits and errors out in time order, each marked", () => {
    const lines = timelineFrom(
      [
        { t: at(0), kind: "menu", text: "Open menu opened" },
        wait(5, "GET /api/psyneulink-examples/status", 90_150, "ok", { action: "Open menu opened", actionCertain: true }),
        { t: at(15_150), kind: "menu", text: "Open › Cohen Huston1994" },
        wait(15_250, "POST /api/model/load", 16_250, "ok", { action: "Open › Cohen Huston1994", actionCertain: false }),
        { t: at(16_300), kind: "model", text: "Opened ~/models/x.py" },
        { t: at(16_350), kind: "notification", text: "Loaded x.py", data: { type: "success" } },
      ],
      T0 + 100_000,
    );
    expect(lines.map((l) => `${l.t.slice(11, 23)} ${l.source} ${l.text}`)).toEqual([
      "09:15:04.850 action Open menu opened",
      "09:15:04.855 wait start · GET /api/psyneulink-examples/status · from: Open menu opened",
      "09:15:20.000 action Open › Cohen Huston1994",
      "09:15:20.100 wait start · POST /api/model/load · likely from: Open › Cohen Huston1994",
      "09:15:21.100 wait stop · POST /api/model/load · 1.000 s · ok",
      "09:15:21.150 event Opened ~/models/x.py",
      "09:15:21.200 message Shown: Loaded x.py",
      "09:16:35.000 wait stop · GET /api/psyneulink-examples/status · 90.145 s · ok",
    ]);
  });

  it("marks each kind: a run started is an action, finished an event; an error message is an error", () => {
    const sources = timelineFrom([
      { t: at(0), kind: "click", text: "Toolbar › Save" },
      { t: at(1), kind: "canvas", text: "Selected node a" },
      { t: at(2), kind: "edit", text: "Moved node a" },
      { t: at(3), kind: "step", text: "Step 2 of 9" },
      { t: at(4), kind: "run", text: "Run started: c" },
      { t: at(5), kind: "run", text: "Run finished: c" },
      { t: at(6), kind: "learn", text: "Learning failed to start" },
      { t: at(7), kind: "setting", text: "graph-pointer = hand" },
      { t: at(8), kind: "file", text: "Model changed on disk: ~/a.py" },
      { t: at(9), kind: "psyneulink", text: "PsyNeuLink switch requested: x" },
      { t: at(10), kind: "walkthrough", text: "Walkthrough started: orientation" },
      { t: at(11), kind: "notification", text: "Couldn't save", data: { type: "error" } },
      { t: at(12), kind: "notification", text: "Careful", data: { type: "warning" } },
      { t: at(13), kind: "notification", text: "FYI", data: { type: "info" } },
      { t: at(14), kind: "error", text: "Model error: NameError" },
      { t: at(15), kind: "logging", text: "Page loaded" },
    ]).map((l) => [l.source, l.text]);
    expect(sources).toEqual([
      ["action", "Toolbar › Save"],
      ["action", "Selected node a"],
      ["action", "Moved node a"],
      ["action", "Step 2 of 9"],
      ["action", "Run started: c"],
      ["event", "Run finished: c"],
      ["event", "Learning failed to start"],
      ["event", "graph-pointer = hand"],
      ["event", "Model changed on disk: ~/a.py"],
      ["event", "PsyNeuLink switch requested: x"],
      ["event", "Walkthrough started: orientation"],
      ["error", "Error shown: Couldn't save · likely from: Run started: c"],
      ["message", "Warning shown: Careful"],
      ["message", "Notice shown: FYI"],
      ["error", "Model error: NameError · likely from: Run started: c"],
      ["page", "Page loaded"],
    ]);
  });

  it("links an error to the wait that had just failed and the latest action, while they're recent", () => {
    const lines = timelineFrom([
      { t: at(0), kind: "menu", text: "Open › Stroop" },
      wait(100, "POST /api/model/load", 1100, "failed", { detail: "HTTP 500" }),
      { t: at(1200), kind: "notification", text: "Failed to load", data: { type: "error" } },
      // Too long after the failed wait and the action: no link.
      { t: at(40_000), kind: "error", text: "Model error: later" },
    ]);
    expect(lines.filter((l) => l.source === "error").map((l) => l.text)).toEqual([
      "Error shown: Failed to load · after: POST /api/model/load failed (HTTP 500) · likely from: Open › Stroop",
      "Model error: later",
    ]);
  });

  it("shows a wait still running as one line with the time so far, and a busy-wheel stretch without an outcome", () => {
    const lines = timelineFrom(
      [
        wait(0, "GET /api/x", null, null, { action: "Open menu opened", actionCertain: true, durationMs: 2722 }),
        wait(0, "busy", 3000, null, { waitKind: "wheel" }),
        wait(10, "GET /api/settings/pnl-updates", 1500, "ok", { waitKind: "background" }),
      ],
      T0 + 2722,
    );
    expect(lines.map((l) => l.text)).toEqual([
      "still waiting · GET /api/x · 2.722 s so far · from: Open menu opened",
      "start · Busy wheel",
      "start · GET /api/settings/pnl-updates (background)",
      "stop · GET /api/settings/pnl-updates (background) · 1.490 s · ok",
      "stop · Busy wheel · 3.000 s",
    ]);
  });

  it("is empty for nothing", () => {
    expect(timelineFrom([])).toEqual([]);
    expect(formatTimeline([])).toBe("");
  });
});

describe("the text file", () => {
  it("writes one time format, local to the zone given, with the source padded", () => {
    expect(formatTimelineTime("2026-11-03T09:15:04.850Z", "America/New_York")).toBe("2026-11-03 04:15:04.850");
    expect(formatTimelineTime("2026-11-03T23:15:04.005Z", "Asia/Tokyo")).toBe("2026-11-04 08:15:04.005");
    expect(formatTimelineTime("not a time")).toBe("not a time");
    const text = formatTimeline(
      [
        { t: "2026-11-03T09:15:04.850Z", source: "action", text: "Open menu opened" },
        { t: "2026-11-03T09:15:04.855Z", source: "wait", text: "start · GET /api/x" },
      ],
      "UTC",
    );
    expect(text).toBe("2026-11-03 09:15:04.850  action   Open menu opened\n2026-11-03 09:15:04.855  wait     start · GET /api/x\n");
  });
});
