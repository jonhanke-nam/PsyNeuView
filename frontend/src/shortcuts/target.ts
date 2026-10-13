/**
 * Deciding whether a shortcut may fire given what is focused. (#1112)
 *
 * Split out from the listener because it is the part with the real rules, and
 * the part worth testing without a DOM event in hand.
 */

import type { Scope } from "./registry";

export type TargetKind = "codeEditor" | "textField" | "other";

/** Classify the event target: is the user typing, and where? */
export function classifyTarget(target: EventTarget | null): TargetKind {
  const el = target as HTMLElement | null;
  if (!el) return "other";

  // CodeMirror renders a contenteditable inside .cm-editor. Checked first,
  // because that element is also contenteditable and would otherwise be
  // classified as an ordinary text field.
  if (typeof el.closest === "function" && el.closest(".cm-editor")) return "codeEditor";

  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return "textField";
  if (el.isContentEditable) return "textField";
  return "other";
}

/** Whether a shortcut with this scope may fire against this target. */
export function allowedInTarget(scope: Scope, target: TargetKind): boolean {
  switch (scope) {
    case "always":
      return true;
    case "codeEditorToo":
      // Everywhere except an ordinary field. Cmd+S in the code editor should
      // save the model; Cmd+S in a rename box should not be hijacked.
      return target !== "textField";
    case "outsideText":
      return target === "other";
  }
}
