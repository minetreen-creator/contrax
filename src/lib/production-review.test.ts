import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { usaSpendingNaics } from "~/lib/fpds";

// Owner 2026-11-10 production review: "USAspending API errors, including invalid NAICS filters" and a
// slow /awards page.
test("only 2-, 4- or 6-digit NAICS codes reach USAspending", () => {
  expect(usaSpendingNaics("561720")).toBe("561720");
  expect(usaSpendingNaics("2382")).toBe("2382");
  expect(usaSpendingNaics("23")).toBe("23");
  expect(usaSpendingNaics("238")).toBe("23");
  expect(usaSpendingNaics("23622")).toBe("2362");
  expect(usaSpendingNaics("561720, 561790")).toBe("561720");
  expect(usaSpendingNaics("N/A")).toBeUndefined();
  expect(usaSpendingNaics("")).toBeUndefined();
  expect(usaSpendingNaics(null)).toBeUndefined();
  const fpds = readFileSync("src/lib/fpds.ts", "utf8");
  expect(fpds).toContain("naics_codes: usaSpendingNaics(naicsCode) ?");
  expect(fpds).not.toContain("naics_codes: naicsCode ? [naicsCode]");
});

test("/awards shares similar-bid searches, runs them 8 at a time, and loads federal awards alongside", () => {
  const page = readFileSync("src/routes/awards.tsx", "utf8");
  expect(page).toContain("groups.slice(i, i + 8).map(async");
  expect(page).not.toMatch(/for \(const award of awards\) \{[\s\S]{0,400}await sql\(\)/);
  expect(page).toContain("getFederalAwards({ data: { q: deps.q, state: deps.state } }),\n    ]);");
});
