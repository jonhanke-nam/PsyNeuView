// Production-mode e2e serves frontend/dist as it is. A dist built before the
// last source edit tests (and screenshots) the old code while looking like the
// new — which once produced a set of review screenshots that didn't show the
// change under review. So the e2e config refuses to start when dist is older
// than any source file the build reads.

import { existsSync, readdirSync, statSync } from "fs";
import path from "path";

/** What the build reads: changing any of these needs a new dist. */
const BUILD_INPUTS = ["src", "public", "index.html", "vite.config.ts", "package.json", "tsconfig.json"];

function newestFile(p: string): { file: string; mtimeMs: number } | null {
  if (!existsSync(p)) return null;
  const st = statSync(p);
  if (!st.isDirectory()) return { file: p, mtimeMs: st.mtimeMs };
  let newest: { file: string; mtimeMs: number } | null = null;
  for (const entry of readdirSync(p)) {
    const found = newestFile(path.join(p, entry));
    if (found && (!newest || found.mtimeMs > newest.mtimeMs)) newest = found;
  }
  return newest;
}

/**
 * Null when `<frontendDir>/dist` was built after every build input changed;
 * otherwise why it can't be used, in words for the person running the tests.
 */
export function staleDistReason(frontendDir: string): string | null {
  const built = path.join(frontendDir, "dist", "index.html");
  if (!existsSync(built)) {
    return "There is no frontend/dist to test. Run `npm run build` first (or use `npm run test:e2e`, which builds).";
  }
  const builtAt = statSync(built).mtimeMs;
  let newest: { file: string; mtimeMs: number } | null = null;
  for (const input of BUILD_INPUTS) {
    const found = newestFile(path.join(frontendDir, input));
    if (found && (!newest || found.mtimeMs > newest.mtimeMs)) newest = found;
  }
  if (newest && newest.mtimeMs > builtAt) {
    return (
      `frontend/dist is older than ${path.relative(frontendDir, newest.file)}, so the tests would run ` +
      "the app as it was before that change. Run `npm run build` first (or use `npm run test:e2e`, " +
      "which builds). To test the old build on purpose, set PW_ALLOW_STALE_DIST=1."
    );
  }
  return null;
}
