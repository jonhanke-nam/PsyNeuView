/**
 * Which input port a dragged connection goes into, when the receiver has
 * several (#253). Closes like every other menu (#1289): Escape, a click
 * anywhere else, or a pick.
 */
import { useEffect, useRef } from "react";
import { useDismiss } from "@/components/common/dialog/useDismiss";
import { Z_MENU } from "@/constants/zLayers";

export interface ConnectionOption {
  type: string;
  sender_port: string;
  receiver_port: string;
}

export function PortChooser({ x, y, receiver, options, onPick, onClose }: {
  x: number;
  y: number;
  receiver: string;
  options: ConnectionOption[];
  onPick: (option: ConnectionOption) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  useDismiss(true, onClose);
  return (
    <div
      ref={ref}
      role="menu"
      data-testid="port-chooser"
      style={{
        position: "fixed",
        left: x,
        top: y,
        background: "var(--pnv-surface)",
        border: "1px solid var(--pnv-border-light)",
        borderRadius: 6,
        boxShadow: "var(--pnv-shadow-popover)",
        zIndex: Z_MENU,
        minWidth: 180,
        padding: "4px 0",
        fontSize: "var(--pnv-fs-13)",
      }}
    >
      <div style={{ padding: "4px 14px 6px", color: "var(--pnv-text-secondary)", fontSize: "var(--pnv-fs-12)" }}>
        Connect into which input of <b>{receiver}</b>?
      </div>
      {options.map((o) => (
        <button
          key={o.receiver_port}
          role="menuitem"
          data-testid="port-chooser-option"
          onClick={() => onPick(o)}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "6px 14px",
            border: "none",
            background: "none",
            cursor: "pointer",
            fontSize: "var(--pnv-fs-13)",
            color: "var(--pnv-text-body)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--pnv-primary-tint)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
        >
          {o.receiver_port}
        </button>
      ))}
    </div>
  );
}
