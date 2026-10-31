import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-10-31 funnel check: the homepage shows the $5 Starter pass right
// under the search, and the duplicate town callout is gone.
describe("homepage $5 Starter strip", () => {
  const page = readFileSync("src/routes/index.tsx", "utf8");
  test("sits directly under the contract finder and links to pricing", () => {
    const finder = page.indexOf("<HomeContractFinder");
    const strip = page.indexOf("<StarterPassStrip />");
    expect(finder).toBeGreaterThan(-1);
    expect(strip).toBeGreaterThan(finder);
    expect(page.slice(finder, strip)).not.toMatch(/<HomeStateMap|<MaxAssistant|<MoneyJar/);
    expect(page).toContain('href="/pricing?source=home_strip"');
    expect(page).toContain("{STARTER_PASS_NOTE}");
  });
  test("no 'free' wording in the strip and no duplicate town callout", () => {
    const strip = page.slice(page.indexOf("function StarterPassStrip"), page.indexOf("// Free courses and tools"));
    expect(strip.toLowerCase()).not.toContain("free");
    expect(page).not.toContain("<TownBuyingCallout");
  });
});
