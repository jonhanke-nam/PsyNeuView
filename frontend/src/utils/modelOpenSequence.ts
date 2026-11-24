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

import { useModelStore } from "@/stores/modelStore";

let newest = 0;

/** Take a ticket for an open that is about to ask the server for a model. */
export function beginModelOpen(): number {
  newest += 1;
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
  const { filePath, bundleOrigin } = useModelStore.getState();
  const shown = bundleOrigin || filePath;
  const trimmed = message.replace(/[.\s]+$/, "");
  if (!shown) return trimmed;
  const name = shown.split("/").filter(Boolean).pop() || shown;
  return `${trimmed}. Nothing new was opened: ${name} is still the open model.`;
}
