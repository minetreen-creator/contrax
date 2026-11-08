import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { expandTrade, isStrongTradeMatch } from "~/lib/trade-registry";
import { TAIL_SOURCES } from "../runner";
import { bsoHeaders, bsoRowCount, CONTRAXBOT_USER_AGENT, isBsoSearchPage, parseBsoRows, readBsoRows } from "./periscope-bso";
import { PERISCOPE_CITIES, PERISCOPE_STATES } from "./periscope-states";

// Owner 2026-11-08 ("yes, check Philadelphia"): PHLContracts' public open-bids page, captured
// 2026-11-08 11:35 UTC as ContraxBot with no sign-in (63 open bids; the live reader read all 63).
const html = gunzipSync(readFileSync(new URL("./fixtures/periscope/open-www.phlcontracts.phila.gov-2026-11-08.html.gz", import.meta.url))).toString("utf8");
const CAPTURED = Date.parse("2026-11-08T11:35:27Z");
const config = PERISCOPE_CITIES.pa_philadelphia_phlcontracts;

describe("City of Philadelphia (PHLContracts)", () => {
  test("the public page is the Periscope open-bid search with 63 open bids", () => {
    expect(isBsoSearchPage(html)).toBe(true);
    expect(bsoRowCount(html)).toBe(63);
    expect(bsoHeaders(html)).toEqual(expect.arrayContaining(["Bid Solicitation #", "Organization Name", "Description", "Bid Opening Date", "Status"]));
  });

  test("rows become City of Philadelphia bids in Philadelphia, PA, linked to the city's own bid page", () => {
    const { rows, skipped } = parseBsoRows(config, readBsoRows(html, bsoHeaders(html)), CAPTURED);
    expect(rows.length).toBe(25);
    expect(skipped).toEqual({});
    for (const b of rows) {
      expect(b.agency.startsWith("City of Philadelphia")).toBe(true);
      expect(b.location).toBe("Philadelphia, PA");
      expect(b.external_id).toMatch(/^phlcontracts-B\d+$/);
      expect(b.source_url).toBe(`https://www.phlcontracts.phila.gov/bso/external/bidDetail.sda?docId=${b.external_id.slice("phlcontracts-".length)}&external=true`);
      expect(Date.parse(String(b.due_date))).toBeGreaterThan(CAPTURED);
    }
  });

  test("Philadelphia sends Contrax's own bot name; the state boards keep theirs", () => {
    expect(config.userAgent).toBe(CONTRAXBOT_USER_AGENT);
    for (const c of Object.values(PERISCOPE_STATES)) expect(c.userAgent).toBeUndefined();
  });

  test("registered as a Pennsylvania local source", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "pa_philadelphia_phlcontracts")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS.pa_philadelphia_phlcontracts).toBe("PA");
  });

  test("Philadelphia's water-main relays and ECMS road jobs are construction; supplies are not", () => {
    const construction = expandTrade("construction");
    const strong = (t: string) => isStrongTradeMatch(t, null, null, null, construction);
    for (const t of [
      "PW Bid 2505- RELAY of WATER MAINS in ADAMS AVE from E. WINGOHOCKING ST. to 250' NORTH of UNITY ST",
      "PW Bid 3958ECMS - MPMS 107648 5th Street Rising Sun to US-1",
      "PW Bid 3986ECMS (MPMS# 111515) Cherokee St. o/ Valley Green Rd.",
      "PW Bid 3993ECMS - MPMS 82199 Cottman Ave Redesign with GSI",
      "PW Bid 2475 - General Construction for the Replacement of 42nd St Pumping Station Fed Funded",
    ]) expect(`${strong(t)} | ${t}`).toBe(`true | ${t}`);
    for (const t of ["RUNWAY SAND, SILICA", "USA Flags", "Snow & Ice Removal Services Region 5 - FLP", "Double-Roll Toilet Tissue Dispenser"])
      expect(`${strong(t)} | ${t}`).toBe(`false | ${t}`);
  });
});
