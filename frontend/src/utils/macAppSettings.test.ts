import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  hasSettingsBridge,
  MAC_SETTINGS_CHANGED,
  OPEN_SETTINGS,
  onOpenSettingsRequest,
  setMacAppReportSetting,
  setMacAppSetting,
  syncDeveloperModeWithMacApp,
} from "./macAppSettings";

// The suite runs on node (vitest.config.ts): `window` is an EventTarget, with
// the Mac app's message handler stubbed onto it where a test needs one.
type Win = EventTarget & Record<string, any>;
let win: Win;

function installBridge(reply: (body: any) => unknown) {
  const postMessage = vi.fn(async (body: any) => reply(body));
  win.webkit = { messageHandlers: { pnvSettings: { postMessage } } };
  return postMessage;
}

const settings = (developerMode: boolean) => ({
  install: { running: "x", choice: "bundled", checkoutPath: null, includedVersion: "1", recentCheckouts: [] },
  autoRestart: false,
  launchAtLogin: false,
  developerMode,
});

function fakeStore(initial: boolean) {
  let value = initial;
  const listeners = new Set<(on: boolean) => void>();
  return {
    get: () => value,
    set: (on: boolean) => {
      value = on;
      listeners.forEach((l) => l(on));
    },
    subscribe: (l: (on: boolean) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  win = new EventTarget() as Win;
  vi.stubGlobal("window", win);
});

describe("Mac app settings bridge (PsyNeuView-MacApp#200)", () => {
  it("is detected only when the app's handler is there", () => {
    expect(hasSettingsBridge()).toBe(false);
    installBridge(() => ({}));
    expect(hasSettingsBridge()).toBe(true);
  });

  it("opens Settings on the app's request", () => {
    const open = vi.fn();
    const off = onOpenSettingsRequest(open);
    win.__pnvOpenSettingsRequested = true;
    win.dispatchEvent(new Event(OPEN_SETTINGS));
    expect(open).toHaveBeenCalledTimes(1);
    expect(win.__pnvOpenSettingsRequested).toBe(false);
    off();
  });

  it("picks up a request made before the page was listening", () => {
    win.__pnvOpenSettingsRequested = true;
    const open = vi.fn();
    const off = onOpenSettingsRequest(open);
    expect(open).toHaveBeenCalledTimes(1);
    // And only once: the flag is consumed.
    win.dispatchEvent(new Event(OPEN_SETTINGS));
    expect(open).toHaveBeenCalledTimes(1);
    off();
  });

  it("leaves developer mode alone in a browser", async () => {
    const store = fakeStore(true);
    syncDeveloperModeWithMacApp(store);
    await flush();
    expect(store.get()).toBe(true);
  });

  it("adopts the app's developer mode, and reports the toggle back", async () => {
    const post = installBridge((body) => settings(body.op === "set" ? body.value : true));
    const store = fakeStore(false);
    const off = syncDeveloperModeWithMacApp(store);
    await flush();
    expect(store.get()).toBe(true);
    // Adopting the app's value isn't echoed back to it.
    expect(post.mock.calls.filter(([b]) => b.op === "set")).toHaveLength(0);

    store.set(false);
    expect(post).toHaveBeenLastCalledWith({ op: "set", key: "developerMode", value: false });

    // A change made in another window arrives as an event.
    win.dispatchEvent(new CustomEvent(MAC_SETTINGS_CHANGED, { detail: settings(true) }));
    expect(store.get()).toBe(true);
    expect(post.mock.calls.filter(([b]) => b.op === "set")).toHaveLength(1);
    off();
  });

  it("sets the report settings as text (PsyNeuView-MacApp#202)", async () => {
    const post = installBridge((body) => ({ ...settings(false), [body.key]: body.value }));
    const reply = await setMacAppReportSetting("reportSendWith", "gmail");
    expect(post).toHaveBeenLastCalledWith({ op: "set", key: "reportSendWith", value: "gmail" });
    expect(reply.reportSendWith).toBe("gmail");
    await setMacAppReportSetting("reportSendTo", "help@example.org");
    expect(post).toHaveBeenLastCalledWith({ op: "set", key: "reportSendTo", value: "help@example.org" });
  });

  it("turns release candidates on through the app", async () => {
    const post = installBridge((body) => ({ ...settings(false), [body.key]: body.value }));
    const reply = await setMacAppSetting("receiveReleaseCandidates", true);
    expect(post).toHaveBeenLastCalledWith({ op: "set", key: "receiveReleaseCandidates", value: true });
    expect(reply.receiveReleaseCandidates).toBe(true);
  });
});
