/**
 * The toolbar's model title: which model is open, as the menus name it (#422).
 *
 * Two lines within the toolbar's height: the menu label on top, and below it
 * in small text the file name (for the user's own file, its folder) and the
 * source tag. From the identity the server gives every open
 * (stores/modelIdentityStore.ts). What is dropped when space runs out follows
 * one written rule (utils/modelTitle.ts, and docs/file-conventions.md).
 * Clicking it opens the model card: everything in full, with a Copy path
 * button. The window or tab title is the label.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/common/Button";
import { DialogHeader } from "@/components/common/dialog/DialogHeader";
import { useDismiss } from "@/components/common/dialog/useDismiss";
import { Z_MENU } from "@/constants/zLayers";
import { useModelIdentity, useModelIdentityStore } from "@/stores/modelIdentityStore";
import {
  SOURCE_DESCRIPTION,
  SOURCE_TAG,
  abbreviateHome,
  fitTitle,
  titleParts,
  windowTitle,
  type ModelIdentity,
  type TitleParts,
} from "@/utils/modelTitle";
import { pnlSourceName, type PsyNeuLinkInfo } from "@/utils/pnlSources";

const GAP = 6;

const STYLE: Record<keyof TitleParts, CSSProperties> = {
  label: { fontSize: "var(--pnv-fs-12)", fontWeight: 600, color: "var(--pnv-text)" },
  file: { fontSize: "var(--pnv-fs-11)", fontFamily: "var(--pnv-font-mono)", color: "var(--pnv-text-hint)" },
  tag: {
    fontSize: "var(--pnv-fs-10)",
    fontWeight: 600,
    color: "var(--pnv-primary-text-on-tint)",
    background: "var(--pnv-primary-tint)",
    // An inset outline, not a border: the tag's box is then exactly its line's
    // height and sits on the same top as the file name beside it.
    boxShadow: "inset 0 0 0 1px var(--pnv-primary-tint-border)",
    borderRadius: 3,
    padding: "0 5px",
  },
  folder: { fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-faint)" },
};

/** Line 2 is smaller throughout. */
const SMALL: Partial<Record<keyof TitleParts, CSSProperties>> = {
  label: { fontSize: "var(--pnv-fs-10)", fontWeight: 400, fontFamily: "var(--pnv-font-mono)", color: "var(--pnv-text-hint)" },
  folder: { fontSize: "var(--pnv-fs-10)" },
  tag: { lineHeight: "12px", height: 12, padding: "0 4px" },
};

const ONE_LINE: CSSProperties = { whiteSpace: "nowrap", flexShrink: 0 };

/** A width measurer: a hidden span styled like each part. */
function useMeasure(small: boolean) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const measure = (text: string, part: keyof TitleParts) => {
    const el = ref.current;
    if (!el) return text.length * 7;
    Object.assign(el.style, { fontSize: "", fontWeight: "", fontFamily: "", padding: "", border: "", lineHeight: "" });
    Object.assign(el.style, STYLE[part], small ? SMALL[part] : {});
    el.textContent = text;
    const w = el.getBoundingClientRect().width;
    // Left empty, so the page never holds a second, hidden copy of the title.
    el.textContent = "";
    return w;
  };
  const hidden: CSSProperties = { position: "absolute", visibility: "hidden", whiteSpace: "nowrap", left: -10000, top: 0 };
  const node = (
    <>
      <span ref={ref} aria-hidden="true" style={hidden} />
    </>
  );
  return { measure, node };
}

/** Everything about the open model in full, in the hover text. */
export function identityTooltip(id: ModelIdentity, bundleOrigin?: string | null): string {
  const lines = [id.label ?? id.file];
  if (id.label) lines.push(id.file);
  lines.push(SOURCE_DESCRIPTION[id.source], bundleOrigin ?? id.path);
  if (id.workingCopy && id.original) lines.push(`Your working copy of ${id.original}`);
  lines.push("(click for the model card)");
  return lines.join("\n");
}

export function ModelTitle({
  filePath,
  bundleOrigin,
  available,
}: {
  filePath: string;
  bundleOrigin?: string | null;
  /** Pixels the title may take; measured by the toolbar chip around it. */
  available: number;
}) {
  const identity = useModelIdentity(filePath);
  const ensure = useModelIdentityStore((s) => s.ensure);
  useEffect(() => {
    void ensure(filePath);
  }, [filePath, ensure]);

  // The window or tab title is the label (#422).
  useEffect(() => {
    document.title = windowTitle(identity);
    return () => {
      document.title = "PsyNeuView";
    };
  }, [identity]);

  const [cardOpen, setCardOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!cardOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setCardOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [cardOpen]);
  useDismiss(cardOpen, () => setCardOpen(false));

  const big = useMeasure(false);
  const small = useMeasure(true);

  const id: ModelIdentity =
    identity ?? { source: "user", label: null, file: filePath.split("/").pop() || filePath, path: filePath };
  const parts = titleParts(id);
  // Line 2 leads with the file name, or for the user's own file its folder.
  const secondKind: "file" | "folder" = parts.file ? "file" : "folder";
  const second = parts.file ?? parts.folder ?? "";

  const [fitted, setFitted] = useState<{ label: string; second: string; tag: string | null } | null>(null);
  useLayoutEffect(() => {
    const room = Math.max(0, available);
    // Each line by the same rule: line 1 is the label alone; line 2 drops
    // the tag before it shortens the file name (or folder).
    const one = fitTitle({ label: parts.label, file: null, tag: "", folder: null }, room, big.measure, GAP);
    const two = fitTitle({ label: second, file: null, tag: parts.tag, folder: null }, room, small.measure, GAP);
    setFitted({ label: one.label, second: second ? two.label : "", tag: two.tag });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, parts.label, second, parts.tag]);

  const shown = fitted ?? { label: parts.label, second, tag: parts.tag };
  const tooltip = identityTooltip(id, bundleOrigin);

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "flex", minWidth: 0, overflow: "visible" }}>
      {big.node}
      {small.node}
      <button
        type="button"
        data-testid="model-title"
        data-model-source={id.source}
        data-model-file={id.file}
        aria-label={`${id.label ? `${id.label}, ${id.file}` : id.file} (${SOURCE_TAG[id.source]}): model details`}
        aria-expanded={cardOpen}
        aria-haspopup="dialog"
        onClick={() => setCardOpen((o) => !o)}
        title={tooltip}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          minWidth: 0,
          overflow: "hidden",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", lineHeight: "15px", height: 15 }}>
          <span data-testid="model-title-label" style={{ ...ONE_LINE, ...STYLE.label }}>{shown.label}</span>
        </span>
        {(shown.second || shown.tag) && (
          <span style={{ display: "flex", gap: GAP, alignItems: "center", lineHeight: "12px", height: 12 }}>
            {shown.second && (
              <span
                data-testid={`model-title-${secondKind}`}
                style={{ ...ONE_LINE, ...(secondKind === "file" ? { ...STYLE.label, ...SMALL.label } : { ...STYLE.folder, ...SMALL.folder }) }}
              >
                {shown.second}
              </span>
            )}
            {shown.tag && (
              <span data-testid="model-title-source" style={{ ...ONE_LINE, ...STYLE.tag, ...SMALL.tag }}>
                {shown.tag}
              </span>
            )}
          </span>
        )}
      </button>
      {cardOpen && <ModelCard identity={id} bundleOrigin={bundleOrigin} onClose={() => setCardOpen(false)} />}
    </span>
  );
}

function Row({ name, children, testId }: { name: string; children: React.ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: 8, alignItems: "baseline" }}>
      <span style={{ color: "var(--pnv-text-hint)" }}>{name}</span>
      <span style={{ wordBreak: "break-all" }}>{children}</span>
    </div>
  );
}

/** The model card: everything about the open model, in full (#422). */
function ModelCard({
  identity,
  bundleOrigin,
  onClose,
}: {
  identity: ModelIdentity;
  bundleOrigin?: string | null;
  onClose: () => void;
}) {
  const [pnl, setPnl] = useState<PsyNeuLinkInfo | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/settings/info")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && d && setPnl(d.psyneulink ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const path = bundleOrigin ?? identity.path;
  const copy = () => {
    void navigator.clipboard?.writeText(path);
    setCopied(true);
  };
  return (
    <div
      role="dialog"
      aria-labelledby="model-card-title"
      data-testid="model-card"
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        zIndex: Z_MENU,
        width: 420,
        display: "flex",
        flexDirection: "column",
        background: "var(--pnv-surface)",
        border: "1px solid var(--pnv-border)",
        borderRadius: 6,
        boxShadow: "var(--pnv-shadow-popover)",
        whiteSpace: "normal",
        textAlign: "left",
      }}
    >
      <DialogHeader title="This model" titleId="model-card-title" onClose={onClose} compact />
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text)" }}>
        <Row name="Name" testId="model-card-label">{identity.label ?? identity.file}</Row>
        <Row name="File"><span style={{ fontFamily: "var(--pnv-font-mono)" }}>{identity.file}</span></Row>
        <Row name="From" testId="model-card-source">{SOURCE_DESCRIPTION[identity.source]}</Row>
        <Row name="Full path" testId="model-card-path">{abbreviateHome(path)}</Row>
        {identity.workingCopy && identity.original && (
          <Row name="Working copy" testId="model-card-working-copy">
            Your editable copy, in {abbreviateHome(identity.path.replace(/\/[^/]*$/, ""))}. Made from{" "}
            {abbreviateHome(identity.original)}.
          </Row>
        )}
        <Row name="PsyNeuLink" testId="model-card-pnl">
          {pnl ? `${pnl.version ?? "unknown version"}${pnlSourceName(pnl) ? `, ${pnlSourceName(pnl)}` : ""}` : "…"}
        </Row>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 12px 12px" }}>
        <Button kind="secondary" size="compact" data-testid="model-card-copy-path" onClick={copy}>
          {copied ? "Copied" : "Copy path"}
        </Button>
      </div>
    </div>
  );
}
