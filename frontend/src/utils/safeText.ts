/**
 * Agent text is hostile (#179). This is the whole of what the page makes of
 * it: a parse into plain text, `code` spans, fenced code blocks and links,
 * and nothing else. No HTML is ever interpreted: `<img src=…>` in a reply is
 * shown as those characters. A link is only ever an http(s) address, and the
 * panel renders it as a button that shows the full address before anything
 * opens; `javascript:`, `data:`, `file:` and the rest are left as text.
 */

export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "block"; text: string }
  | { kind: "link"; url: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]]+/g;

/** Only http and https, and only when the URL constructor agrees. */
export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function linkify(text: string, out: TextSegment[]): void {
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    if (!isSafeUrl(url)) continue;
    if (m.index! > last) out.push({ kind: "text", text: text.slice(last, m.index!) });
    out.push({ kind: "link", url });
    last = m.index! + url.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
}

function inlineSegments(text: string, out: TextSegment[]): void {
  const parts = text.split(/(`[^`\n]+`)/);
  for (const part of parts) {
    if (!part) continue;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      out.push({ kind: "code", text: part.slice(1, -1) });
    } else {
      linkify(part, out);
    }
  }
}

/** Split `text` into the tiny subset the panel renders. Nothing here is ever markup. */
export function parseSafeText(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  const parts = text.split(/(```[\s\S]*?```)/);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("```") && part.endsWith("```") && part.length >= 6) {
      // Drop a language tag on the opening line; it is never interpreted.
      const body = part.slice(3, -3).replace(/^[^\n]*\n/, (m) => (/^\s*[\w+-]*\s*\n$/.test(m) ? "" : m));
      out.push({ kind: "block", text: body });
    } else {
      inlineSegments(part, out);
    }
  }
  return out;
}
