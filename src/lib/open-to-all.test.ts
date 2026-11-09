import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isFederalNoSetAside, isForeignWork, NOT_A_BID_TITLE_RE } from "./radar-candidates";
import { expandTrade, isStrongTradeMatch } from "./trade-registry";
import { cleanOpenToAllInput, OPEN_TO_ALL_MAX, toOpenToAllData } from "./open-to-all";
import { certMatches } from "./cert-matching";

// Owner 2026-11-09 ("yes build it"): about 7,000 open federal bids name no set-aside, so the
// small-business rule hid them from every Radar search. They are listed apart, under their own
// label, and never counted in the small-business numbers.
describe("open to all businesses", () => {
  test("a federal notice with no set-aside qualifies; set-aside or state/local ones do not", () => {
    expect(isFederalNoSetAside({ set_aside: null, source: "sam_gov" })).toBe(true);
    expect(isFederalNoSetAside({ set_aside: "  ", source: "SAM_GOV" })).toBe(true);
    expect(isFederalNoSetAside({ set_aside: "Total Small Business Set-Aside", source: "sam_gov" })).toBe(false);
    expect(isFederalNoSetAside({ set_aside: null, source: "nc_evp" })).toBe(false);
  });

  test("the small-business rule itself is unchanged", () => {
    expect(certMatches(null, ["sam_gov"], "sb")).toBe(null);
    expect(certMatches(null, ["nc_evp"], "sb")).toBe("include");
  });

  test("market research and intent notices are not bids", () => {
    for (const t of ["Sources Sought -Building 493 Generator and Backup Power Installation", "RFI - Janitorial Services", "Request for Information: HVAC", "Presolicitation Notice", "Notice of Intent to Sole Source"]) {
      expect(NOT_A_BID_TITLE_RE.test(t)).toBe(true);
    }
    for (const t of ["Correct Electrical Deficiencies", "Transition Security Guard Services — CDC Facilities", "RFID Tag Readers"]) {
      expect(NOT_A_BID_TITLE_RE.test(t)).toBe(false);
    }
  });

  test("industry days and market intelligence are not bids; overseas work is left out", () => {
    expect(NOT_A_BID_TITLE_RE.test("Tampa Harbor Improvements Industry Day")).toBe(true);
    expect(NOT_A_BID_TITLE_RE.test("Market Intelligence - Progressive Design-Build")).toBe(true);
    expect(NOT_A_BID_TITLE_RE.test("Kissimmee River Restoration (KRR) Project, S-69 Weir Repair")).toBe(false);
    expect(isForeignWork({ title: "Food Services for the Marine Security Guard (MSG) Detachment", location: "Bangui, CF-BGF" })).toBe(true);
    expect(isForeignWork({ title: "U.S. Mission Burundi Local Guard Program", location: "" })).toBe(true);
    expect(isForeignWork({ title: "Call for Solutions - DeCA Bavaria Area Commissary Facility Maintenance", location: "" })).toBe(true);
    expect(isForeignWork({ title: "Correct Electrical Deficiencies", location: "Fayetteville, NC" })).toBe(false);
    expect(isForeignWork({ title: "USAG Pressure Washing", location: "Fort Bragg, NC" })).toBe(false);
    expect(isForeignWork({ title: "Work", location: "US-TX" })).toBe(false);
  });

  test("cooking for a Marine Security Guard detachment is not guard work", () => {
    const g = expandTrade("security guard");
    expect(isStrongTradeMatch("RFQ - Providing Cooking Services at the Marine Security Guard", null, null, null, g)).toBe(false);
    expect(isStrongTradeMatch("Armed Security Guard Services", null, null, null, g)).toBe(true);
  });

  test("the state's own bids come first, counts stay exact, and the list is capped", () => {
    const row = (id: number) => ({ id, title: `Job ${id}`, agency: "Agency", location: "Atlanta, GA", due_date: "2026-12-01T00:00:00Z" });
    const d = toOpenToAllData("electrical", "GA", { local: [row(1)], nationwide: Array.from({ length: 40 }, (_, i) => row(i + 2)) });
    expect(d.localCount).toBe(1);
    expect(d.nationwideCount).toBe(40);
    expect(d.bids.length).toBe(OPEN_TO_ALL_MAX);
    expect(d.bids[0]).toMatchObject({ id: 1, local: true });
    expect(d.bids[1].local).toBe(false);
  });

  test("input is cleaned", () => {
    expect(cleanOpenToAllInput({ trade: "  security   guard ", state: "ga" })).toEqual({ trade: "security guard", state: "GA" });
    expect(cleanOpenToAllInput({ trade: "x", state: "Georgia" }).state).toBe("");
  });

  test("Radar and the state pages show the section, apart from the small-business counts", () => {
    const radar = readFileSync(new URL("../routes/radar.tsx", import.meta.url), "utf8");
    expect(radar).toContain('<OpenToAllBids trade={trade.trim()} state={state} where="radar" />');
    const page = readFileSync(new URL("../routes/contracts-in.$state_.$trade.tsx", import.meta.url), "utf8");
    expect(page).toContain('where="state_page" tone="light"');
    const lib = readFileSync(new URL("./seo-landing.tsx", import.meta.url), "utf8");
    expect(lib).toContain("count: bids.length,");
    const section = readFileSync(new URL("../components/OpenToAllBids.tsx", import.meta.url), "utf8");
    expect(section).toContain("Open to all businesses (no set-aside)");
    expect(section).toContain("open to every company, small businesses included");
  });
});
