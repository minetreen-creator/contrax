import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the Pathway page carries the owner's line and links the four steps in order", () => {
  const page = read("../routes/pathway.tsx");
  expect(page).toContain(
    `export const PATHWAY_LINE = "Contrax doesn't just show you government contracts. It shows you how to get into the business of winning them.";`,
  );
  const order = ['href: "/gap-map"', 'href: "/roadmap"', 'href: "/radar"', 'href: "/prime-finder"'].map((h) => page.indexOf(h));
  expect(order.every((i) => i > 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // Cybersecurity's codes are inside IT services: the spending total leaves it out.
  expect(page).toContain("AND trade_slug <> 'cybersecurity'");
});

test("the Pathway is in the header (not on phones), the sitemap, and each step page links back", () => {
  expect(read("../components/SiteHeader.tsx")).toContain('<a href="/pathway" className={`${link} hidden sm:inline`}>Pathway</a>');
  expect(read("../../scripts/generate-sitemap.mjs")).toContain('["/pathway", "monthly", "0.7"]');
  expect(read("../routes/gap-map.tsx")).toContain("Contrax Pathway</a> · Step 1");
  expect(read("../routes/roadmap.tsx")).toContain("Contrax Pathway</a> · Step 2");
  expect(read("../routes/prime-finder.tsx")).toContain("Contrax Pathway</a> · Step 4");
});
