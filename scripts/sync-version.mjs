// Keep the exported VERSION in src/index.ts in lockstep with package.json.
//
// package.json is the single source of truth for the version. This script rewrites
// the VERSION literal to match it, and is wired to the npm `version` lifecycle
// (see package.json), so `npm version <bump>` (as `just release bump` runs) stamps
// src/index.ts and stages it into the same commit. index.test.ts asserts the two
// agree, so any drift also fails CI.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const indexPath = join(root, "src", "index.ts");
const source = await readFile(indexPath, "utf8");

const pattern = /(export const VERSION: string = ")[^"]*(";)/;
if (!pattern.test(source)) {
  console.error("sync-version: could not find the VERSION literal in src/index.ts");
  process.exit(1);
}

const next = source.replace(pattern, `$1${pkg.version}$2`);
if (next !== source) {
  await writeFile(indexPath, next);
}
console.log(`sync-version: VERSION set to ${pkg.version}`);
