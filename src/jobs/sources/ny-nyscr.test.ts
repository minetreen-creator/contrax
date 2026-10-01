/**
 * NYS Contract Reporter (`ny_nyscr`) connector pins. Zero network, no
 * database: the fixtures are the eight public search pages captured
 * 2026-10-01 (gzipped; see fixtures/ny-nyscr/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import {
  isNyscrSearchPage,
  nyscrAdUrl,
  nyscrDueToIso,
  nyscrLocation,
  nyscrSearchUrl,
  nyscrTotal,
  parseNyscrAds,
  readNyscrPage,
} from "./ny-nyscr";

const PAGES = [0, 100, 200, 300, 400, 500, 600, 700].map((skip) =>
  gunzipSync(readFileSync(new URL(`./fixtures/ny-nyscr/open-skip${skip}-2026-10-01.html.gz`, import.meta.url))).toString("utf8"),
);
const ADS = PAGES.flatMap(readNyscrPage);
const CAPTURED = Date.parse("2026-10-01T16:00:00Z");

describe("ny_nyscr — parse (captured pages)", () => {
  test("reads all 798 open ads across 8 pages; biddable ones become New York bids", () => {
    expect(PAGES.every(isNyscrSearchPage)).toBe(true);
    expect(nyscrTotal(PAGES[0])).toBe(798);
    expect(ADS.length).toBe(798);
    const { rows, skipped } = parseNyscrAds(ADS, CAPTURED);
    expect(skipped.contractor_ad).toBe(57);
    expect(skipped.sole_source_notice).toBe(34);
    expect(skipped.grant_notice).toBe(32);
    expect(skipped.surplus_sale).toBe(1);
    expect(rows.length + Object.values(skipped).reduce((a, b) => a + b, 0)).toBe(new Set(ADS.map((a) => a.id)).size);
    for (const r of rows) {
      expect(r.external_id).toBe(`nyscr-${r.solicitation_number}`);
      expect(r.source_url).toBe(nyscrAdUrl(r.solicitation_number!));
      expect(r.title.length).toBeGreaterThan(0);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "ny_nyscr" });
      expect(cols.source_jurisdiction).toBe("NY");
      expect(cols.normalized_state).toBe("NY");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("the Amherst street lighting ad maps field by field", () => {
    const { rows } = parseNyscrAds(ADS, CAPTURED);
    const row = rows.find((r) => r.solicitation_number === "2139282")!;
    expect(row.title).toBe("STREET LIGHTING AND ELECTICAL INFRASTRUTURE MAINTENANCE");
    expect(row.agency).toBe("Amherst, Town of — Engineering Department");
    expect(row.location).toBe("Town of Amherst, New York");
    expect(row.due_date).toBe("2026-10-30T03:59:00.000Z"); // 11:59 PM EDT on 10/29
    expect(row.notice_type).toBe("General");
    expect(row.description).toContain("NYSCR category: Construction Horizontal");
    expect(row.description).not.toContain("Amherst, Town of");
  });

  test("ads already due are skipped", () => {
    const { skipped } = parseNyscrAds(ADS, Date.parse("2026-11-01T00:00:00Z"));
    expect(skipped.closed).toBeGreaterThan(0);
  });

  test("a page that is not the search page is rejected", () => {
    expect(isNyscrSearchPage("<html><title>Error</title></html>")).toBe(false);
    expect(readNyscrPage("<html></html>")).toEqual([]);
  });
});

describe("ny_nyscr — helpers", () => {
  test("due dates are 11:59 PM Eastern; text deadlines are open-ended", () => {
    expect(nyscrDueToIso("10/29/2026")).toBe("2026-10-30T03:59:00.000Z");
    expect(nyscrDueToIso("1/15/2027")).toBe("2027-01-16T04:59:00.000Z"); // EST
    expect(nyscrDueToIso("Until contract is awarded")).toBeNull();
    expect(nyscrDueToIso("")).toBeNull();
  });

  test("locations stay in New York", () => {
    expect(nyscrLocation("")).toBe("New York");
    expect(nyscrLocation("Statewide")).toBe("New York");
    expect(nyscrLocation("TBD")).toBe("New York");
    expect(nyscrLocation("Buffalo, NY")).toBe("Buffalo, NY");
    expect(nyscrLocation("Cortland County")).toBe("Cortland County, New York");
    // a place named like another state never becomes that state
    expect(nyscrLocation("Delaware County")).toBe("New York");
    expect(nyscrLocation("Washington County")).toBe("New York");
  });

  test("URLs", () => {
    expect(nyscrSearchUrl(200)).toBe("https://www.nyscr.ny.gov/Ads/Search?Status=Open&Top=100&Skip=200");
    expect(nyscrAdUrl("2139282")).toBe("https://www.nyscr.ny.gov/Ads/Search?Keyword=2139282");
  });
});

describe("ny_nyscr — registration", () => {
  test("registered as a tail sync source, New York home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "ny_nyscr")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["ny_nyscr"]).toBe("NY");
    expect(isStateLocalSource(["ny_nyscr"])).toBe(true);
    expect(sourceBadgeLabel("ny_nyscr")).toBe("State (NY)");
  });
});
