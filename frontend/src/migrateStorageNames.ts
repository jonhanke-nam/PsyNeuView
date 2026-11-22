/**
 * Browser settings saved under the project's first spelling, "psynewview",
 * carried over to "psyneuview" (#258).
 *
 * Imported first in main.tsx, before any store reads its saved value. Each old
 * `psynewview_…` or `psynewview-…` key is copied to its new name when the new
 * one isn't set; old keys are left as they are, so going back to an older
 * version loses nothing. Never throws: storage can be blocked.
 */
export const OLD_PREFIXES: [string, string][] = [
  ["psynewview_", "psyneuview_"],
  ["psynewview-", "psyneuview-"],
];

export function migrateStorageNames(storage: Storage | undefined = globalThis.localStorage): number {
  if (!storage) return 0;
  let copied = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key) keys.push(key);
    }
    for (const key of keys) {
      for (const [from, to] of OLD_PREFIXES) {
        if (!key.startsWith(from)) continue;
        const renamed = to + key.slice(from.length);
        if (storage.getItem(renamed) === null) {
          const value = storage.getItem(key);
          if (value !== null) {
            storage.setItem(renamed, value);
            copied++;
          }
        }
      }
    }
  } catch {
    // Blocked or full storage: the defaults apply, as they would anyway.
  }
  return copied;
}

migrateStorageNames();
