/**
 * One control per setting, in its section (#1279, #1290, PsyNeuView-MacApp#200).
 *
 * docs/settings-inventory.yaml lists every setting in Settings with its one
 * control's test id and its section. This reads the frontend's source and
 * checks the two agree: every `data-testid="setting-…"` control is in the
 * inventory, appears exactly once in the source, every inventory entry has its
 * control, and the control is rendered by the file of the section the
 * inventory puts it in.
 *
 * A source check, not a render: it catches a setting gaining a second control
 * with the same id, a control nobody listed, a listed setting whose control
 * went away, and a setting that moved section without the inventory saying so.
 * A second control under a different id is for review to catch — the
 * inventory is where a reviewer looks.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import { SETTINGS_SECTION_IDS } from "./components/common/settings/sections";

const SRC = import.meta.dirname;
const INVENTORY = path.resolve(SRC, "../../docs/settings-inventory.yaml");
const MAC_SECTION = "MacAppSettingsSection.tsx";
const SECTIONS_DIR = path.join(SRC, "components/common/settings");

interface Entry {
  id: string;
  label: string;
  home: string;
  section: string;
  storage: string;
  control: string;
  /** The one allowed second view: a simple control for everyone (#1295 round 4). */
  simple_control?: string;
  simple_section?: string;
  bridge_key?: string;
  developer_only?: boolean;
}

const doc = yaml.load(readFileSync(INVENTORY, "utf8")) as { sections: string[]; settings: Entry[] };
const inventory = doc.settings;

/** Every control the inventory names: the one control, plus a simple view where allowed. */
const views = inventory.flatMap((e) => [
  { entry: e, control: e.control, section: e.section },
  ...(e.simple_control ? [{ entry: e, control: e.simple_control, section: e.simple_section ?? e.section }] : []),
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/** The top-level `function Name(` a position in `source` falls inside. */
function enclosingFunction(source: string, at: number): string | null {
  let found: string | null = null;
  for (const m of source.matchAll(/^(?:export )?function ([A-Za-z0-9_]+)\(/gm)) {
    if (m.index! > at) break;
    found = m[1];
  }
  return found;
}

/** Every literal `data-testid="setting-…"`, with the file and component it's in. */
const controls = sourceFiles(SRC).flatMap((file) => {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/data-testid="(setting-[a-z0-9-]+)"/g)].map((m) => ({
    id: m[1],
    file: path.basename(file),
    component: enclosingFunction(source, m.index!),
  }));
});

/** `about` → AboutSection.tsx, `open-menu` → OpenMenuSection.tsx. */
function sectionFile(id: string): string {
  const pascal = id.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase());
  return path.join(SECTIONS_DIR, `${pascal}Section.tsx`);
}

describe("settings inventory (#1279)", () => {
  it("is well formed", () => {
    expect(inventory.length).toBeGreaterThan(0);
    const ids = inventory.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of inventory) {
      expect(["settings", "settings:mac-app"], e.id).toContain(e.home);
      expect(e.control, e.id).toMatch(/^setting-[a-z0-9-]+$/);
      // A simple view is the exception, not a second setting: it needs its
      // own section, and only a Developer setting earns one.
      expect(!!e.simple_control, e.id).toBe(!!e.simple_section);
      if (e.simple_control) {
        expect(e.simple_control, e.id).toMatch(/^setting-[a-z0-9-]+$/);
        expect(e.section, `${e.id}: a simple view is for a Developer setting`).toBe("developer");
        expect(e.simple_section, e.id).not.toBe("developer");
      }
      expect(e.storage, e.id).toBeTruthy();
      expect(e.label, e.id).toBeTruthy();
      // Only Mac app settings travel over the bridge as a Mac app key.
      expect(!!e.bridge_key, e.id).toBe(e.home === "settings:mac-app");
    }
  });

  it("lists every Settings control exactly once", () => {
    const listed = views.map((v) => v.control);
    expect(new Set(listed).size).toBe(listed.length);
    for (const c of controls) {
      expect(listed, `${c.id} (${c.file}) is a Settings control the inventory doesn't list`).toContain(c.id);
    }
  });

  it("gives every setting exactly one control, or one plus its one simple view", () => {
    for (const v of views) {
      const found = controls.filter((c) => c.id === v.control);
      expect(found.length, `${v.entry.id}: expected one ${v.control}, found ${found.length}`).toBe(1);
    }
  });

  it("keeps Mac app settings in the Mac app file, and nothing else there", () => {
    for (const e of inventory) {
      const [found] = controls.filter((c) => c.id === e.control);
      if (!found) continue;
      expect(found.file === MAC_SECTION, `${e.id} is in ${found.file}`).toBe(e.home === "settings:mac-app");
    }
  });

  it("matches the Mac app's bridge keys", () => {
    // The same list as SettingsBridge.macAppKeys in PsyNeuView-MacApp; its
    // NativeWindowPolicyTests keeps a copy of these. Change all three together.
    const keys = inventory.filter((e) => e.home === "settings:mac-app").map((e) => e.bridge_key);
    expect(keys.sort()).toEqual([
      "autoRestart",
      "install",
      "launchAtLogin",
      "reportSendTo",
      "reportSendWith",
    ]);
  });

  it("can see every setting control id (none built at runtime)", () => {
    // A computed id would hide from this check.
    for (const file of sourceFiles(SRC)) {
      expect(readFileSync(file, "utf8"), path.basename(file)).not.toMatch(/data-testid=\{[^}]*["'`]setting-/);
    }
  });
});

describe("settings sections (#1290)", () => {
  it("names the sidebar's sections, in its order", () => {
    expect(doc.sections).toEqual([...SETTINGS_SECTION_IDS]);
    expect(doc.sections[0]).toBe("about");
    expect(doc.sections[doc.sections.length - 1]).toBe("developer");
  });

  it("puts every setting in a section that exists, with its label leading with it", () => {
    const labels: Record<string, string> = {
      about: "About", general: "General", appearance: "Appearance", "tutorials-voice": "Tutorials and Voice", "open-menu": "Open menu", folders: "Folders",
      shortcuts: "Keyboard shortcuts", reports: "Problem reports", developer: "Developer",
    };
    for (const e of inventory) {
      expect(doc.sections, `${e.id}: section ${e.section}`).toContain(e.section);
      expect(e.label, `${e.id}: label should start with its section`).toMatch(new RegExp(`^${labels[e.section]}`));
    }
  });

  it("renders each control from its section's file", () => {
    // The control's component is either defined in the section's file or
    // rendered by it (`<Name`): a setting can't move section quietly. A
    // simple view is checked against its own section the same way.
    for (const v of views) {
      const [found] = controls.filter((c) => c.id === v.control);
      if (!found) continue;
      expect(doc.sections, `${v.entry.id}: section ${v.section}`).toContain(v.section);
      const file = sectionFile(v.section);
      const sectionSource = readFileSync(file, "utf8");
      const rendered =
        found.file === path.basename(file) ||
        (found.component !== null && sectionSource.includes(`<${found.component}`));
      expect(rendered, `${v.entry.id}: ${found.component ?? "?"} (${found.file}) is not rendered by ${path.basename(file)}`).toBe(true);
    }
  });

  it("marks developer-only settings, and keeps them in Developer", () => {
    for (const e of inventory) {
      if (e.developer_only) expect(e.section, `${e.id} is developer-only`).toBe("developer");
    }
    // The switch itself is in Developer but is for everyone: it is how a
    // regular user turns the mode on.
    expect(inventory.find((e) => e.id === "developer-mode")?.developer_only).toBeFalsy();
  });
});
