/**
 * "Show in Finder", with what to do when it can't (#1295).
 *
 * Inside the Mac app the pnvFile bridge reveals a folder in Finder. An app
 * from before the `reveal` op (0.5.15 and earlier) doesn't know it, and a
 * plain browser has no bridge at all; in both cases the next best thing is
 * the path on the clipboard, with a note saying so when an update would fix
 * it. Pure logic, with the bridge and the clipboard passed in, so the three
 * outcomes are unit-tested rather than discovered in the field.
 */

import type { RevealReply } from "./fileBridge";

export const UPDATE_APP_NOTE = "Copied the path. Update the PsyNeuView app to open folders in Finder.";
export const COPIED_NOTE = "Copied the path.";

export type RevealOutcome =
  | { kind: "revealed" }
  /** The path is on the clipboard; `note` is what to tell the user. */
  | { kind: "copied"; note: string }
  | { kind: "failed"; message: string };

export interface RevealDeps {
  hasBridge: boolean;
  reveal: (path: string) => Promise<RevealReply>;
  copy: (text: string) => Promise<void>;
}

export async function revealOrCopy(path: string, deps: RevealDeps): Promise<RevealOutcome> {
  const copy = async (note: string): Promise<RevealOutcome> => {
    try {
      await deps.copy(path);
      return { kind: "copied", note };
    } catch {
      return { kind: "failed", message: "Couldn't copy the path." };
    }
  };
  if (!deps.hasBridge) return copy(COPIED_NOTE);
  let reply: RevealReply;
  try {
    reply = await deps.reveal(path);
  } catch (e: any) {
    // The app said why — no such folder, say. Its words are for the user.
    return { kind: "failed", message: String(e?.message ?? e) };
  }
  if (reply === "revealed") return { kind: "revealed" };
  return copy(UPDATE_APP_NOTE);
}

/** The clipboard, with the old textarea trick when the API is missing. */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(area);
  if (!ok) throw new Error("copy failed");
}
