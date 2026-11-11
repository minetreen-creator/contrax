import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-06 ("do those 2"): scraping ban with liquidated damages and fees, and a court carve-out from arbitration.
test("the Terms ban automated access, set liquidated damages, and keep scraping claims out of arbitration", () => {
  const t = readFileSync("src/routes/terms/index.tsx", "utf8");
  expect(t).toContain("Last updated: November 11, 2026");
  expect(t).toContain("4A. Automated Access and Scraping");
  expect(t).toContain("$10 for each page of the Service you access or copy");
  expect(t).toContain("the fee Contrax would have charged under its standard data license");
  expect(t).toContain("the prevailing party is entitled to recover its reasonable attorneys&apos; fees and costs");
  expect(t).toContain("Disputes shall be resolved through binding arbitration, except that either party may bring in court");
  expect(t).toContain("discovery or subpoenas to identify a person responsible");
});

// Owner 2026-11-11 ("yes check and add it"): the Terms banned scraping but not what may be done with
// Contrax data however it was obtained (a competitor's Terms had this; ours did not).
test("the Terms limit what Contrax data may be used for", () => {
  const t = readFileSync("src/routes/terms/index.tsx", "utf8");
  expect(t).toContain("4B. Use of Contrax Data");
  expect(t).toContain("build, train, or improve a product or service that competes with Contrax");
  expect(t).toContain("train or fine-tune a machine learning or AI model");
  expect(t).toContain("resell, redistribute, republish, sublicense, or make it available to third parties in bulk");
  // AI assistants that answer a question and link back are still welcome (ChatGPT sends us visitors).
  expect(t).toContain("An AI assistant or search engine may read a public page to answer a person&apos;s question and link to that page");
  expect(t).toContain("Removing or altering them is a violation of these terms");
  expect(t).toContain("In any action to enforce Section 4, this Section 4A or Section 4B");
  // Sections stay in order.
  expect(t.indexOf("4A. Automated Access")).toBeLessThan(t.indexOf("4B. Use of Contrax Data"));
  expect(t.indexOf("4B. Use of Contrax Data")).toBeLessThan(t.indexOf("5. AI-Generated Content"));
});
