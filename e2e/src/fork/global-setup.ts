/**
 * Vitest global setup: boot an Anvil fork of Base Sepolia with prool, pinned to a
 * block for reproducibility, and tear it down after the run. No manual `anvil`
 * launch, no shell.
 *
 * `ANVIL_BINARY` can point at a specific anvil (e.g. the mise-managed one); it
 * defaults to `anvil` on PATH. `mise install` in e2e provides it.
 */
import { Instance } from "prool";

const FORK_URL = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
const FORK_BLOCK = BigInt(process.env.FORK_BLOCK ?? "44036000");
const PORT = Number(process.env.FORK_PORT ?? "8545");

export default async function setup(): Promise<() => Promise<void>> {
  const instance = Instance.anvil({
    forkUrl: FORK_URL,
    forkBlockNumber: FORK_BLOCK,
    port: PORT,
    binary: process.env.ANVIL_BINARY,
  });
  const stop = await instance.start();
  return async () => {
    await stop();
  };
}
