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
      // store-types.ts is types only (no runtime code); src/cloudflare runs in
      // workerd and is covered by the Miniflare test, not this node run.
      exclude: ["src/**/*.test.ts", "src/store-types.ts", "src/cloudflare/**"],
      reporter: ["text"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
