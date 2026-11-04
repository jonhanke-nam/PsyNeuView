/**
 * Agent text, rendered inert (#179). See utils/safeText.ts for what is
 * parsed. Nothing here sets innerHTML, loads a URL, or hands the text to
 * anything with page privileges. A link is a button: the first press shows
 * the full address, the second opens it in a new tab with no opener.
 */

import { useState } from "react";

import { parseSafeText, isSafeUrl } from "@/utils/safeText";
import { Button } from "../common/Button";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export function SafeText({ text, testId }: { text: string; testId?: string }) {
  const segments = parseSafeText(text);
  return (
    <span data-testid={testId} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {segments.map((seg, i) => {
        switch (seg.kind) {
          case "code":
            return (
              <code key={i} style={{ fontFamily: MONO, fontSize: "0.95em", background: "var(--pnv-surface-sunken)", padding: "0 3px", borderRadius: 3 }}>
                {seg.text}
              </code>
            );
          case "block":
            return (
              <pre key={i} style={{ fontFamily: MONO, fontSize: "var(--pnv-fs-12)", background: "var(--pnv-surface-sunken)", padding: "6px 8px", borderRadius: 4, margin: "4px 0", overflowX: "auto" }}>
                {seg.text}
              </pre>
            );
          case "link":
            return <SafeLink key={i} url={seg.url} />;
          default:
            return <span key={i}>{seg.text}</span>;
        }
      })}
    </span>
  );
}

function SafeLink({ url }: { url: string }) {
  const [shown, setShown] = useState(false);
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  if (!shown) {
    return (
      <Button kind="link" data-testid="assistant-link" title="Show the full address before opening" onClick={() => setShown(true)}>
        {host} (link)
      </Button>
    );
  }
  return (
    <span data-testid="assistant-link-address" style={{ display: "inline-flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
      <code style={{ fontFamily: MONO, fontSize: "0.95em", background: "var(--pnv-surface-sunken)", padding: "0 3px", borderRadius: 3 }}>{url}</code>
      <Button
        kind="small"
        data-testid="assistant-link-open"
        onClick={() => {
          if (isSafeUrl(url)) window.open(url, "_blank", "noopener,noreferrer");
        }}
      >
        Open in a new tab
      </Button>
    </span>
  );
}
