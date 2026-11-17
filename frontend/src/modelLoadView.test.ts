/**
 * Every model load and preview asks for the view the user is looking at (#257).
 *
 * The page's default view is flat; the backend's is nested. A load that sent
 * only show_graph's options rebuilt the graph nested, so the view switched
 * under the user, and Interface nodes (CIMs) appeared only after whichever
 * load happened to be nested. Each `fetch("/api/model/load")` and
 * `fetch("/api/model/preview")` must send `modelLoadOptions()`, or at least
 * `flat`, within its request.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const SRC = path.dirname(fileURLToPath(import.meta.url));

/** Loads that don't build the graph on screen, and why. */
const EXEMPT: Record<string, string> = {
  "components/common/DiagnosticPanel.tsx": "loads a backup to check it, never drawn",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

function loadsWithoutTheView(): string[] {
  const missing: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file);
    if (EXEMPT[rel]) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/fetch\(\s*["'`]\/api\/model\/(load|preview)["'`]/.test(line)) return;
      const request = lines.slice(i, i + 12).join("\n");
      if (!/modelLoadOptions\(\)|\bflat\b/.test(request)) missing.push(`${rel}:${i + 1}`);
    });
  }
  return missing;
}

describe("model loads keep the view (#257)", () => {
  it("every load and preview sends the flat/PyTorch view", () => {
    expect(loadsWithoutTheView()).toEqual([]);
  });

  it("finds the loads it is meant to check", () => {
    // Guard against the scan silently matching nothing.
    const all = sourceFiles(SRC).filter((f) => /\/api\/model\/(load|preview)/.test(readFileSync(f, "utf8")));
    expect(all.length).toBeGreaterThan(5);
  });
});
