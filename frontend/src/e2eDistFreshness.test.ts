import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { staleDistReason } from "../e2e/distFreshness";

function frontend() {
  const dir = mkdtempSync(path.join(tmpdir(), "pnv-dist-"));
  mkdirSync(path.join(dir, "src", "components"), { recursive: true });
  writeFileSync(path.join(dir, "src", "components", "A.tsx"), "x");
  return dir;
}

function touch(file: string, secondsAgo: number) {
  const t = Date.now() / 1000 - secondsAgo;
  utimesSync(file, t, t);
}

function build(dir: string, secondsAgo: number) {
  mkdirSync(path.join(dir, "dist"), { recursive: true });
  const index = path.join(dir, "dist", "index.html");
  writeFileSync(index, "<html>");
  touch(index, secondsAgo);
}

describe("e2e refuses a stale frontend/dist", () => {
  it("refuses when there is no build", () => {
    expect(staleDistReason(frontend())).toMatch(/no frontend\/dist/);
  });

  it("accepts a build newer than every source file", () => {
    const dir = frontend();
    touch(path.join(dir, "src", "components", "A.tsx"), 60);
    build(dir, 10);
    expect(staleDistReason(dir)).toBeNull();
  });

  it("refuses a build older than a source edit, and names the file", () => {
    const dir = frontend();
    build(dir, 60);
    touch(path.join(dir, "src", "components", "A.tsx"), 10);
    expect(staleDistReason(dir)).toMatch(/older than src\/components\/A\.tsx/);
  });
});
