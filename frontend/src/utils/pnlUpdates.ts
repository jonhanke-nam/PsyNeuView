/**
 * Keeping PsyNeuLink current, and saying so (#1304): what
 * `/api/settings/pnl-updates` answers, and the one-line wording Settings
 * shows for it. Pure, so the wording is unit-tested.
 */

import type { PsyNeuLinkInfo } from "./pnlSources";

export interface PnlFreshnessResult {
  status: "current" | "behind" | "unknown" | "not_applicable";
  behind_by: number | null;
  installed_commit: string | null;
  head_commit: string | null;
  head_date: string | null;
  detail: string;
}

/** What the last check found. */
export interface PnlCheckResult {
  checked_at: number;
  source: PsyNeuLinkInfo["source"];
  version: string | null;
  repo: string | null;
  branch: string | null;
  commit: string | null;
  freshness: PnlFreshnessResult | null;
  /** A PyPI install: the newest release that can install here. */
  newest_release: string | null;
  release_available: boolean;
  offline: boolean;
}

export interface LastAutoInstall {
  at: number;
  outcome: "succeeded" | "failed";
  from_commit: string | null;
  to_commit: string | null;
  detail: string;
}

export interface CheckoutCheck {
  checked_at: number;
  fetched: boolean;
  status: "current" | "behind" | "ahead" | "diverged" | "unknown" | "no_upstream" | "detached" | "not_a_checkout";
  behind_by: number | null;
  ahead_by: number | null;
  dirty_files: number;
  upstream: string | null;
  detail: string;
}

export interface CheckoutPull {
  at: number;
  outcome: "pulled" | "up_to_date" | "refused" | "failed";
  from_commit: string | null;
  to_commit: string | null;
  detail: string;
}

/** One of the user's checkouts, with its two switches and what was last found. */
export interface CheckoutUpdate {
  id: string;
  kind: "psyneuview" | "psyneulink";
  name: string;
  path: string;
  exists: boolean;
  in_use: boolean;
  is_checkout: boolean;
  branch: string | null;
  upstream: string | null;
  commit: string | null;
  dirty_files: number;
  check: boolean;
  pull_on_launch: boolean;
  last_check: CheckoutCheck | null;
  last_pull: CheckoutPull | null;
}

/** `GET /api/settings/pnl-updates`. */
export interface PnlUpdates {
  auto_update: boolean;
  interval_s: number;
  installed: PsyNeuLinkInfo;
  last_check_at: number | null;
  last_result: PnlCheckResult | null;
  update_ready: boolean;
  ready_commit: string | null;
  last_install: LastAutoInstall | null;
  checks_enabled: boolean;
  checkouts: CheckoutUpdate[];
}

/** "last checked 10:42" today, "last checked Oct 6, 10:42" another day. */
export function formatCheckedAt(epochSeconds: number | null | undefined, now: Date = new Date()): string | null {
  if (!epochSeconds) return null;
  const at = new Date(epochSeconds * 1000);
  const time = `${at.getHours()}:${String(at.getMinutes()).padStart(2, "0")}`;
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  if (sameDay) return `last checked ${time}`;
  const month = at.toLocaleString("en-US", { month: "short" });
  return `last checked ${month} ${at.getDate()}, ${time}`;
}

function commits(n: number): string {
  return `${n} commit${n === 1 ? "" : "s"}`;
}

/** "PsyNeuLink 0.20.2+260 (devel, commit 7a86e22)" for a branch install, "0.20.2.0" for a release. */
export function describeInstalled(pnl: PsyNeuLinkInfo): string {
  if (pnl.source === "pypi") return pnl.version ?? "PsyNeuLink";
  const inside = [pnl.branch, pnl.commit ? `commit ${pnl.commit}` : null].filter(Boolean).join(", ");
  return `PsyNeuLink ${pnl.version ?? ""}`.trim() + (inside ? ` (${inside})` : "");
}

export type StatusTone = "ok" | "behind" | "muted" | "warn";

/**
 * The status line under General ▸ PsyNeuLink version, in parts joined with
 * " · ": what is installed, how current it is, when that was checked.
 *
 *   "PsyNeuLink 0.20.2+260 (devel, commit 7a86e22) · 3 commits behind · last checked 10:42"
 *   "✓ Up to date · PsyNeuLink 0.20.2+260 (devel, commit 7a86e22) · last checked 10:42"
 *   "0.20.2.0 · a newer release, 0.21.0.0, is available · last checked 10:42"
 *   "✓ Newest release · 0.20.2.0 · last checked 10:42"
 */
export function updateStatusLine(updates: PnlUpdates, now: Date = new Date()): { text: string; tone: StatusTone } {
  const pnl = updates.installed;
  const installed = describeInstalled(pnl);
  const checked = formatCheckedAt(updates.last_check_at, now);
  const result = updates.last_result;
  // The last check was of another install (a switch since): say so rather than
  // reporting the old one's state against the new one.
  const stale =
    !!result &&
    (result.source !== pnl.source ||
      (result.repo ?? "").toLowerCase() !== (pnl.repo ?? "").toLowerCase() ||
      (result.branch ?? "") !== (pnl.branch ?? "") ||
      (pnl.source === "pypi" && (result.version ?? "") !== (pnl.version ?? "")));
  if (!result || stale) {
    return { text: [installed, "Not checked yet"].join(" · "), tone: "muted" };
  }
  if (pnl.source === "pypi") {
    if (result.release_available && result.newest_release) {
      return { text: [installed, `a newer release, ${result.newest_release}, is available`, checked].filter(Boolean).join(" · "), tone: "behind" };
    }
    if (result.offline && !result.newest_release) {
      return { text: [installed, "PyPI couldn't be reached", checked].filter(Boolean).join(" · "), tone: "warn" };
    }
    return { text: ["✓ Newest release", installed, checked].filter(Boolean).join(" · "), tone: "ok" };
  }
  const fresh = result.freshness;
  if (fresh?.status === "behind" && fresh.behind_by) {
    return { text: [installed, `${commits(fresh.behind_by)} behind`, checked].filter(Boolean).join(" · "), tone: "behind" };
  }
  if (fresh?.status === "current") {
    return { text: ["✓ Up to date", installed, checked].filter(Boolean).join(" · "), tone: "ok" };
  }
  if (fresh?.status === "unknown") {
    return { text: [installed, "couldn't check (GitHub unreachable)", checked].filter(Boolean).join(" · "), tone: "warn" };
  }
  return { text: [installed, checked].filter(Boolean).join(" · "), tone: "muted" };
}

/** The quiet note about an automatic update: ready for next start, or how the last one went. */
export function autoUpdateNote(updates: PnlUpdates): { text: string; tone: StatusTone } | null {
  if (updates.update_ready && updates.auto_update) {
    return { text: "An update is ready; it installs next time PsyNeuView starts.", tone: "behind" };
  }
  const last = updates.last_install;
  if (last?.outcome === "failed") {
    return { text: `The last automatic update failed; the version in use stays. ${last.detail}`.trim(), tone: "warn" };
  }
  if (last?.outcome === "succeeded" && last.to_commit) {
    return { text: `✓ Updated automatically when PsyNeuView last started (${last.from_commit ?? "?"} → ${last.to_commit}).`, tone: "ok" };
  }
  return null;
}

/** The status line for one checkout in Developer. */
export function checkoutStatusLine(c: CheckoutUpdate, now: Date = new Date()): { text: string; tone: StatusTone } {
  if (!c.exists) return { text: "The folder is missing.", tone: "warn" };
  if (!c.is_checkout) return { text: "Not a git checkout.", tone: "muted" };
  const last = c.last_check;
  if (!last) {
    return { text: [c.upstream ? `tracks ${c.upstream}` : "tracks no remote branch", "not checked yet"].join(" · "), tone: "muted" };
  }
  const checked = formatCheckedAt(last.checked_at, now);
  const dirty = last.dirty_files ? `${last.dirty_files} file${last.dirty_files === 1 ? "" : "s"} changed locally; not pulled` : null;
  if (last.status === "current") {
    return { text: [`✓ Up to date with ${last.upstream}`, dirty, checked].filter(Boolean).join(" · "), tone: dirty ? "warn" : "ok" };
  }
  if (last.status === "behind") {
    return { text: [`${commits(last.behind_by ?? 0)} behind ${last.upstream}`, dirty, checked].filter(Boolean).join(" · "), tone: dirty ? "warn" : "behind" };
  }
  if (last.status === "unknown") {
    return { text: ["couldn't check (remote unreachable)", dirty, checked].filter(Boolean).join(" · "), tone: "warn" };
  }
  // ahead, diverged, no_upstream, detached: the backend's sentence says it.
  return { text: [last.detail.replace(/\.$/, ""), checked].filter(Boolean).join(" · "), tone: "warn" };
}

/** What happened at the last launch, if "Pull on launch" is on and there is a record. */
export function lastPullNote(c: CheckoutUpdate, now: Date = new Date()): { text: string; tone: StatusTone } | null {
  const pull = c.last_pull;
  if (!pull) return null;
  const at = formatCheckedAt(pull.at, now)?.replace("last checked", "at") ?? "";
  if (pull.outcome === "pulled") return { text: `✓ ${pull.detail.replace(/\.$/, "")} ${at}`.trim(), tone: "ok" };
  if (pull.outcome === "up_to_date") return { text: `✓ ${pull.detail.replace(/\.$/, "")} ${at}`.trim(), tone: "ok" };
  return { text: `Not pulled ${at}: ${pull.detail}`, tone: "warn" };
}
