import { describe, expect, test } from "bun:test";
import { buildDigestMatcher } from "./digest-match";

const ohioJanitorial = { title: "Janitorial Services for District Office", location: "Hamilton County, Ohio", agency: "Ohio Department of Transportation" };
const vaJanitorial = { title: "Custodial services, regional office", location: "Richmond, VA", agency: "VDOT" };
const ohioRoads = { title: "Two Lane Resurfacing — ODOT project 260426, Lake County", location: "Lake County, Ohio" };
const federalNaics = { title: "Facility support", location: "Columbus, OH", naics_code: "561720" };

describe("personal daily email — matching a member's profile", () => {
  test("states and trade narrow the list; full state names count", () => {
    const m = buildDigestMatcher({ locations: ["OH"], industry: "janitorial" });
    expect(m.personal).toBe(true);
    expect(m.label).toBe("janitorial in OH");
    expect(m.matches(ohioJanitorial)).toBe(true);
    expect(m.matches(vaJanitorial)).toBe(false); // wrong state
    expect(m.matches(ohioRoads)).toBe(false); // wrong trade
  });

  test("a NAICS-only profile matches state bids by text and federal bids by code", () => {
    const m = buildDigestMatcher({ locations: ["OH"], naics_codes: ["561720"] });
    expect(m.personal).toBe(true);
    expect(m.matches(ohioJanitorial)).toBe(true); // no NAICS on the bid, matched by "janitorial"
    expect(m.matches(federalNaics)).toBe(true);
    expect(m.matches(ohioRoads)).toBe(false);
  });

  test("trade only, states only, and nothing", () => {
    const tradeOnly = buildDigestMatcher({ industry: "janitorial" });
    expect(tradeOnly.matches(vaJanitorial)).toBe(true);
    expect(tradeOnly.matches(ohioRoads)).toBe(false);
    const statesOnly = buildDigestMatcher({ locations: ["OH"] });
    expect(statesOnly.matches(ohioRoads)).toBe(true);
    expect(statesOnly.matches(vaJanitorial)).toBe(false);
    const none = buildDigestMatcher(null);
    expect(none.personal).toBe(false);
    expect(none.label).toBe("");
    expect(none.matches(ohioRoads)).toBe(true);
  });

  test("selecting every state is the same as no state filter", () => {
    const all = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];
    const m = buildDigestMatcher({ locations: all });
    expect(m.personal).toBe(false);
    expect(m.matches(vaJanitorial)).toBe(true);
  });

  // NO-STATE GUARD (owner 2026-10-19, nightly SAM.gov CSV ingest spec §Owner's
  // rules 1): the nightly ingest stores ~12,000 future-deadline federal notices
  // of which 69% publish no place-of-performance state. Such a bid may ONLY
  // reach a member through the TRADE dimension — never by default, and never
  // admitted by a blank-state clause.
  describe("a bid with no place-of-performance state", () => {
    const noStateMatchedTrade = { title: "Janitorial services nationwide", location: "", agency: "GSA", naics_code: "561720" };
    const noStateUnmatchedTrade = { title: "Janitorial services nationwide", location: "", agency: "GSA", naics_code: "237310" };
    // A blank location with an office string that happens to carry a state token
    // ("CO") is still a no-state bid: an office is not a work site.
    const noStateOfficeToken = { title: "Grounds maintenance", location: "", agency: "0906 AQ CO DET A CONTRACTI", naics_code: "561730" };

    test("never matches a states-only member (it used to be a blank-state match would reach everyone)", () => {
      const m = buildDigestMatcher({ locations: ["VA"] });
      expect(m.personal).toBe(true);
      expect(m.matches(noStateMatchedTrade)).toBe(false);
      expect(m.matches(noStateOfficeToken)).toBe(false);
    });

    test("reaches a member only through the trade it matches", () => {
      const m = buildDigestMatcher({ locations: ["VA"], naics_codes: ["561720"] });
      expect(m.matches(noStateMatchedTrade)).toBe(true); // trade evidence
      expect(m.matches(noStateUnmatchedTrade)).toBe(false); // no state, wrong trade
    });

    test("a bid that DOES publish another state still does not match", () => {
      const m = buildDigestMatcher({ locations: ["VA"], naics_codes: ["561720"] });
      expect(m.matches({ ...noStateMatchedTrade, location: "Denver, CO" })).toBe(false);
    });
  });
});
