import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-12 ("lift it for suppliers", "$199 it is"): the Agency plan for concrete plants,
// supply houses and equipment rental.
const read = (f: string) => readFileSync(f, "utf8");

test("the suppliers page sells the existing Agency plan at $199", () => {
  const page = read("src/routes/suppliers.tsx");
  expect(page).toContain('createFileRoute("/suppliers")');
  expect(page).toContain("PLAN_COPY.agency");
  expect(page).toContain('href="/upgrade?plan=agency&source=suppliers"');
  expect(page).toContain("Start the Agency plan: $199 a month");
  expect(page).toContain("it is not an extra user seat.");
});

test("search engines and AI assistants can find it; contractor footers stay one offer", () => {
  expect(read("scripts/generate-sitemap.mjs")).toContain('["/suppliers", "weekly", "0.7"]');
  expect(read("public/llms.txt")).toContain("https://www.contrax.company/suppliers");
  expect(read("src/routes/index.tsx")).not.toContain('href: "/suppliers"');
  expect(read("src/lib/seo-landing.tsx")).not.toContain('href="/suppliers"');
});
