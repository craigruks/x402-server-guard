/**
 * File-length ceiling. Source files stay small enough to read at a glance, so
 * modules stay easy to follow for humans and agents.
 *
 * Greenfield policy: a hard cap on every touched source file (no grandfathering).
 * Tests and declaration files are exempt.
 *
 *   tsx scripts/lint-file-length.ts            # all tracked source files
 *   tsx scripts/lint-file-length.ts --staged   # only staged files (pre-commit)
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const MAX_LINES = 200;
const EXCLUDE = /\.(test|spec)\.ts$|\.d\.ts$/;

function targetFiles(): string[] {
  const staged = process.argv.includes("--staged");
  const cmd = staged ? "git diff --cached --name-only --diff-filter=ACMR" : "git ls-files";
  return execSync(cmd, { encoding: "utf8" })
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
    .filter(
      (f) =>
        (f.startsWith("src/") || f.startsWith("scripts/") || f.startsWith("test/")) &&
        f.endsWith(".ts"),
    )
    .filter((f) => !EXCLUDE.test(f));
}

const violations: string[] = [];
for (const file of targetFiles()) {
  if (!existsSync(file)) {
    continue; // staged-then-deleted edge case
  }
  const lines = readFileSync(file, "utf8").split("\n").length;
  if (lines > MAX_LINES) {
    violations.push(`  ${file}: ${lines} lines (max ${MAX_LINES})`);
  }
}

if (violations.length > 0) {
  console.error(`✗ File-length limit exceeded (${MAX_LINES} lines):`);
  console.error(violations.join("\n"));
  console.error("\nSplit these into smaller modules. Keep files readable at a glance.");
  process.exit(1);
}

console.log(`✓ All source files within ${MAX_LINES} lines.`);
