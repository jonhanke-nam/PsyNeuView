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

/**
 * Characters that change how text reads without changing how it runs, or
 * the reverse: bidirectional overrides and isolates, zero-width characters,
 * the byte-order mark, the soft hyphen. The backend flags them in a
 * proposal's warnings; the page shows each as its code point, so a reviewed
 * file can't read differently from what it does.
 */
const INVISIBLE_RE = /[\u200b\u200c\u200d\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u00ad]/g;

export function hasInvisible(text: string): boolean {
  INVISIBLE_RE.lastIndex = 0;
  return INVISIBLE_RE.test(text);
}

/** `text` with every invisible or direction-changing character replaced by a visible `<U+XXXX>`. */
export function showInvisible(text: string): string {
  return text.replace(INVISIBLE_RE, (ch) => `<U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}>`);
}
