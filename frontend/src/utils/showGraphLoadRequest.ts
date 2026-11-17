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

/**
 * Everything a model load needs to build the graph the user is looking at
 * (#257): the flat or PyTorch view, and show_graph's layout options. Every
 * `/api/model/load` sends this, so no reload can quietly switch views. Some
 * sent only the show_graph part, and the backend's default view is nested
 * while the page's is flat: ticking Interface nodes (CIMs) reloaded the flat
 * view, which had none, and they appeared only after a save reloaded nested.
 */
/**
 * The view a model is shown in (flat or PyTorch), for requests that change the
 * model and send it back: a structural change answers with the model re-read,
 * and in the nested view while the page showed it flattened, a composition
 * folded into one node until the next reload (#252, as #257 for loads).
 */
export function modelViewOptions(): { flat: boolean; pytorch: boolean } {
  const { flat, pytorch } = useGraphSettings.getState();
  return { flat, pytorch };
}

export function modelLoadOptions(): ShowGraphLoadRequest & { flat: boolean; pytorch: boolean } {
  const { flat, pytorch } = useGraphSettings.getState();
  return { flat, pytorch, ...showGraphLoadRequest() };
}
