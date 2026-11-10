import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { coopPath, coopTradeForQuery } from "~/lib/coop-contracts";
import { PATHWAY_STEPS } from "~/lib/pathway";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("Radar searches map to the trade co-op categories use", () => {
  expect(coopTradeForQuery("roofing")).toBe("construction");
  expect(coopTradeForQuery("plumbing")).toBe("hvac");
  expect(coopTradeForQuery("HVAC")).toBe("hvac");
  expect(coopTradeForQuery("electrical")).toBe("electrical");
  expect(coopTradeForQuery("janitorial")).toBe("janitorial");
  expect(coopTradeForQuery("IT")).toBe("it-services");
  expect(coopTradeForQuery("")).toBeNull();
  expect(coopTradeForQuery("office furniture")).toBeNull();
  expect(coopPath("hvac")).toBe("/co-op-contracts?trade=hvac");
});

test("co-op contracts are Pathway step 5, in the menu, the sitemap and on Radar; synced daily", () => {
  const step = PATHWAY_STEPS.find((s) => s.n === 5)!;
  expect(step.href).toBe("/co-op-contracts");
  expect(read("../routes/co-op-contracts.tsx")).toContain("Contrax Pathway</a> · Step 5");
  expect(read("../components/SiteHeader.tsx")).toContain('href: "/co-op-contracts"');
  expect(read("../../scripts/generate-sitemap.mjs")).toContain('["/co-op-contracts", "daily", "0.6"]');
  expect(read("../routes/radar.tsx")).toContain("<CoopCallout trade={trade} />");
  expect(read("../../.github/workflows/coop-sync.yml")).toContain("bun src/jobs/coop-sync.ts");
  expect(read("../db/schema.sql")).toContain("CREATE TABLE IF NOT EXISTS coop_solicitations");
});

test("the homepage's three steps use plain words, not product names (owner 2026-11-10)", async () => {
  const { BRAND_STEPS } = await import("~/lib/brand-message");
  for (const s of BRAND_STEPS) expect(`${s.detail} ${s.cta}`).not.toMatch(/\bMax\b|Auto-Pilot|Pathway/);
});
