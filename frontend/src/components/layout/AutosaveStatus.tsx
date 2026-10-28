/**
 * The autosave status beside the model name (#1347): "Autosaved 12 s ago",
 * "Autosave waiting: code has an error", "Autosave paused: file changed on
 * disk". Nothing at all while autosave is off, the default.
 *
 * It also runs autosave's timer (useAutosave), since it is mounted once, for
 * the open model. Clicking it opens Settings ▸ General, where the setting is.
 * Errors are not shown here: an autosave that fails says so the way a manual
 * Save does, and this only notes that it didn't save.
 */

import { useEffect, useState } from "react";
import { openSettings } from "@/components/common/settings/sections";
import { currentAutosaveInputs, useAutosave } from "@/hooks/useAutosave";
import { useAutosaveStore } from "@/stores/autosaveStore";
import { useEditLockStore } from "@/stores/editLockStore";
import { useExternalChangeStore } from "@/stores/externalChangeStore";
import { useModelStore } from "@/stores/modelStore";
import { usePnlSourceStore } from "@/stores/pnlSourceStore";
import { autosaveBlock, autosaveStatus, autosaveTooltip } from "@/utils/autosave";

export function AutosaveStatus() {
  useAutosave();

  const enabled = useAutosaveStore((s) => s.enabled);
  const seconds = useAutosaveStore((s) => s.seconds);
  const due = useAutosaveStore((s) => s.due);
  const autosaving = useAutosaveStore((s) => s.autosaving);
  const lastAutosaved = useAutosaveStore((s) => s.lastAutosaved);
  const lastFailedPath = useAutosaveStore((s) => s.lastFailedPath);
  // Subscribed so the status follows every input the rules read.
  useAutosaveStore((s) => s.diskChangedPath);
  useAutosaveStore((s) => s.savesInFlight);
  useEditLockStore((s) => s.mode);
  usePnlSourceStore((s) => s.status);
  useExternalChangeStore((s) => s.pending);
  const filePath = useModelStore((s) => s.filePath);
  const dirty = useModelStore((s) => s.source !== s.savedSource);
  useModelStore((s) => s.modelError);
  useModelStore((s) => s.lastGoodSource);
  useModelStore((s) => s.bundleOrigin);

  const lastAt = lastAutosaved && lastAutosaved.filePath === filePath ? lastAutosaved.at : null;

  // "12 s ago" has to move.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled || lastAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled, lastAt]);

  const block = autosaveBlock(currentAutosaveInputs());
  const status = autosaveStatus({
    enabled,
    block,
    dirty,
    due,
    autosaving,
    lastAutosavedAt: lastAt,
    lastFailed: lastFailedPath !== null && lastFailedPath === filePath,
    now: Math.max(now, lastAt ?? 0),
  });
  if (!status) return null;

  return (
    <button
      type="button"
      data-testid="autosave-status"
      data-tone={status.tone}
      onClick={() => openSettings("general")}
      title={autosaveTooltip(seconds, block)}
      style={{
        flexShrink: 0,
        marginLeft: 6,
        padding: "0 4px",
        border: "none",
        background: "none",
        fontSize: "var(--pnv-fs-11)",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        cursor: "pointer",
        color: status.tone === "warning" ? "var(--pnv-warning)" : "var(--pnv-text-hint)",
      }}
    >
      {status.text}
    </button>
  );
}
