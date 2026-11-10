import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cleanUrl, niceName, parseSamLine, SAM_TRADE_NAICS } from "./sam-registrants";

// A made-up record laid out like the SAM.gov Public V2 extract (142 pipe-separated columns, 1-based).
function line(over: Record<number, string>): string {
  const cols = Array.from({ length: 142 }, () => "");
  const base: Record<number, string> = {
    1: "ABCDEFGH1234", 6: "A", 7: "Z2", 9: "20271015", 12: "ACME MECHANICAL LLC", 13: "", 18: "TAMPA", 19: "FL", 20: "336021234",
    22: "USA", 24: "N", 27: "www.acmemech.com", 32: "2X~A5~QF~", 33: "238220", 35: "238220Y~236220N~541512Y", 118: "", 119: "", 122: "SAM", 142: "!end",
  };
  for (const [i, v] of Object.entries({ ...base, ...over })) cols[Number(i) - 1] = v;
  return cols.join("|");
}

describe("SAM.gov public extract → Sub Finder registrants (owner 2026-11-09, item 5)", () => {
  test("an active, small HVAC business: trades from small NAICS only, certifications from business types", () => {
    const r = parseSamLine(line({}))!;
    expect(r).toMatchObject({ uei: "ABCDEFGH1234", name: "Acme Mechanical LLC", city: "Tampa", state: "FL", zip: "33602", url: "https://www.acmemech.com", expires: "2027-10-15" });
    expect(r.trades.sort()).toEqual(["hvac", "construction", "it-services"].sort());
    expect(r.certs.sort()).toEqual(["sdvosb", "vosb"].sort());
  });

  test("left out: inactive, grants-only, foreign, no public display, D&B data, not small in any trade", () => {
    expect(parseSamLine(line({ 6: "E" }))).toBeNull();
    expect(parseSamLine(line({ 7: "Z1" }))).toBeNull();
    expect(parseSamLine(line({ 22: "CAN" }))).toBeNull();
    expect(parseSamLine(line({ 119: "NPDY" }))).toBeNull();
    expect(parseSamLine(line({ 122: "D&B" }))).toBeNull();
    expect(parseSamLine(line({ 24: "Y" }))).toBeNull();
    expect(parseSamLine(line({ 35: "238220N~621111Y" }))).toBeNull();
    expect(parseSamLine("too|short")).toBeNull();
  });

  test("SBA certifications come from the SBA string; DBA name wins over legal name", () => {
    const r = parseSamLine(line({ 13: "ACME HVAC", 32: "2X~8W~", 118: "A620300101~XX20290101" }))!;
    expect(r.name).toBe("Acme HVAC");
    expect(r.certs.sort()).toEqual(["8a", "hubzone", "wosb"].sort());
  });

  test("helpers: web addresses and names", () => {
    expect(cleanUrl("http://acme.com/")).toBe("http://acme.com");
    expect(cleanUrl("not a url")).toBeNull();
    expect(cleanUrl("")).toBeNull();
    expect(niceName("SMITH & SONS ROOFING INC")).toBe("Smith & Sons Roofing Inc");
    expect(niceName("ACME CO.")).toBe("Acme Co.");
    expect(SAM_TRADE_NAICS.construction).toEqual(["236", "237", "238"]);
    expect(SAM_TRADE_NAICS.cybersecurity).toBeUndefined();
  });

  test("Sub Finder shows names; search pages show counts only; Contrax contacts no one", () => {
    const finder = readFileSync(new URL("../routes/sub-finder.tsx", import.meta.url), "utf8");
    expect(finder).toContain("They haven't joined Contrax, and Contrax doesn't contact them");
    expect(finder).toContain('rel="nofollow noopener noreferrer"');
    const page = readFileSync(new URL("../routes/find-subcontractors.$state.$trade.tsx", import.meta.url), "utf8");
    expect(page).toContain("registeredSubCounts");
    expect(page).not.toContain("findRegisteredSubs");
    const wf = readFileSync(new URL("../../.github/workflows/sam-registrants-sync.yml", import.meta.url), "utf8");
    expect(wf).toContain("sensitivity=PUBLIC");
    expect(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")).toContain("CREATE TABLE IF NOT EXISTS sam_registrants");
  });
});

describe("subs for primes: claim, onboarding checkbox, join page (owner 2026-11-10)", () => {
  test("email domain matches the registered website; free mail never matches", async () => {
    const { emailMatchesSite, mergeList } = await import("./sam-registrants");
    expect(emailMatchesSite("bob@acmemech.com", "https://www.acmemech.com")).toBe(true);
    expect(emailMatchesSite("bob@mail.acmemech.com", "https://acmemech.com")).toBe(true);
    expect(emailMatchesSite("bob@gmail.com", "https://gmail.com")).toBe(false);
    expect(emailMatchesSite("bob@other.com", "https://www.acmemech.com")).toBe(false);
    expect(emailMatchesSite("bob@acmemech.com", null)).toBe(false);
    expect(mergeList(["VA"], ["VA", "MD"])).toEqual(["VA", "MD"]);
    expect(mergeList(null, ["FL"])).toEqual(["FL"]);
  });

  test("claiming lists the business, one account per business; the claim page says so", () => {
    const srv = readFileSync(new URL("./sam-registrants.server.ts", import.meta.url), "utf8");
    expect(srv).toContain("listed_for_primes = TRUE");
    expect(srv).toContain("This business was already claimed by another account");
    const page = readFileSync(new URL("../routes/sub-finder_.claim.tsx", import.meta.url), "utf8");
    expect(page).toContain("Only claim a business you own or work for. One account per business.");
    expect(page).toContain('{ name: "robots", content: "noindex" }');
  });

  test("onboarding asks once, unchecked; registered entries link to claim; the join page searches SAM.gov", () => {
    const onb = readFileSync(new URL("../routes/onboarding.tsx", import.meta.url), "utf8");
    expect(onb).toContain("useState(false)");
    expect(onb).toContain("List my business for primes");
    expect(onb).toContain("if (listForPrimes)");
    expect(readFileSync(new URL("../routes/sub-finder.tsx", import.meta.url), "utf8")).toContain("/sub-finder/claim?uei=");
    expect(readFileSync(new URL("../components/MarketPage.tsx", import.meta.url), "utf8")).toContain("/sub-finder/claim?uei=");
    const join = readFileSync(new URL("../routes/sub-finder_.join.tsx", import.meta.url), "utf8");
    expect(join).toContain("searchRegistrants");
    expect(join).toContain("This is mine: claim it");
    expect(readFileSync(new URL("../../scripts/generate-sitemap.mjs", import.meta.url), "utf8")).toContain('["/sub-finder/join", "weekly", "0.6"]');
  });
});
