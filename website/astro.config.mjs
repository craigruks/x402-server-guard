// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import obsidian from "starlight-theme-obsidian";

// https://astro.build/config
export default defineConfig({
  site: "https://craigruks.github.io",
  base: "/x402-server-guard",
  integrations: [
    starlight({
      title: "x402-server-guard",
      description: "Server-side hardening for x402 payment endpoints.",
      plugins: [
        obsidian({
          // starlight-theme-obsidian is configured through the
          // starlight-site-graph schema. The interactive graph and backlinks
          // panel are noise on a six-page site and pull in a client bundle we
          // do not need, so both sidebar widgets are removed. The rest of the
          // Obsidian theme (callouts, styling) stays on.
          graph: false,
          backlinks: false,
          overridePageSidebar: false,
        }),
      ],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/craigruks/x402-server-guard",
        },
        {
          icon: "external",
          label: "x402.org",
          href: "https://x402.org",
        },
      ],
      sidebar: [
        {
          label: "Welcome",
          items: [{ label: "Introduction", slug: "index" }],
        },
        {
          label: "Getting Started",
          items: [
            "getting-started/understanding-x402",
            "getting-started/quickstart",
          ],
        },
        {
          label: "Mitigations",
          items: [
            "mitigations/race-and-replay",
            "mitigations/substitution",
            "mitigations/finality",
            "mitigations/cache-leakage",
          ],
        },
        {
          label: "Reference",
          items: [
            {
              label: "Hardening rationale",
              link: "https://github.com/craigruks/x402-server-guard/blob/main/docs/hardening.md",
            },
            {
              label: "Coverage map",
              link: "https://github.com/craigruks/x402-server-guard/blob/main/docs/coverage-map.md",
            },
            {
              label: "Review methodology",
              link: "https://github.com/craigruks/x402-server-guard/blob/main/docs/review.md",
            },
          ],
        },
      ],
    }),
  ],
});
