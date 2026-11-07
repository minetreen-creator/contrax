import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { expandTrade, isStrongTradeMatch, naicsCodeExpansion, termMatches } from "./trade-registry";

// Owner 2026-11-07 ("Do the NAICS code search fix"): a 6-digit code search matched only rows storing
// that exact code. Read-only reach (open bids, exact -> exact or title phrase): 238150 30->102,
// 238310 14->46, 561621 107->188, 541714 31->55, 423840 0->3, 334516 51->55.
const strong = (code: string, title: string, naics: string | null = null) =>
  isStrongTradeMatch(title, null, null, naics, naicsCodeExpansion(code)!);

test("a code keeps its exact match and adds its trade's curated phrases", () => {
  const glazing = naicsCodeExpansion("238150")!;
  expect(glazing.isNaics).toBe(false);
  expect(glazing.naicsCodes).toEqual(["238150"]);
  expect(glazing.terms).toContain("window replacement");
  expect(glazing.terms).toContain("curtain wall");
  expect(strong("238150", "Doors and Windows Replacement at Fire Stations 2, 9, and 12")).toBe(true);
  expect(strong("238150", "Unrelated title", "238150")).toBe(true); // exact code still strong
  expect(strong("238150", "SOURCES SOUGHT / REQUEST FOR INFORMATION (RFI)")).toBe(false);
});

test("phrases are specific: no short single words, no broad construction entry, no bare 'research'", () => {
  expect(naicsCodeExpansion("238160")!.terms).not.toContain("roof");
  expect(naicsCodeExpansion("236220")!.terms).not.toContain("repaving");
  expect(naicsCodeExpansion("541720")!.terms).not.toContain("research");
  expect(naicsCodeExpansion("561410")!.terms).not.toContain("copy");
  expect(naicsCodeExpansion("541714")!.terms).toContain("research and development");
  expect(strong("541512", "Financial Audit Services")).toBe(false);
  expect(naicsCodeExpansion("999999")).toBeNull(); // no curated phrases: stays exact-code only
  expect(naicsCodeExpansion("not-a-code")).toBeNull();
});

test("found along the way: roofing is not waterproofing; an NSN parts order is not trade work", () => {
  expect(termMatches("tamu varcity bid - waterproofing", "roofing")).toBe(false);
  expect(termMatches("re-roofing, window systems", "roofing")).toBe(true);
  expect(isStrongTradeMatch("421 Floodproofing", null, null, null, expandTrade("roofing"))).toBe(false);
  expect(isStrongTradeMatch("NSN 5640013713262; INSULATION BLOCK, THERMAL", null, null, null, expandTrade("insulation"))).toBe(false);
  expect(isStrongTradeMatch("Marion ISD New Elementary School - Thermal Insulation", null, null, null, expandTrade("insulation"))).toBe(true);
});

test("wired: the strict query and the scan use the code's phrases; the NAICS reason is only claimed when true", () => {
  const cand = readFileSync("src/lib/radar-candidates.ts", "utf8");
  expect(cand).toContain("const codeExpansion = isNaics ? naicsCodeExpansion(trade) : null;");
  expect(cand).toContain("expansion: codeExpansion ?? expansion");
  const radar = readFileSync("src/routes/radar.tsx", "utf8");
  expect(radar).toContain("matchExpansion = strict.expansion;");
  expect(radar).toContain("isStrongTradeMatch(bid.title, bid.category, bid.description, bid.naics_code, matchExpansion)");
  expect(radar).toContain("if (c.isNaics && bid.naics_code && bid.naics_code.trim() === c.trade) reasons.push(`NAICS ${bid.naics_code} matches your code`);");
});
