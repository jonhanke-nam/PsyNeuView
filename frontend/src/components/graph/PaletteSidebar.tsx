/**
 * Collapsible sidebar palette for adding PsyNeuLink objects to the graph.
 * Features: recursive tree hierarchy, type-ahead search, favorites, recently used.
 * Items can be dragged onto the canvas or clicked to add.
 */

import { type DragEvent, useEffect, useMemo, useRef } from "react";
import { useModelStore } from "@/stores/modelStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { usePaletteStore } from "@/stores/paletteStore";
import {
  PNL_TAXONOMY_TREE,
  ALL_PNL_DEFS,
  findDefByType,
  type PnlObjectDef,
  type TaxonomyNode,
} from "@/constants/pnlTypes";
import { addNodeToModel } from "@/utils/nodeActions";
import { useDismiss } from "@/components/common/dialog/useDismiss";

// TODO(#74): replace with real ontology icons once the official PsyNeuLink icon set is in.
const COMPACT_GLYPHS: Record<string, string> = {
  mechanisms: "M",
  projections: "→",
  compositions: "C",
  functions: "ƒ",
  ports: "•",
};

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

  if (!isOpen) return null;

  const handleAdd = (item: PnlObjectDef) => {
    if (!filePath) return;
    addNodeToModel(filePath, item.type, item.defaults, setSource, loadModelFromServer, addNotification);
    usePaletteStore.getState().addRecentlyUsed(item.type);
  };

  const handleDragStart = (e: DragEvent, item: PnlObjectDef) => {
    e.dataTransfer.setData(
      "application/psynewview-node",
      JSON.stringify({ type: item.type, defaults: item.defaults }),
    );
    e.dataTransfer.effectAllowed = "move";
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
      {/* Header */}
      <div
        style={{
          padding: isCompact ? "8px 4px" : "8px 12px",
          borderBottom: "1px solid var(--pnv-border-faint)",
          display: "flex",
          alignItems: "center",
          justifyContent: isCompact ? "center" : "space-between",
          gap: 4,
          flexShrink: 0,
        }}
      >
        {!isCompact && (
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--pnv-text-body)" }}>Components</span>
        )}
        <div style={{ display: "flex", gap: 2 }}>
          <IconButton
            title={isCompact ? "Expand palette" : "Compact mode"}
            onClick={() => usePaletteStore.getState().toggleCompact()}
          >
            {isCompact ? "\u25B6" : "\u25C0"}
          </IconButton>
          {!isCompact && (
            <IconButton
              title="Close palette"
              onClick={() => usePaletteStore.getState().setOpen(false)}
            >
              {"\u2715"}
            </IconButton>
          )}
        </div>
      </div>

      {/* Search bar */}
      {!isCompact && (
        <div style={{ padding: "8px 12px 4px", flexShrink: 0 }}>
          <input
            type="text"
            placeholder="Search components..."
            value={searchQuery}
            onChange={(e) => usePaletteStore.getState().setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              fontSize: 12,
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
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: isCompact ? 4 : 0 }}>
        {/* Search results mode */}
        {filteredItems !== null ? (
          <div style={{ padding: isCompact ? 0 : 8 }}>
            {!isCompact && (
              <SectionHeader label={`Results (${filteredItems.length})`} />
            )}
            {filteredItems.length === 0 && !isCompact && (
              <div style={{ fontSize: 11, color: "var(--pnv-text-faint)", padding: "8px 12px" }}>
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
            {favoriteItems.length > 0 && (
              <div style={{ padding: isCompact ? 0 : 8 }}>
                {!isCompact && <SectionHeader label="Favorites" icon={"\u2605"} />}
                {isCompact && <CompactDivider color="var(--pnv-favorite)" />}
                {favoriteItems.map((item) => (
                  <PaletteLeaf
                    key={`fav-${item.type}`}
                    item={item}
                    compact={isCompact}
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
            {recentItems.length > 0 && (
              <div style={{ padding: isCompact ? 0 : 8 }}>
                {!isCompact && <SectionHeader label="Recently Used" icon={"\u29D6"} />}
                {isCompact && <CompactDivider color="var(--pnv-primary)" />}
                {recentItems.map((item) => (
                  <PaletteLeaf
                    key={`recent-${item.type}`}
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
            )}

            {/* Taxonomy tree */}
            <div style={{ padding: isCompact ? 0 : "4px 0" }}>
              {isCompact ? (
                <>
                  {(favoriteItems.length > 0 || recentItems.length > 0) && (
                    <CompactDivider color="var(--pnv-text-hint)" />
                  )}
                  {PNL_TAXONOMY_TREE.map((node) => (
                    <CompactCategoryIcon
                      key={node.id}
                      node={node}
                      isActive={compactFlyoutNodeId !== null &&
                        (compactFlyoutNodeId === node.id ||
                         compactFlyoutNodeId.startsWith(node.id + "."))}
                    />
                  ))}
                </>
              ) : (
                PNL_TAXONOMY_TREE.map((node) => (
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
  onAdd: (item: PnlObjectDef) => void;
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
        data-testid={isTopLevel ? `palette-section-${node.id}` : undefined}
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
        <span
          style={{
            display: "inline-block",
            transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
            // 8px read as a speck rather than a control, which matters more now
            // that it is the thing you click to open every category.
            fontSize: 11,
            flexShrink: 0,
          }}
        >
          {"\u25B6"}
        </span>
        {node.label}
        {!isTopLevel && node.children && (
          <span style={{ fontSize: 9, color: "var(--pnv-text-faint)", marginLeft: 4 }}>
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
  onAdd,
  onDragStart,
  onToggleFavorite,
}: {
  item: PnlObjectDef;
  compact: boolean;
  depth: number;
  isFavorite: boolean;
  isDefault?: boolean;
  onAdd: (item: PnlObjectDef) => void;
  onDragStart: (e: DragEvent, item: PnlObjectDef) => void;
  onToggleFavorite: () => void;
}) {
  if (compact) {
    return (
      <div
        draggable
        onDragStart={(e) => onDragStart(e, item)}
        onClick={() => onAdd(item)}
        title={`${item.type} \u2014 drag or click to add`}
        style={{
          width: 32,
          height: 32,
          margin: "2px auto",
          borderRadius: 4,
          border: "1px solid var(--pnv-border)",
          background: "var(--pnv-surface)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "grab",
          fontSize: 11,
          fontWeight: 700,
          color: item.color,
          userSelect: "none",
        }}
      >
        {item.icon}
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, item)}
      onClick={() => onAdd(item)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 12px",
        paddingLeft: 12 + (depth + 1) * 12,
        cursor: "grab",
        userSelect: "none",
        borderRadius: 4,
        fontSize: 12,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "var(--pnv-primary-tint)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
      title={`${item.type} \u2014 drag or click to add`}
    >
      {/* Color dot */}
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: item.color,
          flexShrink: 0,
        }}
      />
      {/* Label */}
      <span style={{ flex: 1, color: "var(--pnv-text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {isDefault ? item.type : item.label}
        {isDefault && (
          <span style={{ fontSize: 10, color: "var(--pnv-text-faint)", marginLeft: 6, fontWeight: 400 }}>
            (base)
          </span>
        )}
      </span>
      {/* Favorite star */}
      <span
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        style={{
          fontSize: 13,
          color: isFavorite ? "var(--pnv-favorite)" : "var(--pnv-text-faint)",
          cursor: "pointer",
          lineHeight: 1,
          flexShrink: 0,
        }}
        title={isFavorite ? "Remove from favorites" : "Add to favorites"}
      >
        {isFavorite ? "\u2605" : "\u2606"}
      </span>
    </div>
  );
}

function SectionHeader({ label, icon }: { label: string; icon?: string }) {
  return (
    <div
      style={{
        fontSize: 10,
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

function CompactDivider({ color }: { color: string }) {
  return (
    <div
      style={{
        height: 2,
        background: color,
        margin: "4px 8px",
        borderRadius: 1,
        opacity: 0.4,
      }}
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
        fontSize: 10,
        color: "var(--pnv-text-muted)",
        padding: 0,
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}

function CompactCategoryIcon({
  node,
  isActive,
}: {
  node: TaxonomyNode;
  isActive: boolean;
}) {
  const glyph = COMPACT_GLYPHS[node.id] ?? node.label.charAt(0).toUpperCase();
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        const store = usePaletteStore.getState();
        if (store.compactFlyoutNodeId === node.id) store.closeCompactFlyout();
        else store.openCompactFlyout(node.id);
      }}
      title={node.label}
      style={{
        width: 32,
        height: 32,
        margin: "2px auto",
        borderRadius: 4,
        border: `1px solid ${isActive ? "var(--pnv-primary)" : "var(--pnv-border)"}`,
        background: isActive ? "var(--pnv-primary-tint)" : "var(--pnv-surface)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        fontSize: 14,
        fontWeight: 700,
        color: "var(--pnv-text-body)",
        userSelect: "none",
      }}
    >
      {glyph}
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
  onAdd: (item: PnlObjectDef) => void;
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
  // Escape closes the flyout through the shared stack (#1289).
  useDismiss(true, () => usePaletteStore.getState().closeCompactFlyout());

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
          fontSize: 11,
          color: "var(--pnv-text-body)",
          flexShrink: 0,
        }}
      >
        <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {path.map((seg, i) => (
            <span key={seg.id}>
              {i > 0 && <span style={{ color: "var(--pnv-text-faint)", margin: "0 4px" }}>{"▸"}</span>}
              <button
                onClick={() => usePaletteStore.getState().openCompactFlyout(seg.id)}
                disabled={i === path.length - 1}
                style={{
                  border: "none",
                  background: "none",
                  padding: 0,
                  cursor: i === path.length - 1 ? "default" : "pointer",
                  fontSize: 11,
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
            fontSize: 13,
            color: "var(--pnv-text-hint)",
            padding: "0 2px",
            lineHeight: 1,
          }}
        >
          {"✕"}
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
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
              onClick={() => usePaletteStore.getState().openCompactFlyout(child.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: "100%",
                padding: "6px 12px",
                border: "none",
                background: "none",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--pnv-text-body)",
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--pnv-primary-tint)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {child.label}
              </span>
              <span style={{ fontSize: 9, color: "var(--pnv-text-faint)" }}>({countLeaves(child)})</span>
              <span style={{ color: "var(--pnv-text-hint)", fontSize: 10 }}>{"▸"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
