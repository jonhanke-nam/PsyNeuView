/** Browser settings saved under "psynewview" carry over to "psyneuview" (#258). */
import { describe, expect, it } from "vitest";
import { migrateStorageNames } from "./migrateStorageNames";

function memoryStorage(initial: Record<string, string>): Storage {
  const m = new Map(Object.entries(initial));
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

describe("migrating browser settings to the new name (#258)", () => {
  it("copies old keys to their new names, both prefixes", () => {
    const s = memoryStorage({ psynewview_layout_code_visible: "false", "psynewview-gsc-legend": "open", other: "x" });
    expect(migrateStorageNames(s)).toBe(2);
    expect(s.getItem("psyneuview_layout_code_visible")).toBe("false");
    expect(s.getItem("psyneuview-gsc-legend")).toBe("open");
    expect(s.getItem("other")).toBe("x");
  });

  it("keeps a value already saved under the new name", () => {
    const s = memoryStorage({ psynewview_palette_open: "false", psyneuview_palette_open: "true" });
    expect(migrateStorageNames(s)).toBe(0);
    expect(s.getItem("psyneuview_palette_open")).toBe("true");
  });

  it("leaves the old keys, so an older version still finds them", () => {
    const s = memoryStorage({ psynewview_recent_paths: "[]" });
    migrateStorageNames(s);
    expect(s.getItem("psynewview_recent_paths")).toBe("[]");
  });

  it("is safe to run again, and with no storage", () => {
    const s = memoryStorage({ psynewview_ui_prefs: "{}" });
    migrateStorageNames(s);
    expect(migrateStorageNames(s)).toBe(0);
    expect(migrateStorageNames(undefined)).toBe(0);
  });

  it("never throws when storage is blocked", () => {
    const blocked = { get length(): number { throw new Error("blocked"); } } as unknown as Storage;
    expect(() => migrateStorageNames(blocked)).not.toThrow();
  });
});
