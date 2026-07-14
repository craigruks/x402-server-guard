// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import lucode from "lucode-starlight";

// https://astro.build/config
export default defineConfig({
  site: "https://craigruks.github.io",
  base: "/x402-server-guard",
  integrations: [
    starlight({
      title: "x402-server-guard",
      description: "Server-side hardening for x402 payment endpoints.",
      // lucode-starlight: a shadcn/ui-inspired theme. No graph dependency, so it
      // runs on the current Astro 7 / Starlight line and reads clean and light,
      // close to the x402 docs.
      plugins: [lucode()],
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
          label: "Deployment",
          items: ["deployment/cloudflare-durable-objects"],
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
          // These pages are generated from the repo's docs/*.md at build time by
          // scripts/sync-reference-docs.mjs. Edit docs/*.md, not the generated files.
          label: "Reference",
          items: [
            "reference/hardening",
            "reference/coverage-map",
            "reference/review",
          ],
        },
      ],
    }),
  ],
});
