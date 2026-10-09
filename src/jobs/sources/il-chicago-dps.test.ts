/**
 * City of Chicago DPS weekly Bid Opportunity List (`il_chicago_dps`) connector
 * pins. Zero network, no database: the fixtures are the DPS Current Bid
 * Opportunities page and the Oct 5, 2026 list PDF it linked, captured 2026-10-09
 * (see fixtures/il-chicago-dps/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource } from "~/lib/cert-matching";
import { AWARD_TYPE_SOURCES, SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import {
  bidListPdfText,
  chicagoAgency,
  chicagoOpeningToIso,
  CHICAGO_DPS_PAGE_URL,
  findBidListPdf,
  parseChicagoBidList,
  readBidList,
} from "./il-chicago-dps";

const DIR = new URL("./fixtures/il-chicago-dps/", import.meta.url);
const PAGE = gunzipSync(readFileSync(new URL("current-bid-opportunities-2026-10-09.html.gz", DIR))).toString("utf8");
const PDF = new Uint8Array(readFileSync(new URL("bid-opportunity-list-2026-10-05.pdf", DIR)));
const LIST_DAY = Date.parse("2026-10-05T12:00:00Z"); // the list's own date
const CAPTURED = Date.parse("2026-10-09T12:00:00Z");

describe("il_chicago_dps — the DPS page", () => {
  test("links the Oct 5, 2026 weekly list", () => {
    expect(findBidListPdf(PAGE)).toBe(
      "https://www.chicago.gov/content/dam/city/depts/dps/WeeklyBidOpportunities/2026WeeklyBidOpportunities/100526.pdf",
    );
  });

  test("picks the newest list when more than one is linked; none → null", () => {
    const two =
      '<a href="/content/dam/city/depts/dps/WeeklyBidOpportunities/2026WeeklyBidOpportunities/092826.pdf">a</a>' +
      '<a href="/content/dam/city/depts/dps/WeeklyBidOpportunities/2026WeeklyBidOpportunities/100526.pdf">b</a>';
    expect(findBidListPdf(two)).toEndWith("/100526.pdf");
    expect(findBidListPdf("<html>no list</html>")).toBeNull();
  });
});

describe("il_chicago_dps — the captured list", async () => {
  const text = await bidListPdfText(PDF);

  test("29 solicitations read from the 8-page PDF", () => {
    expect(readBidList(text).length).toBe(29);
  });

  test("on the list's own date only the opening already past (Oct 5, 11 a.m.) is closed", () => {
    const { rows, skipped } = parseChicagoBidList(text, LIST_DAY);
    expect(rows.length).toBe(29);
    expect(skipped).toEqual({});
    const later = parseChicagoBidList(text, Date.parse("2026-10-05T17:00:00Z"));
    expect(later.skipped.closed).toBe(1);
  });

  test("a construction entry maps field by field", () => {
    const row = parseChicagoBidList(text, CAPTURED).rows.find((r) => r.solicitation_number === "1337508")!;
    expect(row.external_id).toBe("chicagodps-1337508");
    expect(row.title).toBe("100th St Bascule Bridge Over the Calumet River Rehabilitation");
    expect(row.agency).toBe("City of Chicago — Department of Transportation");
    expect(row.location).toBe("Chicago, IL");
    expect(row.due_date).toBe("2026-11-06T17:00:00.000Z"); // 11:00 a.m. CST
    expect(row.category).toBe("Construction");
    expect(row.notice_type).toBe("Construction");
    expect(row.source_url).toBe(CHICAGO_DPS_PAGE_URL);
    expect(row.estimated_value).toBe("Not specified");
    expect(row.description).toContain("eProcurement");
  });

  test("work-services, small-order and A&E entries keep DPS's category and wording", () => {
    const rows = parseChicagoBidList(text, CAPTURED).rows;
    const land = rows.find((r) => r.solicitation_number === "1291989")!;
    expect(land.title).toBe("Target Market Comprehensive Landscaping Services");
    expect(land.notice_type).toBe("Work Services");
    expect(land.category).toBe("Landscaping");
    expect(land.agency).toBe("City of Chicago — Department of Aviation");
    expect(rows.find((r) => r.solicitation_number === "1312397")!.notice_type).toBe("Small Order");
    const ae = rows.find((r) => r.solicitation_number === "1356791")!;
    expect(ae.notice_type).toBe("Architecture & Engineering");
    expect(ae.category).toBe("Other"); // a planning-studies design contract, not trucking
    expect(ae.due_date).toBe("2026-11-06T21:00:00.000Z"); // 3:00 p.m. CST
    for (const r of rows) expect(r.title).not.toMatch(/\(eProcurement\)$/);
  });

  test("every row lands in Illinois", () => {
    for (const row of parseChicagoBidList(text, CAPTURED).rows) {
      const cols = deriveInsertLocationColumns({
        location: row.location,
        agency: row.agency,
        title: row.title,
        description: row.description,
        sourceName: "il_chicago_dps",
      });
      expect(cols.normalized_state).toBe("IL");
    }
  });
});

describe("il_chicago_dps — helpers", () => {
  test("Central time; garbage is null", () => {
    expect(chicagoOpeningToIso("10/14/2026", "11:00 a.m.")).toBe("2026-10-14T16:00:00.000Z");
    expect(chicagoOpeningToIso("12/01/2026", "3:00 p.m.")).toBe("2026-12-01T21:00:00.000Z");
    expect(chicagoOpeningToIso("13/01/2026", "3:00 p.m.")).toBeNull();
    expect(chicagoOpeningToIso("10/14/2026", "noon")).toBeNull();
  });

  test("department codes are spelled out; an unknown code is kept as printed", () => {
    expect(chicagoAgency("2FM")).toBe("City of Chicago — Department of Fleet and Facility Management");
    expect(chicagoAgency("XYZ")).toBe("City of Chicago (XYZ)");
  });
});

describe("il_chicago_dps — registration", () => {
  test("a Chicago, Illinois local OPEN-opportunity source (not an award feed)", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "il_chicago_dps")).toBe(true);
    expect(SOURCE_CLASSES["il_chicago_dps"]).toMatchObject({ class: "local", city: "Chicago", scopeState: "IL", recordType: "opportunity" });
    expect(AWARD_TYPE_SOURCES.has("il_chicago_dps")).toBe(false);
    expect(SOURCE_HOME_JURISDICTIONS["il_chicago_dps"]).toBe("IL");
    expect(isStateLocalSource(["il_chicago_dps"])).toBe(true);
  });
});
