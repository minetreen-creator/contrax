import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-06 ("do those 2"): scraping ban with liquidated damages and fees, and a court carve-out from arbitration.
test("the Terms ban automated access, set liquidated damages, and keep scraping claims out of arbitration", () => {
  const t = readFileSync("src/routes/terms/index.tsx", "utf8");
  expect(t).toContain("Last updated: November 6, 2026");
  expect(t).toContain("4A. Automated Access and Scraping");
  expect(t).toContain("$10 for each page of the Service you access or copy");
  expect(t).toContain("the fee Contrax would have charged under its standard data license");
  expect(t).toContain("the prevailing party is entitled to recover its reasonable attorneys&apos; fees and costs");
  expect(t).toContain("Disputes shall be resolved through binding arbitration, except that either party may bring in court");
  expect(t).toContain("discovery or subpoenas to identify a person responsible");
});
