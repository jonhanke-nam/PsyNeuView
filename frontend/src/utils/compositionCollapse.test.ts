/**
 * Collapse and Expand do what the pressed control says (#428).
 *
 * Expand on a folded composition opens it, even when the settings read a
 * flattened view, where nothing is folded: deciding from the settings alone
 * took that press for a second fold, and EGO's EM stayed folded.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/graphView", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/graphView")>()),
  rebuildGraph: vi.fn(async () => null),
}));

import { toggleCompositionCollapse } from "@/utils/nodeActions";
import { useGraphSettings } from "@/stores/graphSettingsStore";

beforeEach(() => {
  useGraphSettings.setState({
    flat: true,
    pytorch: false,
    // Folded on first sight in the nested view (#395), still on record.
    collapsedCompositions: new Set(["EM"]),
    insetCompositions: new Set(),
  });
});

describe("toggleCompositionCollapse (#428)", () => {
  it("Expand on a folded node opens it, and the flattened view stays", async () => {
    await toggleCompositionCollapse("EM", "open");
    const gs = useGraphSettings.getState();
    expect(gs.collapsedCompositions.has("EM")).toBe(false);
    expect(gs.flat).toBe(true);
  });

  it("Collapse on a frame in the flattened view folds it, and the view goes nested", async () => {
    useGraphSettings.setState({ collapsedCompositions: new Set() });
    await toggleCompositionCollapse("EM", "fold");
    const gs = useGraphSettings.getState();
    expect(gs.collapsedCompositions.has("EM")).toBe(true);
    expect(gs.flat).toBe(false);
  });

  it("Expand in the nested view opens a folded composition", async () => {
    useGraphSettings.setState({ flat: false });
    await toggleCompositionCollapse("EM", "open");
    expect(useGraphSettings.getState().collapsedCompositions.has("EM")).toBe(false);
  });
});
