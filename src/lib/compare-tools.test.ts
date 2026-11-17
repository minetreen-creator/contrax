import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { COMPARE_BY_SLUG, COMPARE_TOOLS, CONTRAX_SIDE, compareTitle } from "./compare-tools";

// Owner 2026-11-14 (competitor review, idea 3): comparison pages, with every claim sourced.
test("each tool has facts, a source on its own site, and a case for choosing it", () => {
  expect(COMPARE_TOOLS.map((t) => t.slug)).toEqual(["highergov", "govtribe", "cleatus", "bidnet-direct", "govwin-iq", "demandstar"]);
  for (const t of COMPARE_TOOLS) {
    expect(t.facts.length).toBeGreaterThan(0);
    expect(t.source.url).toMatch(/^https:\/\/(www\.)?(highergov\.com|govtribe\.com|cleat\.ai|bidnetdirect\.com|deltek\.com|network\.demandstar\.com)\//);
    expect(t.betterWhen.length).toBeGreaterThan(20);
    expect(COMPARE_BY_SLUG[t.slug]).toBe(t);
    expect(compareTitle(t)).toContain(`${t.name} Alternative`);
  }
});

test("no competitor is run down: no 'worse', 'outdated', 'expensive' or 'hidden' about them", () => {
  const text = JSON.stringify(COMPARE_TOOLS).toLowerCase();
  for (const w of ["worse", "outdated", "expensive", "hidden", "clunky", "overpriced"]) expect(text).not.toContain(w);
});

test("our side states our own current prices", () => {
  const ours = JSON.stringify(CONTRAX_SIDE);
  expect(ours).toContain("$149 once");
  expect(ours).toContain("$499 a month");
  expect(ours).toContain("start for $9");
});

test("the page shows the source and check date, says when the other tool wins, and is in the sitemap", () => {
  const page = readFileSync("src/routes/compare/$tool.tsx", "utf8");
  expect(page).toContain("checked {CHECKED}");
  expect(page).toContain("<strong>Choose {t.name}</strong> if {t.betterWhen}");
  // The notice is in the hero, above the first button.
  expect(page.indexOf("not affiliated with or endorsed by")).toBeGreaterThan(0);
  expect(page.indexOf("not affiliated with or endorsed by")).toBeLessThan(page.indexOf("Read a real sample report"));
  expect(page).toContain("throw notFound()");
  const map = readFileSync("scripts/generate-sitemap.mjs", "utf8");
  for (const t of COMPARE_TOOLS) expect(map).toContain(`["/compare/${t.slug}", "monthly", "0.6"]`);
});
