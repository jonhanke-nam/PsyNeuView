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
    // `npm run test:coverage` (#319): line and branch coverage of src/ for
    // docs/testing-coverage.md. Only the summary is kept.
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
