/**
 * The one mark for "developer mode only". (#1291)
 *
 * Developer mode shows extra things — catalogs under development in the Open
 * menu, the Developer / Tests entry, developer settings. Nothing used to say
 * they were there because of developer mode, so someone with it on saw more
 * than a regular user and couldn't tell why. This badge goes wherever
 * developer mode adds something, in one colour (the purple the Developer /
 * Tests entry already used), with a tooltip that explains itself.
 *
 * Two readings, chosen by `audience`:
 *  - "developer-mode" (default): shown because developer mode is on. For things
 *    that appear only while it is on.
 *  - "developers": a developer's setting. For the Developer section's own
 *    settings, which are listed whether or not the mode is on.
 *
 * The list of everything developer mode changes is in
 * docs/settings-etiquette.md; a new developer-only thing is added there and
 * gets this badge.
 */

import type { CSSProperties } from "react";

export const DEVELOPER_BADGE_COLOR = "var(--pnv-developer)";

const TITLES = {
  "developer-mode": "Shown because developer mode is on; regular users don't see this",
  developers: "A developer's setting; regular users don't need it",
} as const;

export function DeveloperBadge({
  audience = "developer-mode",
  style,
}: {
  audience?: keyof typeof TITLES;
  style?: CSSProperties;
}) {
  return (
    <span
      data-testid="developer-badge"
      data-audience={audience}
      title={TITLES[audience]}
      style={{
        display: "inline-block",
        fontSize: "var(--pnv-fs-10)",
        lineHeight: "14px",
        fontWeight: 600,
        letterSpacing: "0.02em",
        color: DEVELOPER_BADGE_COLOR,
        border: `1px solid ${DEVELOPER_BADGE_COLOR}`,
        borderRadius: 3,
        padding: "0 4px",
        marginLeft: 6,
        verticalAlign: "middle",
        whiteSpace: "nowrap",
        cursor: "help",
        ...style,
      }}
    >
      Developer
    </span>
  );
}
