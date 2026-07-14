// Generate the Reference section of the docs site from the canonical repo docs.
//
// The source of truth is the repo's top-level docs/*.md, which are also read on
// GitHub and linked from README.md, SECURITY.md, and the source. Those files stay
// plain markdown with no Starlight front matter and with repo-relative links that
// resolve on GitHub. This script mirrors them into src/content/docs/reference/,
// injecting the front matter Starlight needs and rewriting their links so they
// resolve in the site: cross-doc links become internal routes, and links into the
// codebase (test/, src/, e2e/, SECURITY.md) become absolute GitHub URLs.
//
// The output directory is git-ignored and regenerated on every build and dev run
// (wired via the prebuild and predev npm hooks). Edit docs/*.md, never the
// generated pages.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const srcDocs = join(repoRoot, "docs");
const outDir = join(here, "..", "src", "content", "docs", "reference");

const GH_BLOB = "https://github.com/craigruks/x402-server-guard/blob/main";
const SITE_BASE = "/x402-server-guard/reference";

// docs/*.md -> site page. `label` is the short sidebar label; `description` is the
// page meta description. The page title comes from each file's H1.
const PAGES = {
  "hardening.md": {
    slug: "hardening",
    label: "Hardening rationale",
    description: "Why each mitigation works, with sources.",
  },
  "coverage-map.md": {
    slug: "coverage-map",
    label: "Coverage map",
    description: "Each attack mapped to its mitigation and proving test.",
  },
  "review.md": {
    slug: "review",
    label: "Review methodology",
    description: "How the guard is reviewed, and its limits.",
  },
  "objection-handling.md": {
    slug: "objection-handling",
    label: "Objection handling",
    description: "The hardest questions about the guard, answered honestly.",
  },
};

// Rewrite markdown link targets. Leaves absolute URLs, anchors, and mailto alone.
// Cross-doc links (./hardening.md) become internal site routes; every other
// repo-relative link is resolved against the repo root and pointed at GitHub.
function rewriteLinks(md) {
  return md.replace(/\]\(([^)]+)\)/g, (whole, url) => {
    if (/^(https?:|#|mailto:)/.test(url)) return whole;
    const [path, hash = ""] = url.split("#");
    const anchor = hash ? `#${hash}` : "";
    const bare = path.replace(/^\.\//, "");
    if (PAGES[bare]) return `](${SITE_BASE}/${PAGES[bare].slug}/${anchor})`;
    const fromRoot = path.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
    return `](${GH_BLOB}/${fromRoot}${anchor})`;
  });
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const [file, meta] of Object.entries(PAGES)) {
  const raw = await readFile(join(srcDocs, file), "utf8");
  const h1 = raw.match(/^#\s+(.+?)\s*$/m);
  const title = h1 ? h1[1] : meta.label;
  const body = rewriteLinks(h1 ? raw.replace(h1[0], "").replace(/^\n+/, "") : raw);

  const frontMatter = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(meta.description)}`,
    "sidebar:",
    `  label: ${JSON.stringify(meta.label)}`,
    "editUrl: false",
    "---",
    "",
    `<!-- Generated from docs/${file}. Edit that file, not this one. -->`,
    "",
    "",
  ].join("\n");

  await writeFile(join(outDir, `${meta.slug}.md`), frontMatter + body, "utf8");
}

console.log(
  `Synced ${Object.keys(PAGES).length} reference docs into src/content/docs/reference/`,
);
