/**
 * THE OWNER'S NO-STATE RULE for lead alerts (verbatim, nightly SAM.gov CSV
 * ingest spec §Owner's rules 1, 2026-10-19): "Bids with no state should only
 * match on trade (NAICS code), never by default."
 *
 * Why it exists: the nightly CSV ingest stores the ~12,000 future-deadline
 * federal notices in SAM's extract, 69% of which (8,439 of 12,232 on the
 * 2026-10-17 extract) publish NO place-of-performance state. Before the guard,
 * a stateless bid was a state match for EVERY lead that had picked a state
 * (`stateMatch = !m || m[1] === state`) and also matched on any cert or size
 * signal, so a single lead's weekly email could fill with thousands of
 * unrelated federal notices.
 *
 * These tests import the PURE matcher module (src/lib/radar-lead-match.ts),
 * which radar-lead-alerts.ts re-exports: it pulls no database and no email
 * provider, so the rule can be pinned without stubbing Resend.
 *
 *   (a) a no-state bid matches a member ONLY via its trade terms / NAICS code,
 *   (b) a no-state bid never matches via state, cert or size alone — nor via
 *       cert + size + state combined,
 *   (c) a bid that DOES publish a place-of-performance state is unchanged.
 */
import { describe, expect, test } from "bun:test";
import {
  bidMatchesLeadProfile,
  bidPlaceStateCode,
  renderMatchWhyLine,
  whyBidMatchesLeadProfile,
} from "./radar-lead-match";

type Bid = Parameters<typeof bidMatchesLeadProfile>[1];
type Profile = NonNullable<Parameters<typeof bidMatchesLeadProfile>[0]>;

/** A complete bids row with only the fields a test cares about set. */
const bid = (o: Partial<Bid> = {}): Bid => ({
  id: 1,
  title: "",
  agency: null,
  category: null,
  description: null,
  location: null,
  set_aside: null,
  naics_code: null,
  due_date: null,
  estimated_value: null,
  source_url: null,
  ...o,
});

/** A complete radar profile; a test names only the dimensions it exercises. */
const profile = (o: Partial<Profile> = {}): Profile => ({
  trade: null,
  state: null,
  cert: null,
  sizePref: null,
  ...o,
});

const JANITORIAL = "Janitorial services for the Denver Federal Center";
const ROADS = "Two Lane Resurfacing — ODOT project 260426, Lake County";
/** A federal notice that publishes no work-site state and no trade evidence. */
const NO_STATE_UNRELATED = bid({ title: ROADS, location: "", set_aside: "SDVOSB", estimated_value: "50000" });

describe("a bid with no place-of-performance state", () => {
  test("matches ONLY through its trade terms", () => {
    const p = profile({ trade: "janitorial", state: "VA", cert: "sdvosb", sizePref: "under1m" });
    expect(bidMatchesLeadProfile(p, bid({ title: JANITORIAL, location: "" }))).toBe(true);
    expect(bidMatchesLeadProfile(p, bid({ title: JANITORIAL, location: "   " }))).toBe(true);
    // same profile, same cert/size signals, but no trade evidence → no match
    expect(bidMatchesLeadProfile(p, NO_STATE_UNRELATED)).toBe(false);
  });

  test("matches through a NAICS code (the other half of the trade dimension)", () => {
    const byNaics = profile({ trade: "561720", state: "VA" });
    expect(bidMatchesLeadProfile(byNaics, bid({ location: "", naics_code: "561720" }))).toBe(true);
    expect(bidMatchesLeadProfile(byNaics, bid({ location: "", naics_code: "237310" }))).toBe(false);
  });

  test("never matches through the state dimension alone", () => {
    // A member who picked a state gets NO stateless federal notice: there is no
    // state on the bid for the state dimension to match.
    expect(bidMatchesLeadProfile(profile({ state: "VA" }), bid({ title: JANITORIAL, location: "" }))).toBe(false);
    expect(bidMatchesLeadProfile(profile({ state: "VA" }), bid({ title: JANITORIAL, location: null }))).toBe(false);
  });

  test("never matches through a cert alone", () => {
    expect(bidMatchesLeadProfile(profile({ cert: "sdvosb" }), bid({ title: JANITORIAL, set_aside: "SDVOSB", location: "" }))).toBe(false);
    expect(bidMatchesLeadProfile(profile({ cert: "8a" }), bid({ title: "8(a) sole source notice", location: "" }))).toBe(false);
    // the "sb" pseudo-cert (any stated set-aside) is refused for a stateless bid too
    expect(bidMatchesLeadProfile(profile({ cert: "sb" }), bid({ title: JANITORIAL, set_aside: "Total Small Business", location: "" }))).toBe(false);
  });

  test("never matches through size alone", () => {
    expect(bidMatchesLeadProfile(profile({ sizePref: "under1m" }), bid({ title: JANITORIAL, estimated_value: "125000", location: "" }))).toBe(false);
    expect(bidMatchesLeadProfile(profile({ sizePref: "under250k" }), bid({ title: JANITORIAL, estimated_value: "50000", location: "" }))).toBe(false);
  });

  test("never matches through cert + size + state combined (the pre-fix behaviour)", () => {
    // Before the rule this exact bid matched: `stateMatch = !m || m[1] === state`
    // admitted the blank location, and cert/size each admitted it again.
    const p = profile({ state: "VA", cert: "sdvosb", sizePref: "under1m" });
    expect(bidMatchesLeadProfile(p, NO_STATE_UNRELATED)).toBe(false);
    // cert/size still cannot rescue it once a trade is added that does not match
    expect(bidMatchesLeadProfile(profile({ ...p, trade: "janitorial" }), NO_STATE_UNRELATED)).toBe(false);
    // …and trade is the one route that does admit it
    expect(
      bidMatchesLeadProfile(
        profile({ ...p, trade: "janitorial" }),
        bid({ title: JANITORIAL, location: "", set_aside: "SDVOSB", estimated_value: "50000" }),
      ),
    ).toBe(true);
  });

  test("the why-line names the trade route and never claims cert/size", () => {
    const p = profile({ trade: "janitorial", state: "VA", cert: "sdvosb", sizePref: "under1m" });
    const b = bid({ title: JANITORIAL, location: "", set_aside: "SDVOSB", estimated_value: "50000" });
    expect(bidMatchesLeadProfile(p, b)).toBe(true);
    const why = whyBidMatchesLeadProfile(p, b);
    expect(why.cert).toBeNull(); // cert is not a match route for a stateless bid
    expect(why.size).toBeNull(); // …nor is size
    expect(why.category).toBeTruthy(); // the trade reason that actually fired
    const line = renderMatchWhyLine(why);
    expect(line).toBeTruthy();
    expect(line!).not.toContain("SDVOSB");
    expect(line!).not.toContain("Under $1M");
  });
});

describe("a bid that DOES publish a place-of-performance state", () => {
  const vaBid = (o: Partial<Bid> = {}) => bid({ location: "Richmond, VA", ...o });
  const txBid = (o: Partial<Bid> = {}) => bid({ location: "Austin, TX", ...o });

  test("still matches on state alone", () => {
    expect(bidMatchesLeadProfile(profile({ state: "VA" }), vaBid({ title: ROADS }))).toBe(true);
    expect(bidMatchesLeadProfile(profile({ state: "VA" }), txBid({ title: ROADS }))).toBe(false);
  });

  test("still matches on a cert alone, anywhere", () => {
    const p = profile({ state: "VA", cert: "sdvosb" });
    expect(bidMatchesLeadProfile(p, txBid({ title: ROADS, set_aside: "SDVOSB" }))).toBe(true);
    expect(bidMatchesLeadProfile(p, txBid({ title: ROADS, set_aside: "WOSB" }))).toBe(false);
  });

  test("still matches on size alone, anywhere", () => {
    const p = profile({ state: "VA", sizePref: "under1m" });
    expect(bidMatchesLeadProfile(p, txBid({ title: ROADS, estimated_value: "50000" }))).toBe(true);
    expect(bidMatchesLeadProfile(p, txBid({ title: ROADS, estimated_value: "2500000" }))).toBe(false);
  });

  test("still matches on trade alone, in any state", () => {
    const p = profile({ state: "VA", trade: "janitorial" });
    expect(bidMatchesLeadProfile(p, vaBid({ title: JANITORIAL }))).toBe(true);
    expect(bidMatchesLeadProfile(p, txBid({ title: JANITORIAL }))).toBe(true);
    expect(bidMatchesLeadProfile(p, txBid({ title: ROADS }))).toBe(false);
  });

  test("still reports cert and size in the why-line", () => {
    const p = profile({ trade: "janitorial", state: "VA", cert: "sdvosb", sizePref: "under1m" });
    const why = whyBidMatchesLeadProfile(p, vaBid({ title: JANITORIAL, set_aside: "SDVOSB", estimated_value: "50000" }));
    expect(why.cert).toBe("SDVOSB");
    expect(why.size).toBe("Under $1M");
    expect(why.category).toBeTruthy();
    expect(renderMatchWhyLine(why)!).toContain("SDVOSB");
  });
});

describe("bidPlaceStateCode — the geography evidence the rule keys on", () => {
  test("blank or absent location means no published state", () => {
    expect(bidPlaceStateCode(null)).toBeNull();
    expect(bidPlaceStateCode(undefined)).toBeNull();
    expect(bidPlaceStateCode("")).toBeNull();
    expect(bidPlaceStateCode("   ")).toBeNull();
    expect(bidPlaceStateCode("Denver Federal Center")).toBeNull();
  });

  test("a published place of performance yields its state code", () => {
    expect(bidPlaceStateCode("Richmond, VA")).toBe("VA");
    expect(bidPlaceStateCode("richmond, va")).toBe("VA");
    expect(bidPlaceStateCode("Hamilton County, OH")).toBe("OH");
  });
});
