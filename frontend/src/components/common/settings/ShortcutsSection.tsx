/**
 * Settings ▸ Keyboard shortcuts: every registered shortcut, rebindable. (#1112)
 *
 * Listing is most of the value: before this there was nowhere at all that
 * answered "which keys does PsyNeuView use?" — which is how the Mac menu came
 * to bind Cmd+X to Stop Services without anyone noticing it had taken Cut.
 */

import { useEffect, useState } from "react";
import { displayBinding, isMac } from "@/shortcuts/binding";
import { captureBinding } from "@/shortcuts/capture";
import { findConflicts, resolveShortcuts } from "@/shortcuts/registry";
import { clearOverrides, loadOverrides, setOverride } from "@/shortcuts/storage";
import { Group } from "./shared";
import { Button } from "../Button";

export function ShortcutsSection({ deployment }: { deployment: "macApp" | "browser" }) {
  return (
    <Group id="shortcuts" title="Keyboard shortcuts">
      <ShortcutRows deployment={deployment} />
    </Group>
  );
}

function ShortcutRows({ deployment }: { deployment: "macApp" | "browser" }) {
  const [overrides, setOverrides] = useState<Record<string, string>>(loadOverrides);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const { resolved, errors } = resolveShortcuts(overrides);
  const conflicts = findConflicts(resolved);
  const mac = isMac();

  // While capturing, the next keypress is the new binding — so the listener has
  // to sit above everything, including the app's own shortcuts. Escape here
  // means "leave this shortcut alone", and stopping the event is what keeps it
  // from also closing Settings (useDismiss listens last, #1288).
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(null);
        setCaptureError(null);
        return;
      }
      const result = captureBinding(e, {
        mac,
        deployment,
        shortcuts: resolved,
        selfId: capturing,
      });
      if (result.ok) {
        setOverrides(setOverride(capturing, result.spec));
        setCapturing(null);
        setCaptureError(null);
        return;
      }
      // A modifier on its own is not a mistake — keep listening.
      setCaptureError("pending" in result ? null : result.reason);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, mac, deployment, resolved]);

  const groups = ["View", "Model", "Run", "Edit"] as const;
  const byGroup = groups
    .map((group) => ({ group, items: resolved.filter((s) => s.group === group) }))
    .filter((g) => g.items.length > 0);

  return (
    <div style={{ fontSize: "var(--pnv-fs-13)" }} data-testid="setting-keyboard-shortcuts">
      {byGroup.map(({ group, items }) => (
        <div key={group} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-faint)", marginBottom: 3 }}>{group}</div>
          {items.map((shortcut) => (
            <div
              key={shortcut.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 12,
                padding: "2px 0",
              }}
            >
              <span style={{ color: "var(--pnv-text-body)" }}>{shortcut.label}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {overrides[shortcut.id] && (
                  <Button
                    kind="link"
                    onClick={() => setOverrides(setOverride(shortcut.id, null))}
                    title="Reset to the default"
                    style={{ fontSize: "var(--pnv-fs-10)" }}
                  >
                    reset
                  </Button>
                )}
                <button
                  onClick={() => {
                    setCaptureError(null);
                    setCapturing(capturing === shortcut.id ? null : shortcut.id);
                  }}
                  title="Click, then press the keys you want"
                  style={{
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: "var(--pnv-fs-12)",
                    color: capturing === shortcut.id ? "var(--pnv-primary)" : "var(--pnv-text-body)",
                    background: capturing === shortcut.id ? "var(--pnv-primary-tint)" : "var(--pnv-surface-sunken)",
                    border: `1px solid ${capturing === shortcut.id ? "var(--pnv-primary)" : "var(--pnv-border-light)"}`,
                    borderRadius: 3,
                    padding: "1px 6px",
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                    minWidth: 62,
                  }}
                >
                  {capturing === shortcut.id
                    ? "press keys…"
                    : displayBinding(shortcut.binding, mac)}
                </button>
              </span>
            </div>
          ))}
        </div>
      ))}

      {captureError && (
        <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-danger)", marginTop: 4 }}>{captureError}</div>
      )}
      {capturing && !captureError && (
        <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-muted)", marginTop: 4 }}>
          Press the combination you want, or Escape to leave it alone.
        </div>
      )}
      {Object.keys(overrides).length > 0 && (
        <Button kind="small" onClick={() => setOverrides(clearOverrides())} style={{ marginTop: 8 }}>
          Reset all to defaults
        </Button>
      )}

      {conflicts.length > 0 && (
        <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-danger)", marginTop: 6 }}>
          Two shortcuts want the same key: {conflicts.join("; ")}
        </div>
      )}
      {errors.length > 0 && (
        <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-warning)", marginTop: 6 }}>
          Some bindings could not be read and fell back to their defaults:{" "}
          {errors.join("; ")}
        </div>
      )}

      <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-faint)", marginTop: 8, lineHeight: 1.5 }}>
        Shortcuts do not fire while you are typing in a field. Undo, redo and
        save deliberately still work inside the code editor.
      </div>
    </div>
  );
}
