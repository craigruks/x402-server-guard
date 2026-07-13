import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    coverage: {
      // Enabled via `npm run test:coverage`. Measures the shipped code only; the
      // harness under test/ is scaffolding, not published.
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
