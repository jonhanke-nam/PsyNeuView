import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// #367: the dev proxy must keep the page's own Host. With changeOrigin the
// backend sees Host on its own port and Origin on the page's, and the
// assistant routes' same-site check refuses every change with 403.
describe("Vite dev proxy (#367)", () => {
  const config = readFileSync(path.resolve(__dirname, "../vite.config.ts"), "utf8");
  it("proxies /api and /ws without rewriting Host", () => {
    for (const route of ['"/api"', '"/ws"']) {
      const at = config.indexOf(route);
      expect(at, `${route} is proxied`).toBeGreaterThan(-1);
      const block = config.slice(at, config.indexOf("\n      }", at));
      expect(block, `${route} keeps Host`).toContain("changeOrigin: false");
    }
  });
});
