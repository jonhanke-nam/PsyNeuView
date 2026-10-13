/**
 * Choose how a node's values are shown and save the choice in the model's
 * layout file (#1387). Separate from the store so the store needn't import
 * modelStore, which hydrates it on load.
 */

import { useModelStore } from "@/stores/modelStore";
import { useValueViews, type ValueView } from "@/stores/valueViewStore";

export function chooseValueView(node: string, view: ValueView): void {
  useValueViews.getState().setView(node, view);
  const filePath = useModelStore.getState().filePath;
  if (!filePath) return;
  void fetch("/api/model/save-layout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: filePath, valueViews: useValueViews.getState().views }),
  }).catch(() => {
    // Not worth an error: the choice still holds for this session.
  });
}
