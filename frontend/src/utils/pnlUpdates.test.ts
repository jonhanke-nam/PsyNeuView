import { describe, expect, it } from "vitest";

import {
  autoUpdateNote,
  checkoutStatusLine,
  formatCheckedAt,
  lastPullNote,
  updateStatusLine,
  type CheckoutUpdate,
  type PnlCheckResult,
  type PnlUpdates,
} from "./pnlUpdates";
import type { PsyNeuLinkInfo } from "./pnlSources";

// 2026-10-07 10:42 local time, and a check 20 minutes earlier.
const NOW = new Date(2026, 9, 7, 10, 42);
const CHECKED = new Date(2026, 9, 7, 10, 22).getTime() / 1000;

const devel: PsyNeuLinkInfo = {
  version: "0.20.2+260", source: "github", branch: "devel", repo: "PrincetonUniversity/PsyNeuLink", commit: "7a86e22", path: null,
};
const pypi: PsyNeuLinkInfo = { version: "0.20.2.0", source: "pypi", branch: null, repo: null, commit: null, path: null };

const result = (pnl: PsyNeuLinkInfo, over: Partial<PnlCheckResult>): PnlCheckResult => ({
  checked_at: CHECKED, source: pnl.source, version: pnl.version, repo: pnl.repo, branch: pnl.branch, commit: pnl.commit,
  freshness: null, newest_release: null, release_available: false, offline: false, ...over,
});
const fresh = (status: "current" | "behind" | "unknown", behind_by: number | null = null) => ({
  status, behind_by, installed_commit: "7a86e22", head_commit: "9ce038f", head_date: "2026-10-06T18:02:00Z", detail: "",
});
const updates = (pnl: PsyNeuLinkInfo, over: Partial<PnlUpdates> = {}): PnlUpdates => ({
  auto_update: true, interval_s: 14400, installed: pnl, last_check_at: CHECKED, last_result: null,
  update_ready: false, ready_commit: null, last_install: null, checks_enabled: true, checkouts: [], ...over,
});

describe("when something was last checked", () => {
  it("is the time alone today, the date on another day, nothing when never", () => {
    expect(formatCheckedAt(CHECKED, NOW)).toBe("last checked 10:22");
    expect(formatCheckedAt(new Date(2026, 9, 6, 9, 5).getTime() / 1000, NOW)).toBe("last checked Oct 6, 9:05");
    expect(formatCheckedAt(null, NOW)).toBeNull();
  });
});

describe("the status line under General ▸ PsyNeuLink version (#1304)", () => {
  it("says the version, how many commits behind, and when that was checked", () => {
    const u = updates(devel, { last_result: result(devel, { freshness: fresh("behind", 3) }) });
    expect(updateStatusLine(u, NOW)).toEqual({
      text: "PsyNeuLink 0.20.2+260 (devel, commit 7a86e22) · 3 commits behind · last checked 10:22", tone: "behind",
    });
    expect(updateStatusLine(updates(devel, { last_result: result(devel, { freshness: fresh("behind", 1) }) }), NOW).text).toContain("1 commit behind");
  });

  it("says up to date", () => {
    const u = updates(devel, { last_result: result(devel, { freshness: fresh("current", 0) }) });
    expect(updateStatusLine(u, NOW)).toEqual({
      text: "✓ Up to date · PsyNeuLink 0.20.2+260 (devel, commit 7a86e22) · last checked 10:22", tone: "ok",
    });
  });

  it("says when it couldn't check rather than implying current", () => {
    const u = updates(devel, { last_result: result(devel, { freshness: fresh("unknown") }) });
    const line = updateStatusLine(u, NOW);
    expect(line.text).toBe("PsyNeuLink 0.20.2+260 (devel, commit 7a86e22) · couldn't check (GitHub unreachable) · last checked 10:22");
    expect(line.tone).toBe("warn");
  });

  it("says not checked yet, also when the last check was of another install", () => {
    expect(updateStatusLine(updates(devel, { last_check_at: null }), NOW)).toEqual({
      text: "PsyNeuLink 0.20.2+260 (devel, commit 7a86e22) · Not checked yet", tone: "muted",
    });
    const switched = updates(pypi, { last_result: result(devel, { freshness: fresh("behind", 3) }) });
    expect(updateStatusLine(switched, NOW).text).toBe("0.20.2.0 · Not checked yet");
  });

  it("for an official release: a newer release is available, or the newest", () => {
    const newer = updates(pypi, { last_result: result(pypi, { newest_release: "0.21.0.0", release_available: true }) });
    expect(updateStatusLine(newer, NOW)).toEqual({
      text: "0.20.2.0 · a newer release, 0.21.0.0, is available · last checked 10:22", tone: "behind",
    });
    const newest = updates(pypi, { last_result: result(pypi, { newest_release: "0.20.2.0" }) });
    expect(updateStatusLine(newest, NOW)).toEqual({ text: "✓ Newest release · 0.20.2.0 · last checked 10:22", tone: "ok" });
    const offline = updates(pypi, { last_result: result(pypi, { offline: true }) });
    expect(updateStatusLine(offline, NOW).text).toBe("0.20.2.0 · PyPI couldn't be reached · last checked 10:22");
  });
});

describe("the note about automatic updates", () => {
  const behind = result(devel, { freshness: fresh("behind", 3) });

  it("says an update is ready for the next start, only while the switch is on", () => {
    expect(autoUpdateNote(updates(devel, { last_result: behind, update_ready: true }))).toEqual({
      text: "An update is ready; it installs next time PsyNeuView starts.", tone: "behind",
    });
    expect(autoUpdateNote(updates(devel, { last_result: behind, update_ready: true, auto_update: false }))).toBeNull();
    expect(autoUpdateNote(updates(devel, { last_result: behind }))).toBeNull();
  });

  it("shows how the last automatic update went", () => {
    const failed = { at: CHECKED, outcome: "failed" as const, from_commit: "7a86e22", to_commit: null, detail: "The update failed; the PsyNeuLink in use stays. fatal: unable to access" };
    expect(autoUpdateNote(updates(devel, { last_install: failed }))).toEqual({
      text: "The last automatic update failed; the version in use stays. The update failed; the PsyNeuLink in use stays. fatal: unable to access", tone: "warn",
    });
    const ok = { at: CHECKED, outcome: "succeeded" as const, from_commit: "7a86e22", to_commit: "9ce038f", detail: "Updated." };
    expect(autoUpdateNote(updates(devel, { last_install: ok }))?.text).toBe("✓ Updated automatically when PsyNeuView last started (7a86e22 → 9ce038f).");
  });
});

describe("a checkout's status line in Developer", () => {
  const checkout = (over: Partial<CheckoutUpdate>): CheckoutUpdate => ({
    id: "/Users/me/code/PsyNeuLink", kind: "psyneulink", name: "PsyNeuLink checkout", path: "/Users/me/code/PsyNeuLink",
    exists: true, in_use: true, is_checkout: true, branch: "devel", upstream: "origin/devel", commit: "7a86e22", dirty_files: 0,
    check: false, pull_on_launch: false, last_check: null, last_pull: null, ...over,
  });
  const check = (over: Partial<NonNullable<CheckoutUpdate["last_check"]>>) => ({
    checked_at: CHECKED, fetched: true, status: "current" as const, behind_by: 0, ahead_by: 0, dirty_files: 0, upstream: "origin/devel", detail: "Up to date with origin/devel.", ...over,
  });

  it("names the remote branch before any check", () => {
    expect(checkoutStatusLine(checkout({}), NOW)).toEqual({ text: "tracks origin/devel · not checked yet", tone: "muted" });
  });

  it("says behind or up to date with the remote branch, and when", () => {
    expect(checkoutStatusLine(checkout({ last_check: check({}) }), NOW)).toEqual({ text: "✓ Up to date with origin/devel · last checked 10:22", tone: "ok" });
    expect(checkoutStatusLine(checkout({ last_check: check({ status: "behind", behind_by: 2 }) }), NOW)).toEqual({
      text: "2 commits behind origin/devel · last checked 10:22", tone: "behind",
    });
  });

  it("says uncommitted changes mean no pull", () => {
    expect(checkoutStatusLine(checkout({ last_check: check({ status: "behind", behind_by: 2, dirty_files: 3 }) }), NOW)).toEqual({
      text: "2 commits behind origin/devel · 3 files changed locally; not pulled · last checked 10:22", tone: "warn",
    });
  });

  it("passes on a diverged branch's sentence", () => {
    const diverged = check({ status: "diverged", behind_by: 2, ahead_by: 1, detail: "2 commits behind and 1 commit ahead of origin/devel; not pulled." });
    expect(checkoutStatusLine(checkout({ last_check: diverged }), NOW).text).toBe("2 commits behind and 1 commit ahead of origin/devel; not pulled · last checked 10:22");
  });

  it("reports the last pull at launch", () => {
    const pulled = { at: CHECKED, outcome: "pulled" as const, from_commit: "a", to_commit: "b", detail: "Pulled 2 commits from origin/devel." };
    expect(lastPullNote(checkout({ last_pull: pulled }), NOW)).toEqual({ text: "✓ Pulled 2 commits from origin/devel at 10:22", tone: "ok" });
    const refused = { at: CHECKED, outcome: "refused" as const, from_commit: "a", to_commit: null, detail: "3 files changed locally; not pulled." };
    expect(lastPullNote(checkout({ last_pull: refused }), NOW)).toEqual({ text: "Not pulled at 10:22: 3 files changed locally; not pulled.", tone: "warn" });
    expect(lastPullNote(checkout({}), NOW)).toBeNull();
  });
});
