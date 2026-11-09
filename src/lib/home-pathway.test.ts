import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-09: "clean up the homepage and add these new features there" (keep the app panel).
const page = readFileSync("src/routes/index.tsx", "utf8");

test("the homepage shows the Pathway line and the four steps right after the $5 strip", () => {
  expect(page).toContain("{PATHWAY_LINE}");
  expect(page).toContain("PATHWAY_STEPS.map(");
  expect(page.indexOf("<StarterPassStrip />")).toBeLessThan(page.indexOf("<HomePathway />"));
  expect(page).toContain('href="/pathway"');
});

test("the $5 strip says what the 6 AM email brings; the app panel stays; the map links to the gap map", () => {
  expect(page).toContain("Auto-Pilot reads each one against your business and leads with the best fits");
  expect(page).toContain("<HomeAppStrip />");
  expect(page.indexOf('href="/gap-map"')).toBeGreaterThan(page.indexOf("<HomeStateMap"));
});

test("the footer lists the Pathway tools", () => {
  for (const href of ['"/pathway"', '"/gap-map"', '"/roadmap"', '"/prime-finder"']) expect(page).toContain(`href: ${href}`);
});

test("on phones the Pathway cards stay short: description hidden, number beside the title", () => {
  expect(page).toContain('className="mt-2 hidden flex-1 text-sm leading-relaxed text-slate-600 sm:block');
  expect(page).toContain('<div className="flex items-center gap-3 sm:block">');
});

test("under the map: the gap map, contracts ending soon and federal bids open to every business", () => {
  const map = page.indexOf("<HomeStateMap");
  for (const href of ['href="/gap-map"', 'href="/recompetes"', 'onClick={() => trackEvent("home_open_to_all_click")}']) {
    expect(page.indexOf(href, map)).toBeGreaterThan(map);
  }
  expect(page).toContain("Federal bids open to every business, no certification needed");
});
