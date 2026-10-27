/**
 * Settings ▸ Developer ▸ PsyNeuLink details: the installed PsyNeuLink in
 * full — repo, branch, commit, path, version, how far behind its branch it
 * is, and whether the debugger hook is there. (#120, #116; was About ▸
 * Environment until #1295 made About a one-line-each summary.)
 */

import { useEffect, useState } from "react";
import { formatInstallSummary, type PsyNeuLinkInfo } from "@/utils/pnlSources";
import { PathBox, Row } from "./shared";
import type { PnlFeaturesInfo, PnlFreshness } from "./types";

export function PnlDetails({
  pnl,
  previous,
  features,
}: {
  pnl: PsyNeuLinkInfo;
  previous: PsyNeuLinkInfo | null;
  features?: PnlFeaturesInfo;
}) {
  // #116: "Branch / ref: devel" looks current whether the pinned commit is a
  // day old or four months old — the branch is resolved once, at install, and
  // only re-pulled by the updater. Ask GitHub how far behind it actually is.
  //
  // Fetched separately from /settings/info, and after the panel renders,
  // because this one touches the network and Settings has to open regardless.
  const [freshness, setFreshness] = useState<PnlFreshness | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/pnl-freshness")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setFreshness(data);
      })
      .catch(() => {
        // Leaving the row absent is right: we genuinely don't know, and an
        // error here says nothing about the install.
      });
    return () => {
      cancelled = true;
    };
  }, [pnl.version, pnl.branch]);
  // After a successful install, `previous` is the pre-install snapshot, so
  // "you went from X to Y" shows inline without a reload.
  const showPrevious = previous && !samePnl(previous, pnl);
  return (
    <div style={{ fontSize: "var(--pnv-fs-13)" }} data-testid="pnl-details">
      {/* The path has its own row below; the summary doesn't repeat it. */}
      {showPrevious && <Row label="Previous version" value={formatInstallSummary(previous!)} dimmed struck />}
      <Row label="Currently installed" value={formatInstallSummary(pnl)} />
      {pnl.repo && (
        // A local checkout's repo is where its folder was cloned from (#1276).
        <Row label={pnl.source === "editable" ? "Cloned from" : "Repo"} value={pnl.repo} mono />
      )}
      {pnl.branch && <Row label="Branch / ref" value={pnl.branch} mono />}
      {pnl.commit && <Row label="Commit" value={pnl.commit} mono />}
      {pnl.path && (
        <div style={{ display: "flex", padding: "4px 0", gap: 12 }}>
          <div style={{ width: 160, color: "var(--pnv-text-secondary)", flexShrink: 0 }}>Path</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <PathBox path={pnl.path} />
          </div>
        </div>
      )}
      <Row label="PsyNeuLink version" value={pnl.version ?? "not installed"} mono />
      {freshness && freshness.status !== "not_applicable" && (
        <Row label="Branch freshness" value={freshness.detail} dimmed={freshness.status !== "behind"} />
      )}
      {features && (
        <Row
          label="Debugging support"
          value={
            features.debugger_hook
              ? "Full — per-node values, snapshots, real trial boundaries"
              : "Basic — no _debugger hook; values & snapshots unavailable"
          }
        />
      )}
    </div>
  );
}

function samePnl(a: PsyNeuLinkInfo, b: PsyNeuLinkInfo): boolean {
  return (
    a.source === b.source &&
    a.version === b.version &&
    a.repo === b.repo &&
    a.branch === b.branch &&
    a.commit === b.commit &&
    a.path === b.path
  );
}
