import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-12 ("different kind of customer"): a page a bid consultant can find for the Agency plan.
const read = (f: string) => readFileSync(f, "utf8");

test("the consultants page sells the existing Agency plan and its own feature list", () => {
  const page = read("src/routes/consultants.tsx");
  expect(page).toContain('createFileRoute("/consultants")');
  expect(page).toContain("PLAN_COPY.agency");
  expect(page).toContain('href="/upgrade?plan=agency&source=consultants"');
  expect(page).toContain("Start the Agency plan: $199 a month");
  expect(page).toContain("It is a client file, not an extra user seat.");
});

test("its price matches the plan's price everywhere", () => {
  expect(read("src/routes/upgrade.tsx")).toContain('{ id: "agency", name: "Agency", price: 199, yearly: 1990 }');
  expect(read("src/lib/stripe.ts")).toContain("agency: 19900,");
});

test("search engines and AI assistants can find it; contractor footers stay one offer", () => {
  expect(read("scripts/generate-sitemap.mjs")).toContain('["/consultants", "weekly", "0.7"]');
  expect(read("public/llms.txt")).toContain("https://www.contrax.company/consultants");
  expect(read("src/routes/index.tsx")).not.toContain('href: "/consultants"');
  expect(read("src/lib/seo-landing.tsx")).not.toContain('href="/consultants"');
});
