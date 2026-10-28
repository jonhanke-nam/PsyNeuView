/**
 * In the Mac app: when the app's record of the PsyNeuLink source disagrees
 * with what is installed, say so and offer to keep what's installed
 * (PsyNeuView-MacApp#9, PsyNeuView#16).
 *
 * The record decides what a later environment rebuild (an app update) puts
 * back. Before the app shared it, a switch made here never reached it, and an
 * update could quietly move a user off their own checkout. Nothing is
 * reinstalled by the button: the app re-reads the install and adopts it.
 */
import { useEffect, useState } from "react";
import { Button } from "../Button";
import {
  getMacAppSettings,
  hasSettingsBridge,
  onMacAppSettingsChanged,
  syncMacAppPnlSource,
} from "@/utils/macAppSettings";
import { describeRecord, pnlRecordMismatch } from "@/utils/pnlRecord";
import type { PsyNeuLinkInfo } from "@/utils/pnlSources";

export function PnlRecordNotice({ currentPnl }: { currentPnl: PsyNeuLinkInfo }) {
  const [record, setRecord] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hasSettingsBridge()) return;
    let live = true;
    getMacAppSettings()
      .then((s) => live && setRecord(s.pnlRecord ?? null))
      .catch(() => {});
    const off = onMacAppSettingsChanged((s) => setRecord(s.pnlRecord ?? null));
    return () => {
      live = false;
      off();
    };
  }, []);

  const mismatch = pnlRecordMismatch(record, currentPnl);
  if (!mismatch) return null;

  const keep = async () => {
    setBusy(true);
    const s = await syncMacAppPnlSource();
    if (s) setRecord(s.pnlRecord ?? null);
    setBusy(false);
  };

  return (
    <div
      data-testid="pnl-record-mismatch"
      role="status"
      style={{
        fontSize: "var(--pnv-fs-12)",
        padding: "8px 10px",
        borderRadius: 5,
        background: "var(--pnv-warning-tint)",
        border: "1px solid var(--pnv-warning-border)",
        color: "var(--pnv-warning-text-on-tint)",
      }}
    >
      The Mac app's saved choice is {describeRecord(mismatch.record)}, but {describeRecord(mismatch.live)} is
      what's installed. An app update would reinstall the saved choice.{" "}
      <Button kind="link" onClick={() => void keep()} disabled={busy} data-testid="pnl-record-keep">
        Keep what's installed
      </Button>
    </div>
  );
}
