/**
 * Which input port a dragged connection goes into, when the receiver has
 * several (#253); for a control mechanism, which parameter it controls, and
 * for a gating mechanism, which port it gates (stage 3). Closes like every
 * other menu (#1289): Escape, a click anywhere else, or a pick.
 */
import { useEffect, useRef } from "react";
import { useDismiss } from "@/components/common/dialog/useDismiss";
import { Z_MENU } from "@/constants/zLayers";

export interface ConnectionOption {
  type: string;
  /** Left out for a control or gating mechanism: PsyNeuLink adds a signal for it. */
  sender_port?: string;
  receiver_port: string;
  /** Which of the receiver's ports `receiver_port` is: input (the default), output or parameter. */
  receiver_port_kind?: "input" | "output" | "parameter";
  /** The variable to declare the projection as, when PsyNeuLink's answer names one. */
  var_name?: string;
  /** The sender's variable, when the canvas knows it by another name (#253 stage 3). */
  sender?: string;
  /** Into a collapsed composition: the input node it goes into (#253). */
  receiver?: string;
  /** What the chooser lists for it, when not just the port's name. */
  label?: string;
  /** The composition to add the projection to, when PsyNeuLink names one. */
  composition?: string;
}

/** What the chooser asks, by what the drop needs chosen. */
export function chooserQuestion(ask: string | undefined, receiver: string): [string, string] {
  if (ask === "parameter") return ["Control which parameter of", "?"];
  if (ask === "port") return ["Gate which port of", "?"];
  return ["Connect into which input of", "?"];
}

export function PortChooser({ x, y, receiver, ask, options, onPick, onClose }: {
  x: number;
  y: number;
  receiver: string;
  /** "parameter" (a control mechanism), "port" (a gating one), or an input. */
  ask?: string;
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
  const question = chooserQuestion(ask, receiver);
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
        // A mechanism has many parameters (#253): the list scrolls.
        maxHeight: `min(60vh, max(160px, calc(100vh - ${Math.round(y)}px - 16px)))`,
        overflowY: "auto",
        padding: "4px 0",
        fontSize: "var(--pnv-fs-13)",
      }}
    >
      <div style={{ padding: "4px 14px 6px", color: "var(--pnv-text-secondary)", fontSize: "var(--pnv-fs-12)" }}>
        {question[0]} <b>{receiver}</b>{question[1]}
      </div>
      {options.map((o) => (
        <button
          key={`${o.receiver ?? ""}/${o.receiver_port_kind ?? "input"}/${o.receiver_port}`}
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
          {o.label ?? o.receiver_port}
        </button>
      ))}
    </div>
  );
}
