/**
 * Every dialog and pop-up closes the same ways (#1289).
 *
 * docs/dialog-inventory.md lists every dialog, menu and notice with its file
 * and test id, and the layers that are drawn on top but are not dialogs. This
 * reads the frontend's source and checks the two agree:
 *
 *  - a component that draws an overlay — a fixed layer, a role of dialog,
 *    menu or listbox, an absolutely positioned box with a shadow and a
 *    z-index, an inset-0 layer — is in one of the two tables;
 *  - a listed dialog uses DialogHeader and useDismiss, a listed menu uses
 *    useDismiss, a listed notice uses DialogCloseButton;
 *  - a listed dialog or menu does not handle Escape on its own, nor listen for
 *    keydown on the window or document (Escape by another name);
 *  - a listed test id is written literally in its file.
 *
 * A source check, not a render, like settingsInventory.test.ts: it catches a
 * new overlay nobody listed, and a listed one that stopped using the shared
 * pieces. Whether the × is in view and Escape closes the right thing is what
 * e2e/dialog-sweep.spec.ts checks in a browser.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const SRC = import.meta.dirname;
const COMPONENTS = path.join(SRC, "components");
const INVENTORY = path.resolve(SRC, "../../docs/dialog-inventory.md");
const DIALOG_DIR = path.join(COMPONENTS, "common/dialog");

type Kind = "dialog" | "menu" | "notice";

interface Row {
  name: string;
  kind: Kind;
  file: string;
  testId: string;
}

interface NotDialog {
  what: string;
  files: string[];
}

/** The cells of a markdown table row, with surrounding backticks stripped. */
function cells(line: string): string[] {
  return line
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim().replace(/^`|`$/g, ""));
}

/** The body rows of the table under `heading`, as cells. */
function tableUnder(markdown: string, heading: string): string[][] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.startsWith(heading));
  expect(start, `heading ${JSON.stringify(heading)} in dialog-inventory.md`).toBeGreaterThanOrEqual(0);
  const rows: string[][] = [];
  let seenHeader = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (!line.startsWith("|")) continue;
    if (!seenHeader) {
      seenHeader = true;
      continue;
    }
    if (/^\|\s*-+/.test(line)) continue;
    rows.push(cells(line));
  }
  return rows;
}

const markdown = readFileSync(INVENTORY, "utf8");

const rows: Row[] = tableUnder(markdown, "## Dialogs and menus").map(([name, kind, file, testId]) => ({
  name,
  kind: kind as Kind,
  file: path.join(COMPONENTS, file),
  testId,
}));

const notDialogs: NotDialog[] = tableUnder(markdown, "## Drawn on top, but not a dialog").map(([what, files]) => ({
  what,
  // One row may name several files, comma-separated and each in backticks.
  files: files.split(",").map((f) => f.trim().replace(/^`|`$/g, "")).map((f) =>
    f === "App.tsx" ? path.join(SRC, f) : path.join(COMPONENTS, f),
  ),
}));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [full] : [];
  });
}

/** Does this source draw something on top of the page? */
function drawsOverlay(source: string): boolean {
  if (/position: "fixed"/.test(source)) return true;
  if (/role="(dialog|menu|listbox)"/.test(source)) return true;
  if (/inset: 0/.test(source)) return true;
  return /position: "absolute"/.test(source) && /zIndex/.test(source) && /boxShadow/.test(source);
}

const overlayFiles = sourceFiles(SRC)
  .filter((f) => !f.startsWith(DIALOG_DIR))
  .filter((f) => drawsOverlay(readFileSync(f, "utf8")));

const rel = (f: string) => path.relative(SRC, f);

describe("dialog inventory (#1289)", () => {
  it("is well formed", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(["dialog", "menu", "notice"], r.name).toContain(r.kind);
      expect(r.testId, r.name).toMatch(/^[a-z0-9-]+$/);
      expect(statSync(r.file).isFile(), `${r.name}: ${rel(r.file)}`).toBe(true);
    }
    for (const n of notDialogs) {
      for (const f of n.files) expect(statSync(f).isFile(), `${n.what}: ${rel(f)}`).toBe(true);
    }
    const ids = rows.map((r) => r.testId);
    expect(new Set(ids).size, "a test id is listed twice").toBe(ids.length);
  });

  it("lists every component that draws an overlay, in one table or the other", () => {
    const listed = new Set([...rows.map((r) => r.file), ...notDialogs.flatMap((n) => n.files)]);
    for (const f of overlayFiles) {
      expect(listed.has(f), `${rel(f)} draws an overlay that docs/dialog-inventory.md does not list`).toBe(true);
    }
  });

  it("lists nothing that draws no overlay", () => {
    const drawing = new Set(overlayFiles);
    for (const r of rows) {
      expect(drawing.has(r.file), `${r.name}: ${rel(r.file)} draws no overlay — is the row stale?`).toBe(true);
    }
    for (const n of notDialogs) {
      for (const f of n.files) expect(drawing.has(f), `${n.what}: ${rel(f)} draws no overlay — is the row stale?`).toBe(true);
    }
  });

  it("writes every test id literally in its file", () => {
    // A notice's id is handed to DialogCloseButton as testId; a dialog's or
    // menu's is on the overlay itself.
    for (const r of rows) {
      const source = readFileSync(r.file, "utf8");
      const written = source.includes(`data-testid="${r.testId}"`) || (r.kind === "notice" && source.includes(`testId="${r.testId}"`));
      expect(written, `${r.name}: data-testid="${r.testId}" is not in ${rel(r.file)}`).toBe(true);
    }
  });

  it("uses the shared pieces: DialogHeader and useDismiss for a dialog, useDismiss for a menu, the × for a notice", () => {
    for (const r of rows) {
      const source = readFileSync(r.file, "utf8");
      const imports = (name: string) => new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "[^"]*dialog/`).test(source);
      if (r.kind === "dialog") {
        expect(imports("DialogHeader"), `${r.name}: ${rel(r.file)} should draw its header with DialogHeader`).toBe(true);
        expect(imports("useDismiss"), `${r.name}: ${rel(r.file)} should close with useDismiss`).toBe(true);
      } else if (r.kind === "menu") {
        expect(imports("useDismiss"), `${r.name}: ${rel(r.file)} should close with useDismiss`).toBe(true);
      } else {
        expect(imports("DialogCloseButton"), `${r.name}: ${rel(r.file)} should draw its × with DialogCloseButton`).toBe(true);
      }
    }
  });

  it("leaves Escape to the stack: no dialog or menu handles it, or listens for keydown, on its own", () => {
    for (const r of rows) {
      if (r.kind === "notice") continue;
      const source = readFileSync(r.file, "utf8");
      expect(source.includes('"Escape"'), `${r.name}: ${rel(r.file)} handles Escape itself; useDismiss does that`).toBe(false);
      expect(
        /(window|document)\.addEventListener\("keydown"/.test(source),
        `${r.name}: ${rel(r.file)} listens for keydown itself; useDismiss does that`,
      ).toBe(false);
    }
  });

  it("keeps the × in one place", () => {
    // Anything listed gets its × from DialogHeader.tsx, never draws its own.
    // (A × that is an action rather than a close — removing a port in the
    // inspector — is for #1302's button conventions, not this.)
    const listed = new Set([...rows.map((r) => r.file), ...notDialogs.flatMap((n) => n.files)]);
    for (const f of listed) {
      const source = readFileSync(f, "utf8");
      expect(/>\s*×\s*</.test(source), `${rel(f)} draws its own ×; use DialogHeader or DialogCloseButton`).toBe(false);
    }
  });
});
