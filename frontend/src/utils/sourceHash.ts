/**
 * A short fingerprint of a model's source text (#337).
 *
 * Each run is tagged with the hash of the source it ran, so the Run panel can
 * tell whether its results still describe the model on screen. Not a security
 * hash: cyrb53, a fast 53-bit string hash, is plenty to tell two versions of
 * one file apart, and it runs in well under a millisecond on a large model.
 */
export function hashSource(source: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < source.length; i++) {
    const ch = source.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

// One-entry cache: the same source string is hashed once, however many
// callers ask (the Run panel, the Trajectory card, a run starting).
let lastSource: string | null = null;
let lastHash = "";

/** `hashSource`, remembered for the most recent source string. */
export function cachedSourceHash(source: string): string {
  if (source !== lastSource) {
    lastSource = source;
    lastHash = hashSource(source);
  }
  return lastHash;
}
