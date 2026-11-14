import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PLAN_COPY } from "./plan-features";

// Owner 2026-11-14 ("a big pivot"): a page for companies with a government sales or proposal person.
const page = readFileSync("src/routes/teams.tsx", "utf8");

test("the teams page sells the Professional plan that exists, at its real price", () => {
  expect(page).toContain('createFileRoute("/teams")');
  expect(page).toContain("const plan = PLAN_COPY.professional;");
  expect(page).toContain("Start Professional: $79 a month");
  expect(page).toContain("Or $790 a year.");
  expect(PLAN_COPY.professional.features).toContain("Or $790 a year: 2 months free");
  expect(page).toContain('href="/upgrade?plan=professional&source=teams"');
});

test("each stage points at a page that exists, and the page claims only what Professional ships", () => {
  for (const href of ['href: "/recompetes"', 'href: "/example-brief"', 'href: "/pricing"']) expect(page).toContain(href);
  for (const route of ["recompetes.tsx", "example-brief.tsx"]) expect(readFileSync(`src/routes/${route}`, "utf8").length).toBeGreaterThan(100);
  const pro = PLAN_COPY.professional.features.join(" ");
  expect(pro).toContain("Contracts Ending Soon");
  expect(pro).toContain("AI Executive Briefs");
  expect(pro).toContain("Incumbent Intelligence");
  expect(pro).toContain("AI Match Scoring");
  // No promise that an ending contract will be rebid.
  expect(page).toContain("not a promise that the work will be rebid");
});

test("it is canonical, indexable and in the sitemap, and the contractor pages do not link to it", () => {
  expect(page).toContain('links: [{ rel: "canonical", href: `${PROD_URL}/teams` }]');
  expect(page).toContain('{ name: "robots", content: "index, follow" }');
  expect(readFileSync("scripts/generate-sitemap.mjs", "utf8")).toContain('["/teams", "weekly", "0.7"]');
  for (const f of ["src/routes/index.tsx", "src/routes/radar.tsx", "src/components/SiteHeader.tsx"]) {
    expect(readFileSync(f, "utf8")).not.toContain('"/teams"');
  }
});
