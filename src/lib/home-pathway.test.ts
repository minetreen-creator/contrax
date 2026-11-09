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
