/**
 * What a model load sends so the "Like show_graph" layout needn't load the
 * model again (#27). With that layout picked, the load also asks show_graph
 * about the model it has just built and keeps the answers for the layout's
 * own request, which then comes back at once instead of reloading the model
 * (about 2 s for EGO). Spread into a /api/model/load body.
 */

import { useGraphSettings } from "@/stores/graphSettingsStore";
import { useModelStore } from "@/stores/modelStore";

export interface ShowGraphLoadRequest {
  show_graph?: {
    show_controller: boolean;
    show_learning: boolean;
    composition?: string;
  };
}

export function showGraphLoadRequestFor(
  layoutStyle: string,
  showController: boolean,
  showLearning: boolean,
  activeComposition: string | null,
): ShowGraphLoadRequest {
  if (layoutStyle !== "showgraph") return {};
  return {
    show_graph: {
      show_controller: showController,
      show_learning: showLearning,
      ...(activeComposition ? { composition: activeComposition } : {}),
    },
  };
}

/** The request for the current settings and the composition open now. */
export function showGraphLoadRequest(): ShowGraphLoadRequest {
  const { layoutStyle, showController, showLearning } = useGraphSettings.getState();
  return showGraphLoadRequestFor(
    layoutStyle,
    showController,
    showLearning,
    useModelStore.getState().activeComposition,
  );
}
