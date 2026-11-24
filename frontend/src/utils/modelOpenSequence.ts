/**
 * The newest model open wins (#386).
 *
 * Opening a model is a request to the server and a wait for its answer. Ask for
 * one model, then another before the first has arrived, and both answers come
 * back. Whichever lands last used to be shown, so a slow first model (Cohen &
 * Huston 1994 takes a second and a half to build) could replace the one chosen
 * after it, or the second could be ignored. The server builds one model at a
 * time, but its queue does not promise to keep the order the requests came in.
 *
 * Every way of opening a model takes a ticket before it asks, and applies the
 * answer only while its ticket is still the newest. An older answer that turns
 * up late is dropped without a word: the person has moved on.
 */

import { useFailedOpenStore } from "@/stores/failedOpenStore";
import { useModelStore } from "@/stores/modelStore";
import { record } from "@/utils/activityLog";

let newest = 0;

/** Take a ticket for an open that is about to ask the server for a model. */
export function beginModelOpen(): number {
  newest += 1;
  // A new open answers the last failed one (#401): its banner goes.
  useFailedOpenStore.getState().clear();
  return newest;
}

/** Whether this open is still the newest one asked for. */
export function isNewestModelOpen(ticket: number): boolean {
  return ticket === newest;
}

/**
 * An error for an open that failed, saying which model is still open (#386).
 * Nothing new was opened, so the model on screen is still the current one, and
 * the error says so rather than leaving it to be guessed.
 */
export function withStillShowing(message: string): string {
  const shown = shownModelPath();
  const trimmed = message.replace(/[.\s]+$/, "");
  if (!shown) return trimmed;
  const name = shown.split("/").filter(Boolean).pop() || shown;
  return `${trimmed}. Nothing new was opened: ${name} is still the open model.`;
}

/** The path of the model on screen: a bundle's own path for a bundle. */
function shownModelPath(): string | null {
  const { filePath, bundleOrigin } = useModelStore.getState();
  return bundleOrigin || filePath || null;
}

/** The last part of a path. */
export function baseName(p: string): string {
  return p.split("/").filter(Boolean).pop() || p;
}

/**
 * An open that failed outright, marked over the graph (#401): "Couldn't open
 * X: reason. Still showing Y.", with Try again and Dismiss. The model on
 * screen and its title stay as they are: nothing new was opened. The words
 * also go in the activity log, as a message shown to the user does.
 */
export function reportFailedOpen(attempted: string, reason: unknown, retry: () => void): void {
  const why = String(reason).replace(/[.\s]+$/, "") || "unknown error";
  record("notification", withStillShowing(`Couldn't open ${attempted}: ${why}`), { type: "error" });
  useFailedOpenStore.getState().setFailed({ attempted, reason: why, shownPath: shownModelPath(), retry });
}
