/**
 * Custom prompt modal — replaces browser prompt() which doesn't work
 * in WKWebView (MacApp). Renders as an overlay with a text input.
 *
 * Closes the shared ways (#1289): the × in its header, Escape, a click
 * outside, and its own Cancel.
 */

import { useState, useEffect, useRef } from "react";

import { DialogHeader } from "./dialog/DialogHeader";
import { useDismiss } from "./dialog/useDismiss";
import { Button } from "./Button";

interface Props {
  /** The dialog's title: what the value is for. */
  title: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function PromptModal({ title, message, defaultValue = "", placeholder, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useDismiss(true, onCancel);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--pnv-scrim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-modal-title"
        data-testid="prompt-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--pnv-surface)",
          borderRadius: 12,
          maxWidth: 500,
          width: "90%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "var(--pnv-shadow-dialog)",
        }}
      >
        <DialogHeader title={title} titleId="prompt-modal-title" onClose={onCancel} />
        <div style={{ padding: "16px 28px 24px" }}>
          <div style={{ fontSize: 14, color: "var(--pnv-text-body)", marginBottom: 12 }}>
            {message}
          </div>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) onSubmit(value.trim());
            }}
            placeholder={placeholder}
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: 14,
              border: "1px solid var(--pnv-border)",
              borderRadius: 6,
              marginBottom: 16,
              boxSizing: "border-box",
              fontFamily: "monospace",
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button
              onClick={onCancel}
              kind="secondary"
            >
              Cancel
            </Button>
            <Button
              onClick={() => value.trim() && onSubmit(value.trim())}
              disabled={!value.trim()}
              kind="primary"
            >
              OK
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
