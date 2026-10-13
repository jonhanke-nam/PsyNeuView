import { defineConfig } from "vitest/config";
import path from "path";

// Unit tests only — pure logic under src/ (no DOM). Playwright e2e lives in
// e2e/ and is run separately via the test:e2e scripts.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
