import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// SEO audit 2026-11-14. Six pages in the sitemap had no canonical and inherited
// the homepage's og:url from the root layout.
const PAGES: [string, string][] = [
  ["src/routes/grants.tsx", "/grants"],
  ["src/routes/state-grants.tsx", "/state-grants"],
  ["src/routes/forecasts.tsx", "/forecasts"],
  ["src/routes/subcontracts.tsx", "/subcontracts"],
  ["src/routes/example-brief.tsx", "/example-brief"],
  ["src/routes/bid-fit-review.tsx", "/bid-fit-review"],
];

test("sitemap pages name themselves as canonical and og:url", () => {
  for (const [file, path] of PAGES) {
    const src = readFileSync(file, "utf8");
    expect(src).toContain(`{ rel: "canonical", href: "https://www.contrax.company${path}" }`);
    expect(src).toContain(`{ property: "og:url", content: "https://www.contrax.company${path}" }`);
  }
});

test("fallback and homepage tags fit what search results show", () => {
  const root = readFileSync("src/routes/__root.tsx", "utf8");
  const title = root.match(/const SITE_TITLE = "([^"]+)"/)?.[1] ?? "";
  const description = root.match(/const SITE_DESCRIPTION =\s+"([^"]+)"/)?.[1] ?? "";
  expect(title.length).toBeGreaterThan(20);
  expect(title.length).toBeLessThanOrEqual(60);
  expect(description.length).toBeGreaterThan(80);
  expect(description.length).toBeLessThanOrEqual(160);
  const home = readFileSync("src/routes/index.tsx", "utf8").match(/const PAGE_DESCRIPTION =\s+"([^"]+)"/)?.[1] ?? "";
  expect(home.length).toBeGreaterThan(80);
  expect(home.length).toBeLessThanOrEqual(160);
  // A large-image card needs a wide image, not the square logo.
  expect(root).toContain("/og/general.png");
  expect(root).not.toContain("logo-square.png");
});

test("the indexable landing pages found outside every sitemap are generated into it", () => {
  const script = readFileSync("scripts/generate-sitemap.mjs", "utf8");
  for (const p of ["/recompetes", "/leads", "/healthcare-contracting", "/contracts-hvac-mechanical", "/success-stories", "/associations"]) {
    expect(script).toContain(`["${p}", `);
  }
});
