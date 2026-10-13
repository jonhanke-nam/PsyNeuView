import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";

/**
 * What this build of the page came from (#1356): PsyNeuView's version (the
 * backend's `__version__`, the one version number the app has), the git
 * commit and its date, whether the tree had uncommitted changes, and when it
 * was built. The page reads it as `__PNV_BUILD__`; the same goes into
 * `dist/build-info.json`, so the server can say what the page files it
 * serves came from. Without git (an archive, a container build), the commit
 * is null and the rest still stands.
 */
function buildInfo() {
  const git = (...args: string[]): string | null => {
    try {
      return execFileSync("git", args, { cwd: __dirname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim() || null;
    } catch {
      return null;
    }
  };
  let version: string | null = null;
  try {
    const init = readFileSync(path.resolve(__dirname, "../backend/app/__init__.py"), "utf8");
    version = init.match(/__version__\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
  } catch {
    version = null;
  }
  const commit = git("rev-parse", "--short", "HEAD");
  const status = commit ? git("status", "--porcelain", "--untracked-files=no") : null;
  return {
    version,
    commit,
    commitDate: commit ? git("log", "-1", "--format=%cI", "HEAD") : null,
    dirty: commit ? !!status : null,
    builtAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

const BUILD_INFO = buildInfo();

/** Writes `build-info.json` beside `index.html` in the build. */
function buildInfoFile(): Plugin {
  return {
    name: "pnv-build-info",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "build-info.json", source: JSON.stringify(BUILD_INFO, null, 2) + "\n" });
    },
  };
}

// Ports are configurable via environment variables so multiple branches
// can run simultaneously on the same machine.
//   VITE_FRONTEND_PORT  — dev server port (default 5173)
//   VITE_BACKEND_PORT   — backend proxy target (default 8000)
const frontendPort = parseInt(process.env.VITE_FRONTEND_PORT || "5173", 10);
const backendPort = parseInt(process.env.VITE_BACKEND_PORT || "8000", 10);

export default defineConfig(({ command }) => ({
  plugins: [react(), buildInfoFile()],
  define: {
    // The dev server serves the checkout as it is now, so the page can't be stale.
    __PNV_BUILD__: JSON.stringify({ ...BUILD_INFO, devServer: command === "serve" }),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: frontendPort,
    proxy: {
      "/api": `http://localhost:${backendPort}`,
      "/ws": {
        target: `ws://localhost:${backendPort}`,
        ws: true,
      },
    },
  },
}));
