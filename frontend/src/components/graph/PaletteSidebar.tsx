/**
 * Collapsible sidebar palette for adding PsyNeuLink objects to the graph.
 * Features: recursive tree hierarchy, type-ahead search, favorites, recently used.
 * Items can be dragged onto the canvas or clicked to add.
 */

import { isFunctionType, isProjectionType } from "@/constants/pnlTypes";
import { type DragEvent, type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useModelStore } from "@/stores/modelStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { usePaletteStore } from "@/stores/paletteStore";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import {
  PNL_TAXONOMY_TREE,
  ALL_PNL_DEFS,
  findDefByType,
  type PnlObjectDef,
  type TaxonomyNode,
} from "@/constants/pnlTypes";
import { addNodeToModel } from "@/utils/nodeActions";
import { useDismiss } from "@/components/common/dialog/useDismiss";
import { iconForCategory, iconForType } from "@/utils/componentIcons";
import { ComponentIcon } from "./ComponentIcon";
import { Button } from "@/components/common/Button";
import { PanelHandle } from "@/components/common/PanelHandle";
import { DisclosureArrow } from "@/components/common/Disclosure";

/** #354: the drag is over, dropped or not. */
const endDrag = () => usePaletteStore.getState().setDraggingFunction(null);


function findNode(id: string, nodes: TaxonomyNode[] = PNL_TAXONOMY_TREE): TaxonomyNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const hit = findNode(id, n.children);
      if (hit) return hit;
    }
  }
  return null;
}

function pathTo(id: string, nodes: TaxonomyNode[] = PNL_TAXONOMY_TREE, acc: TaxonomyNode[] = []): TaxonomyNode[] | null {
  for (const n of nodes) {
    const next = [...acc, n];
    if (n.id === id) return next;
    if (n.children) {
      const hit = pathTo(id, n.children, next);
      if (hit) return hit;
    }
  }
  return null;
}

export function PaletteSidebar() {
  const filePath = useModelStore((s) => s.filePath);
  const setSource = useModelStore((s) => s.setSource);
  const loadModelFromServer = useModelStore((s) => s.loadModelFromServer);
  const addNotification = useNotificationStore((s) => s.addNotification);

  const isOpen = usePaletteStore((s) => s.isOpen);
  const isCompact = usePaletteStore((s) => s.isCompact);
  const searchQuery = usePaletteStore((s) => s.searchQuery);
  const favorites = usePaletteStore((s) => s.favorites);
  const recentlyUsed = usePaletteStore((s) => s.recentlyUsed);
  const compactFlyoutNodeId = usePaletteStore((s) => s.compactFlyoutNodeId);
  const showStripShortcuts = usePaletteStore((s) => s.showStripShortcuts);
  const showStripHeadings = usePaletteStore((s) => s.showStripHeadings);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    return ALL_PNL_DEFS.filter(
      (item) =>
        item.type.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const favoriteItems = useMemo(
    () => ALL_PNL_DEFS.filter((item) => favorites.includes(item.type)),
    [favorites],
  );

  const recentItems = useMemo(
    () =>
      recentlyUsed
        .map((type) => findDefByType(type))
        .filter(Boolean) as PnlObjectDef[],
    [recentlyUsed],
  );

  // #372: the icon strip's shortcuts, favourites first, then recents, once each.
  const stripShortcuts = useMemo(() => {
    const favTypes = new Set(favoriteItems.map((i) => i.type));
    return [
      ...favoriteItems.map((item) => ({ item, kind: "favourite" as const })),
      ...recentItems.filter((i) => !favTypes.has(i.type)).map((item) => ({ item, kind: "recent" as const })),
    ];
  }, [favoriteItems, recentItems]);

  // Show ports (#112): the Ports section is there only while ports are shown.
  const showPorts = useGraphSettings((st) => st.showPortDots);
  const taxonomy = useMemo(
    () => (showPorts ? PNL_TAXONOMY_TREE : PNL_TAXONOMY_TREE.filter((n) => n.id !== "ports")),
    [showPorts],
  );

  if (!isOpen) return null;

  const handleAdd = (item: PnlObjectDef, viaKeyboard = false) => {
    if (!filePath) return;
    // A projection connects two nodes, so it has no place to be put: it
    // keeps its own route (drop it on the receiver, then click the sender).
    if (isProjectionType(item.type)) {
      addNodeToModel(filePath, item.type, item.defaults, setSource, loadModelFromServer, addNotification);
      usePaletteStore.getState().addRecentlyUsed(item.type);
      return;
    }
    // #252: pick it up; the next click on the graph says where it goes.
    // Clicking it again puts it back; another component swaps.
    const { armed, setArmed } = usePaletteStore.getState();
    if (armed?.type === item.type) {
      setArmed(null);
      return;
    }
    const pick = { type: item.type, defaults: item.defaults, label: item.label || item.type };
    if (!viaKeyboard) {
      setArmed(pick);
      return;
    }
    // #411: picked up from the keyboard, the graph takes focus to place it.
    // Focus comes back afterwards to the row, or, for a row in a strip menu
    // (which closes now, as a click on the graph closes it), to the menu's
    // category icon.
    const active = document.activeElement as HTMLElement | null;
    const inMenu = active?.closest('[data-testid="palette-compact-flyout"]');
    const returnFocus = inMenu
      ? document.querySelector<HTMLElement>('[data-testid="palette-category"][aria-expanded="true"]')
      : active;
    usePaletteStore.getState().closeCompactFlyout();
    setArmed({ ...pick, viaKeyboard: true, returnFocus });
  };

  const handleDragStart = (e: DragEvent, item: PnlObjectDef) => {
    e.dataTransfer.setData(
      "application/psyneuview-node",
      JSON.stringify({ type: item.type, defaults: item.defaults }),
    );
    e.dataTransfer.effectAllowed = "move";
    // #354: a function dragged goes onto a mechanism; light up those that can take it.
    if (isFunctionType(item.type)) usePaletteStore.getState().setDraggingFunction(item.type);
  };

  const width = isCompact ? 48 : 260;

  return (
    <div
      data-testid="palette-sidebar"
      role="complementary"
      aria-label="Palette"
      style={{
        width,
        height: "100%",
        background: "var(--pnv-surface-muted)",
        borderRight: "1px solid var(--pnv-border-faint)",
        display: "flex",
        flexDirection: "column",
        overflow: "visible",
        position: "relative",
        transition: "width 0.15s ease",
      }}
    >
      {/* #418: the fold between the full panel and the icon strip is the
          panel-edge handle on the right edge, its tab at the top: › in the
          strip shows the full panel, ‹ folds it back. It replaced the strip's
          small bordered chevron (#414), which sat in the palette buttons'
          column and read as one of them. The panel is not resizable, so only
          the tab acts. */}
      <PanelHandle
        orientation="vertical"
        foldToward="left"
        expanded={!isCompact}
        onToggle={() => usePaletteStore.getState().toggleCompact()}
        controls="pnv-palette-body"
        collapseLabel="Fold the Components panel to the icon strip"
        expandLabel="Show the full Components panel"
        testId="palette-handle"
        tabTestId={isCompact ? "palette-strip-expand" : "palette-fold"}
        tabOffset={6}
        // Over the panel's own border, so the line and the border are one.
        style={{ left: "calc(100% - 1px)" }}
      />
      {/* Header: the full panel only; the strip has none (#418). */}
      {!isCompact && (
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--pnv-border-faint)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 4,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: "var(--pnv-fs-12)", fontWeight: 600, color: "var(--pnv-text-body)" }}>Components</span>
          <div style={{ display: "flex", gap: 2 }}>
            <IconButton
              title="Close palette"
              onClick={() => usePaletteStore.getState().setOpen(false)}
            >
              {"\u2715"}
            </IconButton>
          </div>
        </div>
      )}

      {/* Search bar */}
      {!isCompact && (
        <div style={{ padding: "8px 12px 4px", flexShrink: 0 }}>
          <input
            type="text"
            placeholder="Search components…"
            value={searchQuery}
            onChange={(e) => usePaletteStore.getState().setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              fontSize: "var(--pnv-fs-12)",
              padding: "5px 8px",
              border: "1px solid var(--pnv-border)",
              borderRadius: 4,
              outline: "none",
              background: "var(--pnv-surface)",
              boxSizing: "border-box",
            }}
          />
        </div>
      )}

      {/* Scrollable content */}
      <div id="pnv-palette-body" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: isCompact ? 4 : 0 }}>
        {/* Search results mode */}
        {filteredItems !== null ? (
          <div style={{ padding: isCompact ? 0 : 8 }}>
            {!isCompact && (
              <SectionHeader label={`Results (${filteredItems.length})`} />
            )}
            {filteredItems.length === 0 && !isCompact && (
              <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-faint)", padding: "8px 12px" }}>
                No matching components
              </div>
            )}
            {filteredItems.map((item) => (
              <PaletteLeaf
                key={item.type}
                item={item}
                compact={isCompact}
                depth={0}
                isFavorite={favorites.includes(item.type)}
                onAdd={handleAdd}
                onDragStart={handleDragStart}
                onToggleFavorite={() => usePaletteStore.getState().toggleFavorite(item.type)}
              />
            ))}
          </div>
        ) : (
          <>
            {/* Favorites */}
            {/* #372: the strip shows these at the bottom, behind a setting. */}
            {!isCompact && favoriteItems.length > 0 && (
              <div style={{ padding: 8 }}>
                <SectionHeader label="Favorites" icon={"\u2605"} />
                {favoriteItems.map((item) => (
                  <PaletteLeaf
                    key={`fav-${item.type}`}
                    item={item}
                    compact={false}
                    depth={0}
                    isFavorite={true}
                    onAdd={handleAdd}
                    onDragStart={handleDragStart}
                    onToggleFavorite={() => usePaletteStore.getState().toggleFavorite(item.type)}
                  />
                ))}
              </div>
            )}

            {/* Recently Used */}
            {!isCompact && recentItems.length > 0 && (
              <div style={{ padding: 8 }}>
                <SectionHeader label="Recently Used" icon={"\u29D6"} />
                {recentItems.map((item) => (
                  <PaletteLeaf
                    key={`recent-${item.type}`}
                    item={item}
                    compact={false}
                    depth={0}
                    isFavorite={favorites.includes(item.type)}
                    onAdd={handleAdd}
                    onDragStart={handleDragStart}
                    onToggleFavorite={() => usePaletteStore.getState().toggleFavorite(item.type)}
                  />
                ))}
              </div>
            )}

            {/* Taxonomy tree */}
            <div style={{ padding: isCompact ? 0 : "4px 0" }}>
              {isCompact ? (
                <>
                  {showStripHeadings && (
                    <StripHeading testId="palette-strip-heading-components" label="All components" text="Components" />
                  )}
                  {taxonomy.map((node) => (
                    <CompactCategoryIcon
                      key={node.id}
                      node={node}
                      isActive={compactFlyoutNodeId !== null &&
                        (compactFlyoutNodeId === node.id ||
                         compactFlyoutNodeId.startsWith(node.id + "."))}
                    />
                  ))}
                  {showStripShortcuts && stripShortcuts.length > 0 && (
                    <div data-testid="palette-strip-shortcuts" style={{ marginTop: 6 }}>
                      {showStripHeadings ? (
                        <StripHeading testId="palette-strip-heading-shortcuts" label="Recent and favourite components" text="Recent" />
                      ) : (
                        <StripDivider />
                      )}
                      {stripShortcuts.map(({ item, kind }) => (
                        <PaletteLeaf
                          key={`strip-${item.type}`}
                          item={item}
                          compact={true}
                          depth={0}
                          isFavorite={kind === "favourite"}
                          shortcut={kind}
                          onAdd={handleAdd}
                          onDragStart={handleDragStart}
                          onToggleFavorite={() => usePaletteStore.getState().toggleFavorite(item.type)}
                        />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                taxonomy.map((node) => (
                  <TreeNode
                    key={node.id}
                    node={node}
                    depth={0}
                    favorites={favorites}
                    onAdd={handleAdd}
                    onDragStart={handleDragStart}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
      {isCompact && compactFlyoutNodeId && (
        <CompactFlyout
          nodeId={compactFlyoutNodeId}
          favorites={favorites}
          onAdd={handleAdd}
          onDragStart={handleDragStart}
        />
      )}
    </div>
  );
}

/** Recursive tree node renderer (expanded sidebar only). */
function TreeNode({
  node,
  depth,
  favorites,
  onAdd,
  onDragStart,
}: {
  node: TaxonomyNode;
  depth: number;
  favorites: string[];
  onAdd: (item: PnlObjectDef, viaKeyboard?: boolean) => void;
  onDragStart: (e: DragEvent, item: PnlObjectDef) => void;
}) {
  const expandedNodes = usePaletteStore((s) => s.expandedNodes);
  const isExpanded = expandedNodes.has(node.id);

  // Leaf node — render as draggable item
  if (node.def && !node.children) {
    return (
      <PaletteLeaf
        item={node.def}
        compact={false}
        depth={depth}
        isFavorite={favorites.includes(node.def.type)}
        onAdd={onAdd}
        onDragStart={onDragStart}
        onToggleFavorite={() => usePaletteStore.getState().toggleFavorite(node.def!.type)}
      />
    );
  }

  // Singleton flatten — branch with one leaf child renders the leaf in the branch's slot.
  if (
    !node.def &&
    node.children?.length === 1 &&
    node.children[0].def &&
    !node.children[0].children
  ) {
    const childDef = node.children[0].def;
    return (
      <PaletteLeaf
        item={childDef}
        compact={false}
        depth={depth}
        isFavorite={favorites.includes(childDef.type)}
        onAdd={onAdd}
        onDragStart={onDragStart}
        onToggleFavorite={() => usePaletteStore.getState().toggleFavorite(childDef.type)}
      />
    );
  }

  // Branch node — reorder children so the family's "base" leaf comes first.
  const rawChildren = node.children ?? [];
  const defaultChild =
    node.defaultLeafId
      ? rawChildren.find((c) => c.id === node.defaultLeafId && c.def)
      : undefined;
  const orderedChildren = defaultChild
    ? [defaultChild, ...rawChildren.filter((c) => c.id !== defaultChild.id)]
    : rawChildren;

  const renderChild = (child: TaxonomyNode) => {
    if (defaultChild && child.id === defaultChild.id && child.def) {
      return (
        <PaletteLeaf
          key={child.id}
          item={child.def}
          compact={false}
          depth={depth + 1}
          isFavorite={favorites.includes(child.def.type)}
          isDefault
          onAdd={onAdd}
          onDragStart={onDragStart}
          onToggleFavorite={() => usePaletteStore.getState().toggleFavorite(child.def!.type)}
        />
      );
    }
    return (
      <TreeNode
        key={child.id}
        node={child}
        depth={depth + 1}
        favorites={favorites}
        onAdd={onAdd}
        onDragStart={onDragStart}
      />
    );
  };

  const isTopLevel = depth === 0;

  return (
    <div>
      <button
        onClick={() => usePaletteStore.getState().toggleNode(node.id)}
        aria-expanded={isExpanded}
        className="pnv-disclosure-toggle"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          width: "100%",
          padding: `${isTopLevel ? 6 : 3}px 12px`,
          paddingLeft: 12 + depth * 12,
          border: "none",
          background: "none",
          cursor: "pointer",
          fontSize: isTopLevel ? 11 : 11,
          color: isTopLevel ? "var(--pnv-text-body)" : "var(--pnv-text-muted)",
          fontWeight: isTopLevel ? 700 : 600,
          textAlign: "left",
          textTransform: isTopLevel ? "uppercase" : "none",
          letterSpacing: isTopLevel ? "0.05em" : "normal",
        }}
      >
        {/* #418: the standard row arrow, turned; the row says whether it is open. */}
        <DisclosureArrow open={isExpanded} small />
        {node.label}
        {!isTopLevel && node.children && (
          <span style={{ fontSize: "var(--pnv-fs-9)", color: "var(--pnv-text-faint)", marginLeft: 4 }}>
            ({countLeaves(node)})
          </span>
        )}
      </button>
      {isExpanded && orderedChildren.length > 0 && (
        <div>{orderedChildren.map(renderChild)}</div>
      )}
    </div>
  );
}

/** Count leaf nodes under a branch */
function countLeaves(node: TaxonomyNode): number {
  if (node.def && !node.children) return 1;
  return node.children?.reduce((sum, child) => sum + countLeaves(child), 0) ?? 0;
}

function PaletteLeaf({
  item,
  compact,
  depth,
  isFavorite,
  isDefault = false,
  shortcut,
  onAdd,
  onDragStart,
  onToggleFavorite,
}: {
  item: PnlObjectDef;
  compact: boolean;
  depth: number;
  isFavorite: boolean;
  isDefault?: boolean;
  /** #372: a shortcut in the icon strip, which the tooltip names. */
  shortcut?: "favourite" | "recent";
  onAdd: (item: PnlObjectDef, viaKeyboard?: boolean) => void;
  onDragStart: (e: DragEvent, item: PnlObjectDef) => void;
  onToggleFavorite: () => void;
}) {
  // #252: picked up and waiting to be put on the graph.
  // #387: shaded and outlined in the selection colours (index.css, keyed
  // on data-armed), like the open category's strip icon.
  const armed = usePaletteStore((s) => s.armed?.type === item.type);
  // #283: the component's icon, in its type colour. The text glyph is only a
  // fallback; componentIcons.test.ts checks every item has an icon.
  const icon = iconForType(item.type);
  if (compact) {
    const name = item.label || item.type;
    const title =
      shortcut === "favourite"
        ? `Favourite: ${name}. Click, then click the graph to place it`
        : shortcut === "recent"
          ? `Recently used: ${name}. Click, then click the graph to place it`
          : `${item.type} \u2014 drag onto the graph, or click it and then click where it goes`;
    return (
      <div
        draggable
        onDragStart={(e) => onDragStart(e, item)}
        onDragEnd={endDrag}
        onClick={() => onAdd(item)}
        // A strip icon is a button to the keyboard too: Tab reaches it, and
        // Enter or Space picks it up as a click does.
        role="button"
        tabIndex={0}
        onKeyDown={(e) => activateOnKey(e, () => onAdd(item, true))}
        aria-label={title}
        data-testid="palette-item"
        data-type={item.type}
        data-shortcut={shortcut}
        data-armed={armed ? "true" : undefined}
        aria-pressed={armed}
        title={title}
        className="pnv-palette-tile"
        style={{
          width: 32,
          height: 32,
          margin: "2px auto",
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "grab",
          fontSize: "var(--pnv-fs-11)",
          fontWeight: 700,
          color: item.color,
          userSelect: "none",
        }}
      >
        {icon ? <ComponentIcon icon={icon} size={16} color={item.color} /> : item.icon}
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, item)}
      onDragEnd={endDrag}
      onClick={() => onAdd(item)}
      data-testid="palette-item"
      data-type={item.type}
      data-armed={armed ? "true" : undefined}
      className="pnv-palette-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 12px",
        paddingLeft: 12 + (depth + 1) * 12,
        cursor: "grab",
        userSelect: "none",
        borderRadius: 4,
        fontSize: "var(--pnv-fs-12)",
      }}
      title={`${item.type} \u2014 drag onto the graph, or click it and then click where it goes`}
    >
      {/* Icon, centred where the 8px colour dot was, taking the dot's width in
          the row (the negative margins) so the labels stay where they were. */}
      {icon ? (
        <ComponentIcon icon={icon} size={14} color={item.color} style={{ margin: "0 -3px" }} />
      ) : (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: item.color,
            flexShrink: 0,
          }}
        />
      )}
      {/* Label. #411: the name is what the keyboard picks up: Tab reaches it,
          Enter or Space picks it up (as a click on the row does), and the
          arrows move between the names in a strip menu. Not a <button>: the
          star beside it is one, and a button can't hold a button; a span
          also leaves the row's drag and hover exactly as they were. */}
      <span
        role="button"
        tabIndex={0}
        aria-pressed={armed}
        data-testid="palette-item-pick"
        data-flyout-item=""
        onKeyDown={(e) => activateOnKey(e, () => onAdd(item, true))}
        style={{ flex: 1, color: "var(--pnv-text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {isDefault ? item.type : item.label}
        {isDefault && (
          <span style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", marginLeft: 6, fontWeight: 400 }}>
            (base)
          </span>
        )}
      </span>
      {/* Favourite star (#372): the empty star shows on hover or keyboard
          focus only (index.css .pnv-fav-star); a starred row keeps a small
          filled star. */}
      <Button
        kind="link"
        className="pnv-fav-star"
        data-testid="palette-fav-star"
        data-starred={isFavorite ? "true" : "false"}
        aria-label={isFavorite ? `Remove ${item.label || item.type} from favorites` : `Add ${item.label || item.type} to favorites`}
        aria-pressed={isFavorite}
        title={isFavorite ? "Remove from favorites" : "Add to favorites"}
        draggable={false}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        style={{
          fontSize: isFavorite ? "var(--pnv-fs-11)" : "var(--pnv-fs-13)",
          color: isFavorite ? "var(--pnv-favorite)" : "var(--pnv-text-faint)",
          textDecoration: "none",
          lineHeight: 1,
          padding: 0,
          flexShrink: 0,
        }}
      >
        {isFavorite ? "\u2605" : "\u2606"}
      </Button>
    </div>
  );
}

function SectionHeader({ label, icon }: { label: string; icon?: string }) {
  return (
    <div
      style={{
        fontSize: "var(--pnv-fs-10)",
        fontWeight: 600,
        color: "var(--pnv-text-hint)",
        padding: "4px 12px 2px",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      {icon && <span>{icon}</span>}
      {label}
    </div>
  );
}

/** Smallest size a strip heading shrinks to, so it stays legible. */
const STRIP_HEADING_MIN_PX = 5;

/**
 * Every word the icon strip uses as a heading (#395). Each heading is sized to
 * fit the widest of these on one line, so "Components" and "Recent" come out
 * the same tiny size rather than "Recent" looking larger.
 */
const STRIP_HEADING_WORDS = ["Components", "Recent"] as const;
type StripHeadingWord = (typeof STRIP_HEADING_WORDS)[number];

/**
 * A tiny heading in the icon strip (#372), shown only when the strip's
 * headings are on (#395). The word always sits on one line within the strip.
 * It starts at the smallest text size; if the widest heading word
 * ("Components") is still too wide at that size, the font shrinks until that
 * word fits, and every heading takes that same size so they match. Hidden
 * copies of each word are measured, so a change of Text size or font refits
 * them.
 */
function StripHeading({ text, testId, label }: { text: StripHeadingWord; testId: string; label: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  // Each heading word at the full smallest-text size, and at the fitted size.
  const measureRef = useRef<HTMLSpanElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [fitPx, setFitPx] = useState<number | null>(null);

  const widest = (holder: HTMLElement | null) =>
    holder ? Math.max(0, ...Array.from(holder.children, (c) => c.getBoundingClientRect().width)) : 0;

  useLayoutEffect(() => {
    const box = boxRef.current;
    const measure = measureRef.current;
    if (!box || !measure) return;
    const fit = () => {
      const natural = widest(measure);
      const fullPx = parseFloat(getComputedStyle(measure).fontSize);
      // The strip's width inside its padding, less a pixel of air.
      const room = box.clientWidth - 1;
      if (!natural || !fullPx || room <= 0 || natural <= room) {
        setFitPx(null);
        return;
      }
      // Round down to a tenth of a pixel so it never lands a hair too wide.
      setFitPx(Math.max(STRIP_HEADING_MIN_PX, Math.floor(((fullPx * room) / natural) * 10) / 10));
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    // The word copies, not their zero-size holder, change size with the text.
    for (const word of Array.from(measure.children)) ro.observe(word);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // Small text doesn't scale exactly (glyphs snap to pixels), so check the
  // widest word as drawn at the fitted size and step down a tenth of a pixel
  // while it is too wide. Every heading checks the same words, so they all
  // settle on the same size.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (fitPx === null || !box || fitPx <= STRIP_HEADING_MIN_PX) return;
    if (widest(probeRef.current) > box.clientWidth - 1) {
      setFitPx(Math.max(STRIP_HEADING_MIN_PX, Math.round((fitPx - 0.1) * 10) / 10));
    }
  }, [fitPx]);

  const font = { fontWeight: 600, whiteSpace: "nowrap" } as const;
  const size = fitPx === null ? "var(--pnv-fs-9)" : `${fitPx}px`;
  const hidden = { position: "absolute", left: 0, top: 0, visibility: "hidden", pointerEvents: "none" } as const;
  return (
    <div
      ref={boxRef}
      data-testid={testId}
      role="heading"
      aria-level={3}
      aria-label={label}
      style={{
        position: "relative",
        // The secondary text, not the hint grey: words this small need the
        // stronger contrast (the hint grey was 3.4:1, under WCAG AA).
        color: "var(--pnv-text-secondary)",
        textAlign: "center",
        lineHeight: 1.15,
        // Inside the strip's 4px padding, as the icons are: the panel's
        // resize handle lies over the strip's left 4px and would hide the
        // first letter of a word that ran into it.
        padding: "4px 0 2px",
        overflow: "hidden",
      }}
    >
      <span data-testid={`${testId}-text`} style={{ ...font, fontSize: size }}>
        {text}
      </span>
      <span ref={measureRef} aria-hidden style={{ ...hidden, fontSize: "var(--pnv-fs-9)" }}>
        {STRIP_HEADING_WORDS.map((w) => (
          <span key={w} style={{ ...font, position: "absolute", left: 0, top: 0 }}>{w}</span>
        ))}
      </span>
      <span ref={probeRef} aria-hidden style={{ ...hidden, fontSize: size }}>
        {STRIP_HEADING_WORDS.map((w) => (
          <span key={w} style={{ ...font, position: "absolute", left: 0, top: 0 }}>{w}</span>
        ))}
      </span>
    </div>
  );
}

/**
 * With the strip's headings off (#395), a thin line keeps the shortcuts apart
 * from the category menus, in the room a heading would take.
 */
function StripDivider() {
  return (
    <div
      data-testid="palette-strip-divider"
      role="separator"
      aria-label="Recent and favourite components"
      style={{ margin: "2px 4px 4px", borderTop: "1px solid var(--pnv-border)" }}
    />
  );
}

function IconButton({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 22,
        height: 22,
        border: "1px solid var(--pnv-border)",
        borderRadius: 3,
        background: "var(--pnv-surface)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "var(--pnv-fs-10)",
        color: "var(--pnv-text-muted)",
        padding: 0,
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}

/** Enter or Space on a strip icon or a component's name does what a click does. */
function activateOnKey(e: KeyboardEvent, act: () => void) {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  e.stopPropagation();
  act();
}

function CompactCategoryIcon({
  node,
  isActive,
}: {
  node: TaxonomyNode;
  isActive: boolean;
}) {
  const icon = iconForCategory(node.id);
  const toggle = (fromKeyboard = false) => {
    const store = usePaletteStore.getState();
    if (store.compactFlyoutNodeId === node.id) store.closeCompactFlyout();
    else store.openCompactFlyout(node.id, fromKeyboard);
  };
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        toggle(false);
      }}
      // Keyboard: Tab reaches it, Enter or Space opens or closes its menu.
      role="button"
      tabIndex={0}
      // #411: opened from the keyboard, the menu takes focus.
      onKeyDown={(e) => activateOnKey(e, () => toggle(true))}
      aria-label={node.label}
      aria-expanded={isActive}
      title={node.label}
      data-testid="palette-category"
      data-category={node.id}
      // #387: the open category is shaded as well as outlined (index.css).
      data-active={isActive ? "true" : undefined}
      className="pnv-palette-tile"
      style={{
        width: 32,
        height: 32,
        margin: "2px auto",
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        fontSize: "var(--pnv-fs-14)",
        fontWeight: 700,
        color: "var(--pnv-text-body)",
        userSelect: "none",
      }}
    >
      {icon ? (
        <ComponentIcon icon={icon} size={18} color="var(--pnv-text-body)" />
      ) : (
        node.label.charAt(0).toUpperCase()
      )}
    </div>
  );
}

function CompactFlyout({
  nodeId,
  favorites,
  onAdd,
  onDragStart,
}: {
  nodeId: string;
  favorites: string[];
  onAdd: (item: PnlObjectDef, viaKeyboard?: boolean) => void;
  onDragStart: (e: DragEvent, item: PnlObjectDef) => void;
}) {
  const node = findNode(nodeId);
  const path = pathTo(nodeId) ?? [];
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current && ref.current.contains(t)) return;
      // Ignore clicks inside the sidebar column itself — those switch categories.
      const sidebar = ref.current?.parentElement;
      if (sidebar && sidebar.contains(t)) return;
      usePaletteStore.getState().closeCompactFlyout();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  // #411: opened from the keyboard (or a sub-menu entered with Enter), focus
  // goes to the menu's first row, so Tab and the arrows start there rather
  // than after the graph's controls. Opened with the mouse, focus stays put.
  const fromKeyboard = usePaletteStore((s) => s.compactFlyoutFromKeyboard);
  useEffect(() => {
    if (!fromKeyboard) return;
    ref.current?.querySelector<HTMLElement>("[data-flyout-item]")?.focus();
  }, [nodeId, fromKeyboard]);
  // The menu's category icon in the strip, where focus goes back to.
  const categoryIcon = () =>
    ref.current?.parentElement?.querySelector<HTMLElement>('[data-testid="palette-category"][aria-expanded="true"]') ?? null;
  // Escape closes the flyout through the shared stack (#1289); from inside
  // it, focus goes back to its icon in the strip (#411).
  useDismiss(true, () => {
    const back = ref.current?.contains(document.activeElement) ? categoryIcon() : null;
    usePaletteStore.getState().closeCompactFlyout();
    back?.focus();
  });
  // #411: the arrows move between the menu's rows; Home and End go to the ends.
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-flyout-item]"));
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "Home" ? 0
      : e.key === "End" ? items.length - 1
      : e.key === "ArrowDown" ? (at + 1) % items.length
      : (at <= 0 ? items.length : at) - 1;
    items[next].focus();
  };

  if (!node) return null;

  // Reorder so the family-base leaf appears first (consistent with #110).
  const rawChildren = node.children ?? [];
  const defaultChild = node.defaultLeafId
    ? rawChildren.find((c) => c.id === node.defaultLeafId && c.def)
    : undefined;
  const orderedChildren = defaultChild
    ? [defaultChild, ...rawChildren.filter((c) => c.id !== defaultChild.id)]
    : rawChildren;

  return (
    <div
      ref={ref}
      data-testid="palette-compact-flyout"
      style={{
        position: "absolute",
        left: 48,
        top: 0,
        bottom: 0,
        width: 240,
        background: "var(--pnv-surface)",
        borderRight: "1px solid var(--pnv-border-faint)",
        boxShadow: "var(--pnv-shadow-flyout)",
        display: "flex",
        flexDirection: "column",
        zIndex: 20,
      }}
    >
      {/* Breadcrumb header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "8px 10px",
          borderBottom: "1px solid var(--pnv-border-faint)",
          fontSize: "var(--pnv-fs-11)",
          color: "var(--pnv-text-body)",
          flexShrink: 0,
        }}
      >
        <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {path.map((seg, i) => (
            <span key={seg.id}>
              {i > 0 && <span style={{ color: "var(--pnv-text-faint)", margin: "0 4px" }}>{"▸"}</span>}
              <button
                onClick={(e) => usePaletteStore.getState().openCompactFlyout(seg.id, e.detail === 0)}
                disabled={i === path.length - 1}
                style={{
                  border: "none",
                  background: "none",
                  padding: 0,
                  cursor: i === path.length - 1 ? "default" : "pointer",
                  fontSize: "var(--pnv-fs-11)",
                  color: i === path.length - 1 ? "var(--pnv-text-body)" : "var(--pnv-primary)",
                  fontWeight: i === path.length - 1 ? 600 : 400,
                }}
              >
                {seg.label}
              </button>
            </span>
          ))}
        </div>
        <button
          onClick={() => usePaletteStore.getState().closeCompactFlyout()}
          title="Close"
          style={{
            border: "none",
            background: "none",
            cursor: "pointer",
            fontSize: "var(--pnv-fs-13)",
            color: "var(--pnv-text-hint)",
            padding: "0 2px",
            lineHeight: 1,
          }}
        >
          {"✕"}
        </button>
      </div>

      {/* Body */}
      <div
        role="group"
        aria-label={node.label}
        data-testid="palette-flyout-body"
        onKeyDown={onMenuKey}
        style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}
      >
        {orderedChildren.map((child) => {
          // Default base leaf — render with isDefault, like in expanded mode.
          if (defaultChild && child.id === defaultChild.id && child.def) {
            return (
              <PaletteLeaf
                key={child.id}
                item={child.def}
                compact={false}
                depth={0}
                isFavorite={favorites.includes(child.def.type)}
                isDefault
                onAdd={onAdd}
                onDragStart={onDragStart}
                onToggleFavorite={() => usePaletteStore.getState().toggleFavorite(child.def!.type)}
              />
            );
          }
          // Singleton flatten — branch with one bare leaf renders as that leaf.
          if (
            !child.def &&
            child.children?.length === 1 &&
            child.children[0].def &&
            !child.children[0].children
          ) {
            const cd = child.children[0].def;
            return (
              <PaletteLeaf
                key={child.id}
                item={cd}
                compact={false}
                depth={0}
                isFavorite={favorites.includes(cd.type)}
                onAdd={onAdd}
                onDragStart={onDragStart}
                onToggleFavorite={() => usePaletteStore.getState().toggleFavorite(cd.type)}
              />
            );
          }
          // Direct leaf
          if (child.def && !child.children) {
            return (
              <PaletteLeaf
                key={child.id}
                item={child.def}
                compact={false}
                depth={0}
                isFavorite={favorites.includes(child.def.type)}
                onAdd={onAdd}
                onDragStart={onDragStart}
                onToggleFavorite={() => usePaletteStore.getState().toggleFavorite(child.def!.type)}
              />
            );
          }
          // Sub-branch — drill in on click
          return (
            <button
              key={child.id}
              // A click from the keyboard (Enter, Space) has no click count:
              // the sub-menu then takes focus too (#411).
              onClick={(e) => usePaletteStore.getState().openCompactFlyout(child.id, e.detail === 0)}
              data-flyout-item=""
              // #387: hover tints like a component row, lighter than the
              // picked-up one (index.css).
              className="pnv-palette-row"
              data-testid="palette-flyout-branch"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: "100%",
                padding: "6px 12px",
                border: "none",
                cursor: "pointer",
                fontSize: "var(--pnv-fs-12)",
                color: "var(--pnv-text-body)",
                textAlign: "left",
              }}
            >
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {child.label}
              </span>
              <span style={{ fontSize: "var(--pnv-fs-9)", color: "var(--pnv-text-faint)" }}>({countLeaves(child)})</span>
              <span style={{ color: "var(--pnv-text-hint)", fontSize: "var(--pnv-fs-10)" }}>{"▸"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
