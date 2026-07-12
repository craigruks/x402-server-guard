import { defineConfig } from "vitest/config";

// The fork tests drive the harness against a local Anvil fork booted by
// global-setup. The env below points config.ts at deterministic Anvil accounts
// (buyer = account 0, funded with test USDC by viem-deal; payTo = account 2), so
// no .env is needed to run the fork suite.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["./src/fork/global-setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    env: {
      BUYER_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      PAY_TO_ADDRESS: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      FORK_RPC: "http://localhost:8545",
    },
  },
});
