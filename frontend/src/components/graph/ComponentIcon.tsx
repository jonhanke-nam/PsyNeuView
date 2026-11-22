/**
 * A palette icon (#283): the SVG for a component type or a palette category,
 * drawn in `color` (or the manifest's tint). The SVGs are this repo's own
 * files under assets/component-icons/, sanitised when added and checked by
 * componentIcons.test.ts (no scripts, links or event handlers), so they are
 * put in as markup.
 */
import type { CSSProperties } from "react";
import type { ResolvedIcon } from "@/utils/componentIcons";

export function ComponentIcon({
  icon,
  size,
  color,
  style,
}: {
  icon: ResolvedIcon;
  size: number;
  color: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      data-testid="component-icon"
      data-icon={icon.file}
      data-icon-source={icon.source}
      style={{
        display: "inline-flex",
        width: size,
        height: size,
        flexShrink: 0,
        color: icon.tint ?? color,
        ...style,
      }}
      dangerouslySetInnerHTML={{ __html: icon.svg }}
    />
  );
}
