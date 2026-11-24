/**
 * The test browser reports the platform it really runs on (#402).
 *
 * Playwright's "Desktop Chrome" profile tells the page it is on Windows,
 * whatever the machine. The app picks ⌘ or Ctrl from what the page is told,
 * while Playwright's `ControlOrMeta` follows the real machine — so on a Mac a
 * spec's `ControlOrMeta+s` sent ⌘S to an app listening for Ctrl+S, and the
 * same spec behaved differently on a Mac and on Linux CI.
 *
 * Here the profile's user agent gets the host's platform instead, keeping the
 * profile's Chrome version. Playwright derives `navigator.platform` and
 * `navigator.userAgentData` from the user agent, so the page agrees with
 * `ControlOrMeta`: ⌘ on a Mac, Ctrl on Linux and Windows.
 *
 * A spec that needs the other platform (graph-click-conventions.spec.ts,
 * narration-voice-setting.spec.ts) sets it itself, as before.
 */

export const HOST_IS_MAC = process.platform === "darwin";

const PLATFORM_TOKEN: Record<string, string> = {
  darwin: "Macintosh; Intel Mac OS X 10_15_7",
  linux: "X11; Linux x86_64",
  win32: "Windows NT 10.0; Win64; x64",
};

/** The given Chrome user agent, with its platform swapped for this machine's. */
export function userAgentForHost(userAgent: string, platform: string = process.platform): string {
  const token = PLATFORM_TOKEN[platform] ?? PLATFORM_TOKEN.linux;
  return userAgent.replace(/^Mozilla\/5\.0 \([^)]*\)/, `Mozilla/5.0 (${token})`);
}

/**
 * How the app writes a ⌘/Ctrl shortcut on this machine: "⌘2" on a Mac,
 * "Ctrl+2" elsewhere (see displayBinding in src/shortcuts/binding.ts).
 */
export function modLabel(key: string): string {
  return HOST_IS_MAC ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`;
}
