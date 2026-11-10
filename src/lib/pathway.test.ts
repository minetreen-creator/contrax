import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the Pathway page carries the owner's line and links the four steps in order", () => {
  const page = read("../routes/pathway.tsx");
  const lib = read("./pathway.ts");
  expect(lib).toContain(
    `export const PATHWAY_LINE = "Contrax doesn't just show you government contracts. It shows you how to get into the business of winning them.";`,
  );
  expect(page).toContain("{PATHWAY_LINE}");
  const order = ['href: "/gap-map"', 'href: "/roadmap"', 'href: "/radar"', 'href: "/prime-finder"'].map((h) => lib.indexOf(h));
  expect(order.every((i) => i > 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // Cybersecurity's codes are inside IT services: the spending total leaves it out.
  expect(page).toContain("AND trade_slug <> 'cybersecurity'");
});

test("the Pathway tools are in the header Win work menu (not on phones), the sitemap, and each step page links back", () => {
  const header = read("../components/SiteHeader.tsx");
  expect(header).toContain('<a href="/radar" className={link}>Find work</a>');
  expect(header).toContain("<WinWorkMenu linkClass={link} />");
  expect(header).toContain('<details ref={ref} className="relative hidden sm:block">');
  for (const href of ['"/pathway"', '"/gap-map"', '"/roadmap"', '"/prime-finder"']) expect(header).toContain(`href: ${href}`);
  expect(read("../../scripts/generate-sitemap.mjs")).toContain('["/pathway", "monthly", "0.7"]');
  expect(read("../routes/gap-map.tsx")).toContain("Contrax Pathway</a> · Step 1");
  expect(read("../routes/roadmap.tsx")).toContain("Contrax Pathway</a> · Step 2");
  expect(read("../routes/prime-finder.tsx")).toContain("Contrax Pathway</a> · Step 4");
});

test("copy pass (owner 2026-11-10): tool names capitalized, each plan named exactly", async () => {
  const { PATHWAY_STEPS } = await import("./pathway");
  const all = PATHWAY_STEPS.map((s) => `${s.what} ${s.cta} ${s.access} ${s.bullets.join(" ")}`).join(" ");
  expect(all).not.toMatch(/\bgap map\b|\bprime finder\b|\bfor members\b|how to get on\b/);
  expect(PATHWAY_STEPS[2].access).toBe("Search free; Auto-Pilot with any paid plan");
  expect(PATHWAY_STEPS[3].access).toBe("First 3 free; unlimited with Professional");
  for (const s of PATHWAY_STEPS) for (const sentence of s.what.split(/(?<=\.)\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(30);
});
