/**
 * The hint on a blank screen (#215).
 *
 * With Settings ▸ Appearance ▸ Allow a blank screen on, the graph, the code
 * editor and the Inspector panel can all be hidden. The toolbar stays; where
 * the panels were, this says in a line or two how to bring one back: the
 * Layout menu, or each panel's key, read from the shortcut registry with the
 * person's own rebindings applied (so a changed key shows here too). Renders
 * nothing while any of the three is showing.
 *
 * It covers the pane area rather than replacing it, so the panels stay
 * mounted at zero size and keep their state for when they come back.
 */

import { useLayoutStore } from "@/stores/layoutStore";
import { displayBinding } from "@/shortcuts/binding";
import { useResolvedShortcuts } from "@/shortcuts/useAppShortcuts";

/** The hint's text. A panel whose key was unbound in Settings is left out of the keys. */
export function blankScreenHint(keys: { graph: string; code: string; bottom: string }): string {
  const named = [
    keys.graph && `${keys.graph} for the graph`,
    keys.code && `${keys.code} for the code editor`,
    keys.bottom && `${keys.bottom} for the Inspector panel`,
  ].filter(Boolean);
  const lead = "Every panel is hidden. Bring one back from the Layout menu";
  if (named.length === 0) return `${lead}.`;
  const last = named.pop();
  return `${lead}, or press ${named.length ? `${named.join(", ")} or ${last}` : last}.`;
}

export function BlankScreen() {
  const codeVisible = useLayoutStore((s) => s.codeVisible);
  const graphVisible = useLayoutStore((s) => s.graphVisible);
  const bottomVisible = useLayoutStore((s) => s.bottomVisible);
  const shortcuts = useResolvedShortcuts();
  if (codeVisible || graphVisible || bottomVisible) return null;

  const keyFor = (id: string) => {
    const s = shortcuts.find((x) => x.id === id);
    return s ? displayBinding(s.binding) : "";
  };
  const hint = blankScreenHint({
    graph: keyFor("layout.toggleGraph"),
    code: keyFor("layout.toggleCode"),
    bottom: keyFor("layout.toggleBottom"),
  });

  return (
    <div
      data-testid="blank-screen"
      role="status"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--pnv-surface)",
      }}
    >
      <div style={{ maxWidth: 480, textAlign: "center", color: "var(--pnv-text-muted)", fontSize: "var(--pnv-fs-13)", lineHeight: 1.5 }}>
        <div data-testid="blank-screen-hint">{hint}</div>
      </div>
    </div>
  );
}
