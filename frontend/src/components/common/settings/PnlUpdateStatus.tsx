/**
 * General ▸ PsyNeuLink version ▸ how current it is (#1304).
 *
 * Under the version choice: one line saying the version, whether it is
 * behind or up to date (for an official release: whether a newer release
 * is out) and when that was last checked; a Check now button; and "Keep
 * Latest development up to date automatically", on by default. An update
 * found while automatic updates are on installs at the next start, not
 * mid-session (updating restarts the model runner), and a quiet note says
 * so until then. An official release is only reported, never switched.
 *
 * A checkout of your own has its own update options in Developer.
 */

import type { PsyNeuLinkInfo } from "@/utils/pnlSources";
import { autoUpdateNote, updateStatusLine, type StatusTone } from "@/utils/pnlUpdates";
import { openSettings } from "./sections";
import { errorStyle, linkStyle, mutedStyle } from "./shared";
import { usePnlUpdates } from "./usePnlUpdates";
import { Button } from "../Button";

export const TONE_COLOR: Record<StatusTone, string> = {
  ok: "var(--pnv-success)",
  behind: "var(--pnv-primary-text-on-tint)",
  muted: "var(--pnv-text-muted)",
  warn: "var(--pnv-warning)",
};

export function PnlUpdateStatus({ currentPnl }: { currentPnl: PsyNeuLinkInfo }) {
  const { updates, error, busy, checkNow, setAutoUpdate } = usePnlUpdates([currentPnl.version, currentPnl.source, currentPnl.repo, currentPnl.branch, currentPnl.commit]);

  if (currentPnl.source === "editable") {
    return (
      <div data-testid="pnl-update-status" style={{ ...mutedStyle, marginTop: 10 }}>
        Your own checkout is kept current from Developer:{" "}
        <Button
          onClick={() => openSettings("developer")}
          kind="link"
        >
          Keep your checkouts current
        </Button>
      </div>
    );
  }
  if (currentPnl.source === "unknown") return null;

  if (!updates) {
    return (
      <div data-testid="pnl-update-status" style={{ ...mutedStyle, marginTop: 10 }}>
        {error ? `Couldn't read how current PsyNeuLink is: ${error}` : "Checking…"}
      </div>
    );
  }

  const line = updateStatusLine({ ...updates, installed: currentPnl });
  const note = autoUpdateNote(updates);
  const latest = currentPnl.source === "github";

  return (
    <div data-testid="pnl-update-status" style={{ marginTop: 10, fontSize: "var(--pnv-fs-12)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span data-testid="pnl-update-line" style={{ color: TONE_COLOR[line.tone], minWidth: 0 }}>
          {line.text}
        </span>
        <Button
          onClick={() => void checkNow()}
          disabled={busy}
          data-testid="pnl-update-check-now"
          title={latest ? "Ask GitHub how far behind the branch this is" : "Ask PyPI whether a newer release is out"}
          kind="small" style={{ flexShrink: 0 }}
        >
          {busy ? "Checking…" : "Check now"}
        </Button>
      </div>
      {latest && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, cursor: "pointer", fontSize: "var(--pnv-fs-13)" }}>
          <input
            type="checkbox"
            data-testid="setting-pnl-auto-update"
            checked={updates.auto_update}
            disabled={busy}
            onChange={(e) => void setAutoUpdate(e.target.checked)}
          />
          Keep Latest development up to date automatically
        </label>
      )}
      {latest && (
        <div style={{ ...mutedStyle, marginLeft: 22 }}>
          Checks when PsyNeuView starts and every {Math.round(updates.interval_s / 3600)} hours. An update installs the next time
          PsyNeuView starts, never mid-session.
          {!updates.checks_enabled && " (Automatic checks are off in this PsyNeuView.)"}
        </div>
      )}
      {!latest && (
        <div style={{ ...mutedStyle, marginTop: 4 }}>
          A newer official release is reported here, never installed on its own: pick it above when you want it.
        </div>
      )}
      {note && (
        <div data-testid="pnl-update-note" style={{ color: TONE_COLOR[note.tone], marginTop: 4 }}>
          {note.text}
        </div>
      )}
      {error && <div style={{ ...errorStyle, marginTop: 4 }}>{error}</div>}
    </div>
  );
}
