/** Settings search (#271): the index and how it matches. */
import { readFileSync } from "fs";
import path from "path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { SETTINGS_INDEX, searchSettings } from "./settingsSearchIndex";
import { SETTINGS_SECTION_IDS } from "./sections";

const inventory = (
  yaml.load(readFileSync(path.resolve(__dirname, "../../../../../docs/settings-inventory.yaml"), "utf8")) as {
    settings: { id: string }[];
  }
).settings;

const ids = (q: string, inMacApp = false) => searchSettings(q, { inMacApp }).matches.map((e) => e.id);

describe("the Settings search index", () => {
  it("has one entry for every inventoried setting", () => {
    expect(SETTINGS_INDEX.map((e) => e.id).sort()).toEqual(inventory.map((e) => e.id).sort());
  });

  it("sends every entry to a real section and a setting-… control", () => {
    for (const e of SETTINGS_INDEX) {
      expect(SETTINGS_SECTION_IDS, e.id).toContain(e.section);
      expect(e.control, e.id).toMatch(/^setting-/);
    }
  });

  it("finds a setting with a simple view where everyone sees it", () => {
    const e = SETTINGS_INDEX.find((x) => x.id === "psyneulink-source")!;
    expect([e.section, e.control]).toEqual(["general", "setting-pnl-version"]);
  });
});

describe("searching Settings", () => {
  it("finds the live preview by its name, and by the words people use for it", () => {
    expect(ids("while typing")[0]).toBe("live-preview");
    expect(ids("preview")[0]).toBe("live-preview");
    expect(ids("auto-eval")[0]).toBe("live-preview");
  });

  it("puts a name match before a section or keyword match", () => {
    expect(ids("voice")[0]).toBe("narration-voice");
    expect(ids("outline")[0]).toBe("node-outline");
  });

  it("matches the section and groups a setting is in", () => {
    const appearance = ids("appearance");
    expect(appearance).toContain("text-size");
    expect(appearance).toContain("edge-line-width");
    expect(ids("model files")).toEqual(expect.arrayContaining(["autosave", "live-preview"]));
  });

  it("needs every word to match", () => {
    const r = ids("ring colour");
    expect(r[0]).toBe("tour-ring-color");
    expect(r).not.toContain("tour-ring-pulse");
  });

  it("lists the Mac app's settings only inside the Mac app", () => {
    expect(ids("log in")).not.toContain("mac-launch-at-login");
    expect(ids("log in", true)).toContain("mac-launch-at-login");
  });

  it("offers the closest when nothing matches every word", () => {
    expect(searchSettings("zzqx", { inMacApp: false })).toEqual({ matches: [], closest: [] });
    const r = searchSettings("voice zzqx", { inMacApp: false });
    expect(r.matches).toEqual([]);
    expect(r.closest.map((e) => e.id)).toContain("narration-voice");
  });

  it("finds nothing for an empty query", () => {
    expect(searchSettings("   ", { inMacApp: false }).matches).toEqual([]);
  });
});
