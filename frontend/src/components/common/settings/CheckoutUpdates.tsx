/**
 * Settings ▸ Developer ▸ Keep your checkouts current (#1304).
 *
 * For each checkout of your own — the PsyNeuLink checkouts Settings knows,
 * and the PsyNeuView checkout the backend runs from — two switches, both off
 * by default: "Check for upstream changes" (on the same schedule as the
 * PsyNeuLink check) and "Pull on launch". Each names the remote branch it
 * uses, says behind or up to date and when that was checked, and reports
 * what happened at the last launch. A pull is fast-forward only, refused
 * with uncommitted changes or a diverged branch, and never switches branch.
 */

import { DeveloperBadge } from "../DeveloperBadge";
import { checkoutStatusLine, lastPullNote } from "@/utils/pnlUpdates";
import { TONE_COLOR } from "./PnlUpdateStatus";
import { Group, PathBox, errorStyle, mutedStyle } from "./shared";
import { usePnlUpdates } from "./usePnlUpdates";
import { Button } from "../Button";

export function CheckoutUpdates() {
  const { updates, error, busy, setCheckoutPrefs, checkCheckout } = usePnlUpdates();
  const checkouts = updates?.checkouts ?? [];
  const summary = updates
    ? checkouts.length === 0
      ? "No checkouts of your own yet"
      : `${checkouts.filter((c) => c.check || c.pull_on_launch).length} of ${checkouts.length} kept current`
    : undefined;

  return (
    <Group id="checkout-updates" title="Keep your checkouts current" summary={summary} defaultFolded badge={<DeveloperBadge audience="developers" />}>
      <div style={{ fontSize: "var(--pnv-fs-13)" }} data-testid="checkout-updates">
        <div style={{ ...mutedStyle, marginBottom: 6 }}>
          Your own checkouts are never touched unless you ask here. A pull is a fast-forward of the branch each checkout is
          on, from the remote branch it tracks; with uncommitted changes, or local commits the remote doesn't have, nothing
          is pulled and the reason is shown. Branches are never switched.
        </div>
        {error && <div style={errorStyle}>{error}</div>}
        {!error && !updates && <div style={mutedStyle}>Loading…</div>}
        {updates && checkouts.length === 0 && (
          <div style={mutedStyle}>None yet. A PsyNeuLink checkout appears here once Settings has switched to it.</div>
        )}
        {checkouts.map((c) => {
          const line = checkoutStatusLine(c);
          const pull = lastPullNote(c);
          const remote = c.upstream ?? "no remote branch";
          return (
            <div key={c.id} data-testid="checkout-update-row" data-checkout-path={c.path} style={{ padding: "6px 0", borderTop: "1px solid var(--pnv-border-faint)" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 500 }}>{c.kind === "psyneuview" ? "PsyNeuView" : c.name}</span>
                {c.in_use && c.kind === "psyneulink" && <span style={{ ...mutedStyle, fontSize: "var(--pnv-fs-11)" }}>the PsyNeuLink in use</span>}
                {c.kind === "psyneuview" && <span style={{ ...mutedStyle, fontSize: "var(--pnv-fs-11)" }}>the PsyNeuView running now</span>}
              </div>
              <PathBox path={c.path} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: "var(--pnv-fs-12)" }}>
                <span data-testid="checkout-update-line" style={{ color: TONE_COLOR[line.tone] }}>{line.text}</span>
                {c.is_checkout && (
                  <Button
                    onClick={() => void checkCheckout(c.path)}
                    disabled={busy}
                    data-testid="checkout-update-check-now"
                    title={`Fetch ${remote} and compare`}
                    kind="small" style={{ flexShrink: 0 }}
                  >
                    {busy ? "Checking…" : "Check now"}
                  </Button>
                )}
              </div>
              {pull && (
                <div data-testid="checkout-update-pull-note" style={{ fontSize: "var(--pnv-fs-12)", color: TONE_COLOR[pull.tone], marginTop: 2 }}>
                  {pull.text}
                </div>
              )}
              {c.is_checkout && (
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 4 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      data-testid="setting-checkout-check-upstream"
                      checked={c.check}
                      disabled={busy}
                      onChange={(e) => void setCheckoutPrefs(c.path, { check: e.target.checked })}
                    />
                    Check for upstream changes <span style={{ ...mutedStyle, fontSize: "var(--pnv-fs-11)" }}>({remote})</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      data-testid="setting-checkout-pull-on-launch"
                      checked={c.pull_on_launch}
                      disabled={busy || !c.upstream}
                      onChange={(e) => void setCheckoutPrefs(c.path, { pull_on_launch: e.target.checked })}
                    />
                    Pull on launch <span style={{ ...mutedStyle, fontSize: "var(--pnv-fs-11)" }}>(fast-forward from {remote})</span>
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Group>
  );
}
