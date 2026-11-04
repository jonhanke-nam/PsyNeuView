/**
 * The timeline (#177): everything the page knows about, in time order, each
 * line marked with what it is — an action, an event, an error, a message, a
 * wait starting or stopping — for a problem report's `timeline.txt`.
 *
 * Built from activity entries: the log, the wait log (each wait becomes a
 * start line and a stop line, so a server line between them lands between
 * them), and the saved copies of both from earlier page loads. The Mac app
 * merges in the server log's lines, marked `server`, and writes the file in
 * local time (PsyNeuView-MacApp, ReportTimeline.swift); a report from an
 * older app, or the Settings ▸ About download, has the page's lines alone,
 * which still read on their own.
 *
 * An error carries a link to its cause, the way a wait does (utils/
 * waitLog.ts): the latest action before it, marked likely, and the wait
 * that had just failed, when one had. Order alone can mislead when work
 * overlaps.
 */

import type { ActivityEntry } from "./activityLog";

export type TimelineSource =
  /** The user did something. */
  | "action"
  /** The app did something: a model opened, a setting changed, a run finished. */
  | "event"
  | "error"
  /** A message shown that wasn't an error. */
  | "message"
  /** A wait starting, stopping, or still running. */
  | "wait"
  /** The log itself: a page loaded, action logging off. */
  | "page"
  /** A server log line (added by the Mac app). */
  | "server";

export interface TimelineLine {
  /** ISO, UTC. */
  t: string;
  source: TimelineSource;
  text: string;
}

/** An action older than this isn't the likely cause of an error. */
export const LIKELY_ACTION_MS = 30_000;
/** A wait that failed within this before an error is named as what it followed. */
export const FAILED_WAIT_MS = 5000;

const STARTED = /\b(started|requested)\b/;

function sourceOf(e: ActivityEntry): TimelineSource {
  switch (e.kind) {
    case "menu":
    case "click":
    case "canvas":
    case "edit":
    case "step":
      return "action";
    case "run":
    case "learn":
      return STARTED.test(e.text) && !/failed/.test(e.text) ? "action" : "event";
    case "error":
      return "error";
    case "notification":
      return e.data?.type === "error" ? "error" : "message";
    case "logging":
      return "page";
    case "wait":
      return "wait";
    default:
      return "event";
  }
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(3)} s`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A wait entry's start line, and its stop line when it has stopped. */
function waitLines(e: ActivityEntry, now: number): TimelineLine[] {
  const d = e.data ?? {};
  const label = str(d.label) ?? e.text;
  const name = d.waitKind === "wheel" ? "Busy wheel" : d.waitKind === "background" ? `${label} (background)` : label;
  const action = str(d.action);
  const from = action ? ` · ${d.actionCertain === true ? "from" : "likely from"}: ${action}` : "";
  const stop = str(d.stop);
  const duration = num(d.durationMs);
  if (stop === null) {
    const soFar = duration ?? Math.max(0, now - Date.parse(e.t));
    return [{ t: e.t, source: "wait", text: `still waiting · ${name} · ${seconds(soFar)} so far${from}` }];
  }
  const outcome = str(d.outcome);
  const detail = str(d.detail);
  const ended = d.waitKind === "wheel" ? "" : ` · ${outcome ?? "?"}${detail ? `, ${detail}` : ""}`;
  return [
    { t: e.t, source: "wait", text: `start · ${name}${from}` },
    { t: stop, source: "wait", text: `stop · ${name} · ${seconds(duration ?? Date.parse(stop) - Date.parse(e.t))}${ended}` },
  ];
}

function messageText(e: ActivityEntry): string {
  const type = str(e.data?.type);
  if (e.kind !== "notification" || !type) return e.text;
  const shown = type === "error" ? "Error shown" : type === "warning" ? "Warning shown" : type === "success" ? "Shown" : "Notice shown";
  return `${shown}: ${e.text}`;
}

interface Failed {
  at: number;
  label: string;
  detail: string | null;
}

/**
 * The entries as timeline lines, in time order. `entries` may mix the log,
 * the wait log and the saved copies; entries at the same time keep the
 * order given.
 */
export function timelineFrom(entries: ActivityEntry[], now: number = Date.now()): TimelineLine[] {
  const lines: { line: TimelineLine; at: number; i: number }[] = [];
  let i = 0;
  const add = (line: TimelineLine) => lines.push({ line, at: Date.parse(line.t), i: i++ });
  for (const e of entries) {
    if (e.kind === "wait") {
      for (const line of waitLines(e, now)) add(line);
    } else {
      add({ t: e.t, source: sourceOf(e), text: messageText(e) });
    }
  }
  lines.sort((a, b) => a.at - b.at || a.i - b.i);

  // Errors linked to their cause: the latest action before each, while it's
  // recent, and a wait that had just failed.
  let lastAction: { at: number; text: string } | null = null;
  let lastFailed: Failed | null = null;
  for (const item of lines) {
    const { line, at } = item;
    if (line.source === "action") lastAction = { at, text: line.text };
    if (line.source === "wait" && line.text.startsWith("stop · ")) {
      const m = line.text.match(/^stop · (.+?) · [\d.]+ s · failed(?:, (.+))?$/);
      if (m) lastFailed = { at, label: m[1], detail: m[2] ?? null };
    }
    if (line.source !== "error") continue;
    const parts: string[] = [];
    if (lastFailed && at - lastFailed.at <= FAILED_WAIT_MS && at >= lastFailed.at) {
      parts.push(`after: ${lastFailed.label} failed${lastFailed.detail ? ` (${lastFailed.detail})` : ""}`);
    }
    if (lastAction && at - lastAction.at <= LIKELY_ACTION_MS && at >= lastAction.at) {
      parts.push(`likely from: ${lastAction.text}`);
    }
    if (parts.length > 0) item.line = { ...line, text: `${line.text} · ${parts.join(" · ")}` };
  }
  return lines.map((l) => l.line);
}

/** `2026-11-03 09:14:19.779` in `timeZone` (the machine's by default), for a text file. */
export function formatTimelineTime(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? "??";
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${p("year")}-${p("month")}-${p("day")} ${p("hour")}:${p("minute")}:${p("second")}.${ms}`;
}

/** The lines as text, one per line: `time  source   text`, sources padded to line up. */
export function formatTimeline(lines: TimelineLine[], timeZone?: string): string {
  return lines.map((l) => `${formatTimelineTime(l.t, timeZone)}  ${l.source.padEnd(7)}  ${l.text}`).join("\n") + (lines.length ? "\n" : "");
}
