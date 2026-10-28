/**
 * Settings ▸ Open menu: the order of its sections, and which of the catalogs
 * still under development show. (#1290, #1295)
 *
 * Only the menu's shape. What each section lists, and where that lives, is
 * Folders; adding or removing a catalog happens there too.
 */

import { useEffect, useMemo, useState } from "react";
import { useCatalogStore } from "@/stores/catalogStore";
import { useTourStore } from "@/stores/tourStore";
import { useUIStore } from "@/stores/uiStore";
import {
  SECTION_LABELS,
  DEV_SECTIONS,
  canMoveSection,
  getShownDevSections,
  isShownOnlyByDeveloperMode,
  persistShownDevSections,
  SECTION_ORDER_CHANGED,
  getSectionOrder,
  isDefaultOrder,
  persistSectionOrder,
  catalogSectionId,
  defaultOrder,
  type SectionId,
} from "@/stores/openMenuOrder";
import { DeveloperBadge } from "../DeveloperBadge";
import { Group } from "./shared";
import { Button } from "../Button";

export function OpenMenuSection() {
  return (
    <Group id="open-menu-sections" title="Sections and their order">
      <OpenMenuOrderRows />
    </Group>
  );
}

/**
 * The Open menu's catalog sections, in order, with move controls. (#1135)
 *
 * The same order the menu itself uses — dragging there and moving here are two
 * views of one stored list, kept in step by an event rather than by each
 * re-reading on a timer. The catalogs under development always sit below the
 * everyday sections (#1295): a move that would put one above is not offered.
 *
 * Buttons rather than drag here: Settings is a scrolling panel, and a drag in a
 * scrolling panel fights the scroll. The menu keeps the drag, where it reads
 * naturally.
 */
function OpenMenuOrderRows() {
  // #1229: the user's own catalogs are rows too.
  const catalogs = useCatalogStore((s) => s.catalogs);
  const refresh = useCatalogStore((s) => s.refresh);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const catalogIds = useMemo(() => catalogs.map((c) => catalogSectionId(c.id)), [catalogs]);
  const labelOf = (id: string) =>
    SECTION_LABELS[id as SectionId] ?? catalogs.find((c) => catalogSectionId(c.id) === id)?.name ?? id;
  const [order, setOrder] = useState<string[]>(() => getSectionOrder(catalogIds));
  useEffect(() => setOrder(getSectionOrder(catalogIds)), [catalogIds]);
  const [shown, setShown] = useState<Set<string>>(getShownDevSections);
  const developerMode = useUIStore((s) => s.developerMode);
  const tourRunning = useTourStore((s) => s.activeTourId !== null);

  // #1228: a catalog under development can be shown without developer mode.
  const toggleShown = (id: string) => {
    const next = new Set(shown);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persistShownDevSections(next);
    setShown(next);
  };

  useEffect(() => {
    const refreshOrder = () => {
      setOrder(getSectionOrder(catalogIds));
      setShown(getShownDevSections());
    };
    window.addEventListener(SECTION_ORDER_CHANGED, refreshOrder);
    return () => window.removeEventListener(SECTION_ORDER_CHANGED, refreshOrder);
  }, [catalogIds]);

  const move = (from: number, to: number) => {
    if (!canMoveSection(order, from, to)) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    persistSectionOrder(next);
    setOrder(next);
  };

  const isDefault = isDefaultOrder(order, catalogIds);

  const arrow: React.CSSProperties = {
    fontSize: "var(--pnv-fs-11)", lineHeight: 1, padding: "1px 5px", cursor: "pointer",
    border: "1px solid var(--pnv-border-light)", borderRadius: 3, background: "var(--pnv-surface-muted)", color: "var(--pnv-text-muted)",
  };
  const arrowButton = (i: number, to: number, title: string, glyph: string) => {
    const can = canMoveSection(order, i, to);
    return (
      <button
        onClick={() => move(i, to)}
        disabled={!can}
        title={can ? title : "The catalogs under development stay below the everyday sections"}
        style={{ ...arrow, opacity: can ? 1 : 0.3, cursor: can ? "pointer" : "default" }}
      >
        {glyph}
      </button>
    );
  };

  return (
    <div style={{ fontSize: "var(--pnv-fs-13)" }} data-testid="setting-open-menu-sections">
      {order.map((id, i) => (
        <div
          key={id}
          data-testid={`open-menu-order-row-${id}`}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 8, padding: "2px 0",
          }}
        >
          <span style={{ color: "var(--pnv-text-body)" }}>
            <span style={{ color: "var(--pnv-text-faint)", marginRight: 6 }}>{i + 1}</span>
            {labelOf(id)}
            {/* #1291: on the menu only because developer mode is on. */}
            {isShownOnlyByDeveloperMode(id, { developerMode, tourRunning, shown }) && <DeveloperBadge />}
          </span>
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {(DEV_SECTIONS as readonly string[]).includes(id) && (
              <label
                title={
                  developerMode
                    ? "Always shown in developer mode"
                    : "Show this catalog in the Open menu without developer mode"
                }
                style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-muted)", display: "flex", alignItems: "center", gap: 3, cursor: developerMode ? "default" : "pointer" }}
              >
                <input
                  type="checkbox"
                  data-testid={`show-section-${id}`}
                  checked={developerMode || shown.has(id)}
                  disabled={developerMode}
                  onChange={() => toggleShown(id)}
                />
                show
              </label>
            )}
            {arrowButton(i, i - 1, "Move up", "↑")}
            {arrowButton(i, i + 1, "Move down", "↓")}
          </span>
        </div>
      ))}

      {!isDefault && (
        <Button
          kind="small"
          onClick={() => {
            persistSectionOrder(defaultOrder(catalogIds));
            setOrder(defaultOrder(catalogIds));
          }}
          style={{ marginTop: 8 }}
        >
          Reset to default order
        </Button>
      )}

      <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-faint)", marginTop: 8, lineHeight: 1.5 }}>
        You can also drag a section by its heading in the Open menu. The catalogs still under
        development stay below the everyday sections; "show" puts one on the menu without
        developer mode, which shows them all. Recent is not listed: it sits under History,
        separately from the catalogs. What each section lists, and your catalogs: Folders.
      </div>
    </div>
  );
}
