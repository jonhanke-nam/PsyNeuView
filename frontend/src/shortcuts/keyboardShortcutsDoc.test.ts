/**
 * docs/keyboard-shortcuts.md is the standard; the registry must match it. (#292)
 *
 * New shortcuts are added to the doc first, in the PR that adds them. This
 * reads the doc's "The set" table and fails when a shortcut is in one and not
 * the other, or when its default key (on either platform) or area differs.
 * It also keeps the doc's native-menu keys and MAC_APP_MENU_KEYS together.
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { displayBinding, parseBinding } from "./binding";
import { MAC_APP_MENU_KEYS } from "./reference";
import { SHORTCUTS, defaultBindingFor, type Platform } from "./registry";

const DOC = path.resolve(import.meta.dirname, "../../../docs/keyboard-shortcuts.md");
const markdown = readFileSync(DOC, "utf8");

/** A table row's cells, without the outer pipes. */
function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/** The rows of "The set": any table line whose second cell is a `code` id. */
function documented() {
  // Only real table lines, not the TODO block inside an HTML comment.
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, "");
  const rows: { id: string; label: string; mac: string; other: string; group: string }[] = [];
  for (const line of withoutComments.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const c = cells(line);
    const id = /^`([a-z]+\.[A-Za-z]+)`$/.exec(c[1] ?? "")?.[1];
    if (!id) continue;
    rows.push({ id, label: c[0], mac: c[2], other: c[3], group: c[4] });
  }
  return rows;
}

function shown(id: string, platform: Platform): string {
  const shortcut = SHORTCUTS.find((s) => s.id === id)!;
  const parsed = parseBinding(defaultBindingFor(shortcut, platform));
  if (!parsed.ok) throw new Error(`${id}: ${parsed.reason}`);
  return displayBinding(parsed.binding, platform === "mac");
}

describe("docs/keyboard-shortcuts.md and the registry (#292)", () => {
  const rows = documented();

  it("lists exactly the registry's shortcuts", () => {
    expect(rows.map((r) => r.id).sort()).toEqual(SHORTCUTS.map((s) => s.id).sort());
  });

  it("gives each one's default key on the Mac and elsewhere, as the app shows it", () => {
    for (const row of rows) {
      expect(row.mac, `${row.id} on the Mac`).toBe(shown(row.id, "mac"));
      expect(row.other, `${row.id} on Windows and Linux`).toBe(shown(row.id, "other"));
    }
  });

  it("puts each one in the area the app lists it under, with its label", () => {
    for (const row of rows) {
      const shortcut = SHORTCUTS.find((s) => s.id === row.id)!;
      expect(row.group, row.id).toBe(shortcut.group);
      expect(row.label, row.id).toBe(shortcut.label);
    }
  });

  it("lists every Mac app menu key the reference shows", () => {
    for (const key of MAC_APP_MENU_KEYS) {
      expect(markdown, `${key.menu} ▸ ${key.label}`).toContain(key.keys);
    }
  });
});
