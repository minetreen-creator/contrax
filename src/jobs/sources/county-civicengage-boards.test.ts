import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";
import { CIVICENGAGE_NOT_A_BID_GROUP, parseCivicEngageBoard } from "./civicengage-bids";
import { COUNTY_CIVICENGAGE_CONFIGS, COUNTY_CIVICENGAGE_SOURCES, parseCountyCivicEngage } from "./county-civicengage-boards";

const dirOf = (host: string) =>
  new URL(`./fixtures/county-civicengage/${host.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-")}/`, import.meta.url);
const capture = (host: string, n: number) => {
  const dir = dirOf(host);
  const file = readdirSync(dir).find((f) => f.endsWith(`-fetch${n}.html`))!;
  return readFileSync(new URL(file, dir), "utf8");
};
const now = Date.parse("2026-10-27T02:30:00Z");

// Open competitive bids per board in the 2026-10-27 capture, after the group filter.
const OPEN: Record<string, number> = {
  va_hopewell: 7, va_danville: 8, va_salem: 7, va_pittsylvania: 2, va_williamsburg: 2,
  md_hagerstown: 1, md_queen_annes: 1, md_college_park: 2,
  nc_high_point: 4, nc_pitt_county: 2,
  fl_bay_county: 1, fl_titusville: 4,
  ga_hall_county: 2, ga_barrow_county: 7,
  tx_league_city: 5, tx_longview: 2, tx_midland: 4, tx_odessa: 3,
};

describe("county CivicEngage boards", () => {
  test("eighteen boards with unique sources and id prefixes", () => {
    expect(COUNTY_CIVICENGAGE_CONFIGS).toHaveLength(18);
    expect(new Set(COUNTY_CIVICENGAGE_CONFIGS.map((c) => c.source)).size).toBe(18);
    expect(new Set(COUNTY_CIVICENGAGE_CONFIGS.map((c) => c.idPrefix)).size).toBe(18);
  });

  for (const cfg of COUNTY_CIVICENGAGE_CONFIGS) {
    test(`${cfg.source}: captured board parses to its open competitive bids`, () => {
      const { rows } = parseCountyCivicEngage(cfg.source, capture(cfg.host, 1), now);
      expect(rows).toHaveLength(OPEN[cfg.source]);
      expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
      for (const r of rows) {
        expect(r.external_id.startsWith(`${cfg.idPrefix}-`)).toBe(true);
        expect(r.source_url).toStartWith(`${cfg.endpoint}?bidID=`);
        expect(r.agency).toBe(cfg.agency);
        expect(r.location).toBe(cfg.location);
      }
      // The second fetch reads the same bids.
      const again = parseCountyCivicEngage(cfg.source, capture(cfg.host, 2), now).rows.map((r) => r.external_id).sort();
      expect(again).toEqual(rows.map((r) => r.external_id).sort());
    });
  }

  test("non-competition groups are skipped and a bid in two groups is emitted once", () => {
    const danville = COUNTY_CIVICENGAGE_CONFIGS.find((c) => c.source === "va_danville")!;
    const filtered = parseCountyCivicEngage("va_danville", capture(danville.host, 1), now);
    expect(filtered.skipped.not_a_bid_group).toBe(14);
    expect(filtered.skipped.duplicate_listing).toBe(7);
    // Without the filter (the original behavior) the same page yields every listing.
    const { excludeGroup: _omit, ...plain } = danville;
    expect(parseCivicEngageBoard(capture(danville.host, 1), plain, now).rows.length).toBe(29);
    for (const g of ["Emergency", "Sole Source", "x Bid Results - Closed", "Plan Holders and Pre-bid Attendees", "Notice of Award/Intent to Award/Cancellation", "Cooperative Procurement Contracts"]) {
      expect(CIVICENGAGE_NOT_A_BID_GROUP.test(g)).toBe(true);
    }
    for (const g of ["Bid Opportunities", "Construction Services Bids", "Request for Proposal", "Purchasing Dept Bids", "Parks & Recreation"]) {
      expect(CIVICENGAGE_NOT_A_BID_GROUP.test(g)).toBe(false);
    }
  });

  test("every board is scheduled, classified, placed in its state, and has an agency page", () => {
    for (const s of COUNTY_CIVICENGAGE_SOURCES) {
      expect(TAIL_SOURCES.find((t) => t.name === s.name)?.fetchFn).toBe(s.fetchFn);
      expect(SOURCE_CLASSES[s.name]?.class).toBe("local");
      expect(SOURCE_HOME_JURISDICTIONS[s.name]).toBe(SOURCE_CLASSES[s.name]?.scopeState);
      expect(LOCAL_AGENCIES.some((a) => a.source === s.name)).toBe(true);
    }
  });
});
