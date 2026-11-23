/**
 * The diagnostics bar (#109): amber only when there is something to act on,
 * the toolbar's neutral grey otherwise, and no "click to expand" line — the
 * bar's tooltip says it expands.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = {
  filePath: "/tmp/m.py",
  source: "",
  starImportConverted: false,
  activeComposition: "comp",
  compositionNames: ["comp"],
  compositionDisplayNames: { comp: "comp" },
  diagnostics: {
    mechanismCount: 2, projectionCount: 1, compositionCount: 1,
    editableVars: ["a", "b"], readOnlyVars: [] as string[], importStyle: "pnl",
    isStandardized: true, pnlVersion: "0.20", warnings: [] as string[], notices: [] as string[],
  },
};
vi.mock("@/stores/modelStore", () => ({ useModelStore: <T,>(pick: (s: typeof state) => T) => pick(state) }));
vi.mock("@/stores/loadTimingStore", () => ({ useLoadTimingStore: <T,>(pick: (s: { last: null }) => T) => pick({ last: null }) }));
vi.mock("@/stores/notificationStore", () => ({ useNotificationStore: () => () => {} }));
vi.mock("./SyncIndicator", () => ({ SyncIndicator: () => null }));

import { DiagnosticPanel, diagnosticsBarColours } from "./DiagnosticPanel";

const render = () => renderToStaticMarkup(createElement(DiagnosticPanel));

describe("the diagnostics bar (#109)", () => {
  it("is neutral grey for a clean model, and for informational notices only", () => {
    state.diagnostics.warnings = [];
    state.diagnostics.readOnlyVars = [];
    state.diagnostics.notices = ["function-scoped nodes can't be converted"];
    const html = render();
    expect(html).toContain('data-tone="neutral"');
    expect(html).toContain("var(--pnv-surface-muted)");
    expect(html).not.toContain("success-tint");
    expect(html).not.toContain("warning-tint");
  });

  it("is amber for a warning or a view-only node", () => {
    state.diagnostics.warnings = ["written for PsyNeuLink 0.18"];
    expect(render()).toContain('data-tone="attention"');
    state.diagnostics.warnings = [];
    state.diagnostics.readOnlyVars = ["x"];
    expect(render()).toContain("var(--pnv-warning-tint)");
  });

  it("says it expands in its tooltip, not in a line of text", () => {
    const html = render();
    expect(html).not.toMatch(/click to expand<\/span>/i);
    expect(html).toContain('title="Model Diagnostics: click to expand"');
  });

  it("colours: amber edge with amber ground, grey edge with grey ground", () => {
    expect(diagnosticsBarColours(true)).toEqual({ background: "var(--pnv-warning-tint)", borderBottom: "1px solid var(--pnv-warning-border)" });
    expect(diagnosticsBarColours(false)).toEqual({ background: "var(--pnv-surface-muted)", borderBottom: "1px solid var(--pnv-border-faint)" });
  });
});
