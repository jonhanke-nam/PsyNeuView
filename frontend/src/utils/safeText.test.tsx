/**
 * Agent text stays inert (#179): hostile HTML is characters, a `javascript:`
 * link is text, a remote image never becomes an element, and an http link
 * becomes a button that shows the address, not an anchor.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SafeText } from "@/components/assistant/SafeText";
import { hasInvisible, isSafeUrl, parseSafeText, showInvisible } from "./safeText";

const render = (text: string) => renderToStaticMarkup(createElement(SafeText, { text }));

describe("parseSafeText (#179)", () => {
  it("keeps HTML as text", () => {
    const segs = parseSafeText('<img src="https://evil.example/x.png" onerror="alert(1)">');
    expect(segs.every((s) => s.kind === "text" || s.kind === "link")).toBe(true);
    // The URL inside the tag is a link segment, never an image; the tag text stays.
    expect(segs[0]).toEqual({ kind: "text", text: '<img src="' });
  });

  it("links only http and https", () => {
    expect(isSafeUrl("https://example.org/a")).toBe(true);
    expect(isSafeUrl("http://localhost:8000")).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,hi")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(parseSafeText("see javascript:alert(1) now")).toEqual([{ kind: "text", text: "see javascript:alert(1) now" }]);
  });

  it("parses code spans and blocks, nothing more", () => {
    expect(parseSafeText("set `gain=2` here")).toEqual([
      { kind: "text", text: "set " },
      { kind: "code", text: "gain=2" },
      { kind: "text", text: " here" },
    ]);
    expect(parseSafeText("```python\nx = 1\n```")).toEqual([{ kind: "block", text: "x = 1\n" }]);
    expect(parseSafeText("**bold** _it_ # h")).toEqual([{ kind: "text", text: "**bold** _it_ # h" }]);
  });

  it("strips trailing punctuation from a link", () => {
    expect(parseSafeText("read https://docs.example/a.")).toEqual([
      { kind: "text", text: "read " },
      { kind: "link", url: "https://docs.example/a" },
      { kind: "text", text: "." },
    ]);
  });
});

describe("SafeText rendering (#179)", () => {
  it("renders hostile HTML as escaped characters, never as elements", () => {
    const html = render('<script>alert(1)</script><img src="https://evil.example/t.png"><b>x</b>');
    expect(html).not.toMatch(/<script/);
    expect(html).not.toMatch(/<img/);
    expect(html).not.toMatch(/<b>/);
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders a javascript: link as text and an http link as a button without an href", () => {
    const html = render("go javascript:alert(1) or https://example.org/page");
    expect(html).not.toMatch(/href=/);
    expect(html).toContain("javascript:alert(1)");
    expect(html).toMatch(/<button[^>]*data-testid="assistant-link"/);
    expect(html).toContain("example.org (link)");
    // The full address is not on the page until the button is pressed.
    expect(html).not.toContain("https://example.org/page");
  });

  it("never loads from a URL", () => {
    const html = render("![x](https://evil.example/pixel.gif) <link rel=stylesheet href=https://evil.example/a.css>");
    expect(html).not.toMatch(/<(img|link|iframe|object|embed|video|audio|source)\b/);
    expect(html).not.toMatch(/\bsrc=/);
  });

  it("makes invisible and direction-changing characters visible", () => {
    expect(hasInvisible("x = 1")).toBe(false);
    expect(hasInvisible("x = 1\u202e")).toBe(true);
    expect(showInvisible("a\u202eb\u200bc\ufeff")).toBe("a<U+202E>b<U+200B>c<U+FEFF>");
    expect(showInvisible("plain")).toBe("plain");
  });
});
