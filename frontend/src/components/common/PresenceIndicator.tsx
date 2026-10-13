/**
 * "Someone is also here" — ambient awareness for a shared instance (#1082).
 *
 * A hosted PsyNeuView is one workspace: two people at once share a filesystem,
 * a PsyNeuLink worker, and each other's saved models. This says so while there
 * is still time to coordinate, instead of leaving the first sign to be a file
 * changing underneath someone.
 *
 * Deliberately quiet. It is a status line, not a notification: no toast, no
 * colour, nothing to dismiss, and **nothing clickable** — there is no action to
 * take, and a clickable element that does nothing is worse than plain text (see
 * docs/ui-interaction-conventions.md).
 *
 * Renders nothing at all when alone or when presence is unavailable, which is
 * every local run — so the common case costs the toolbar no space.
 */

import { usePresenceStore } from "@/stores/presenceStore";

/** "a", "a and b", "a, b and c" — a list a person would read aloud. */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function PresenceIndicator() {
  const available = usePresenceStore((s) => s.available);
  const others = usePresenceStore((s) => s.others);

  // Alone, or no way to tell: say nothing. An indicator reading "just you"
  // would imply a guarantee this instance cannot make.
  if (!available || others.length === 0) return null;

  const names = joinNames(others);
  const plural = others.length > 1;

  return (
    <span
      title={
        `${names} ${plural ? "are" : "is"} using this instance too. ` +
        "It is a single shared workspace — you see the same files, and only " +
        "one model can run at a time."
      }
      style={{
        fontSize: 12,
        color: "var(--pnv-text-muted)",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        cursor: "default",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: "var(--pnv-success)",
          flexShrink: 0,
        }}
      />
      {names} also here
    </span>
  );
}
