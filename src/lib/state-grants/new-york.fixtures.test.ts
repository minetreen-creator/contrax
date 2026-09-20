/**
 * NEW YORK (fixtures) — the deterministic half of the state's verification.
 * Everything below runs on the REAL capture in
 * `./fixtures/ny-sfs-grant-opportunity-grid.html`: the 100,823-byte response to
 * a public-session GET of New York's Grant Opportunity Portal, saved VERBATIM
 * (byte for byte, untrimmed) exactly as the connector's own `fetch()` receives
 * it. ZERO network.
 *
 * The live half is `new-york.source-validation.test.ts` (opt-in), which repeats
 * the whole handshake against the real portal.
 *
 * WHAT THIS FILE PINS DOWN:
 *   - 22 records, one per grid row, keyed on the source's own Event ID;
 *   - the record's ONLY date is the column the source itself labels "Due Date";
 *   - that ownership is STRUCTURAL: the header labels the portal prints are
 *     zipped with the column order its own `gridFieldList_win0` declares, and a
 *     grid whose two declarations disagree fails closed rather than being read;
 *   - the grid's own declared row count is cross-checked, so a truncated grid is
 *     a failed read rather than a shorter listing;
 *   - the other two date columns ("Availability Date", "Anticipated Release
 *     Date") are refused verbatim, and no posting date or estimate is produced;
 *   - the owner's five statuses only — `forecast` appears nowhere.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseGrantOpportunities, STATE_GRANT_STATUSES } from "~/lib/state-grants/connector";
import {
  NEW_YORK_COLUMN_FIELD,
  NEW_YORK_LISTING_MARKER,
  NEW_YORK_SOURCE_URL,
  newYorkColumnLabels,
  newYorkDeclaredRowCount,
  newYorkGridFieldOrder,
  newYorkGridRows,
  newYorkConnector,
} from "~/lib/state-grants/connectors/new-york";

/** One fixed clock for every classification below (2026-09-20, US Eastern). */
const NOW = new Date("2026-09-20T12:00:00Z");
const FIXTURE = "ny-sfs-grant-opportunity-grid.html";
function payload(): string {
  return readFileSync(new URL(`./fixtures/${FIXTURE}`, import.meta.url), "utf8");
}
const NY = (now: Date = NOW) => parseGrantOpportunities(newYorkConnector, payload(), now).opportunities;
const byId = (slug: string) => NY().find((o) => o.externalId.endsWith(slug))!;
const slugOf = (o: { externalId: string }) =>
  o.externalId.replace("ny-sfs-grant-opportunity-portal-", "");

/** The portal's own id, title, agency code and Due Date, row for row. */
const EXPECTED: readonly [string, string, string, string | null][] = [
  ["evt0000003", "RFI0431", "AGM01", "2026-10-08"],
  ["fpig20", "Round 20 Farmland Protection Implementation Grants", "AGM01", "2027-06-01"],
  ["rsfi26", "Regional School Food Infrastructure Grant Program", "AGM01", "2027-01-22"],
  ["soi-1266", "SOI 1266 Dolly Parton's Imagination Library (1.2)", "CFS01", "2026-09-28"],
  ["soi-1275", "SOI 1275 New York Statewide Fatherhood Engagement", "CFS01", "2026-09-25"],
  ["soi-1276", "SOI 1276 Dolly Parton's Imagination Library in NYC", "CFS01", "2026-09-28"],
  ["cdd-agc-26", "Supporting Aging Caregivers 2026", "DDP01", "2026-10-02"],
  ["core-2026", "CoRe 2026", "DEC01", "2026-11-04"],
  ["mwrc-2026", "Municipal Waste Reduction Recycling Coordination", "DEC01", "2026-10-30"],
  ["mwrr-2024", "Municipal Waste Reduction and Rcycling. Prgrm. 24", "DEC01", "2027-11-01"],
  ["aicgp2027", "RFA #20818 AIDS Institute Clinical Guidelines Prog", "DOH01", "2026-10-22"],
  ["dwfrfa2028", "Drinking Water Fluoridation RFA", "DOH01", "2028-09-28"],
  ["pcscrd8", "Primary Care Services Corps - Rd 8", "DOH01", "2026-10-27"],
  ["wicone27", "NYS WIC Online Nutrition Education", "DOH01", "2026-09-29"],
  ["gcew-ev", "NYSDOL OJET GCEW-EV", "DOL01", "2026-12-03"],
  ["mh253023", "Crisis Intervention Teams and System Programs", "OMH01", "2026-10-14"],
  ["mh263034", "Teams to Promote Aging in Place (TPAP)", "OMH01", "2026-12-01"],
  ["mh263035", "Older Adult Technical Assistance Center (OATAC)", "OMH01", "2026-12-01"],
  ["mh263036", "Delivering Sources of Strength", "OMH01", "2026-10-28"],
  ["mh263037", "Health-led Community Behavioral Health Crisis", "OMH01", "2026-11-19"],
  ["mh263038", "LGBTQIA+ Youth and Young Adult Crisis Line", "OMH01", "2026-11-12"],
  ["venture-vi", "Venture VI Program for SNAP Participants", "TDA01", "2030-07-22"],
];

describe("New York State Grant Opportunity Portal (SFS Vendor Portal, fixtures)", () => {
  test("reads exactly one record per grid row, in the portal's own order", () => {
    const records = NY();
    expect(records.length).toBe(22);
    expect(records.length).toBe(newYorkGridRows(payload()).length);
    expect(records.map(slugOf)).toEqual(EXPECTED.map(([slug]) => slug));
    // The source's own ids: every external id is unique, so nothing collides.
    expect(new Set(records.map((o) => o.externalId)).size).toBe(22);
    expect(parseGrantOpportunities(newYorkConnector, payload(), NOW).collisions).toEqual([]);
    // Title and agency code come from the columns the portal labels
    // "Grant Opportunity" and "Funding Agency", row for row.
    expect(records.map((o) => [o.title, o.raw.fundingAgency])).toEqual(
      EXPECTED.map(([, title, agency]) => [title, agency]),
    );
  });

  test("the owner's five statuses only — `forecast` is gone", () => {
    for (const o of NY()) {
      expect(STATE_GRANT_STATUSES).toContain(o.status);
      expect(o.stateCode).toBe("NY");
      expect(o.sourceKey).toBe(newYorkConnector.id);
      expect(JSON.stringify(o)).not.toContain("forecast");
      expect(o.agency).toBe("New York State — Statewide Financial System (SFS) Vendor Portal");
      expect(o.title.trim().length).toBeGreaterThan(2);
      expect(o.sourceUrl).toBe(NEW_YORK_SOURCE_URL);
      // A grid row's name cell is a PeopleSoft `javascript:` post-back, not a
      // link: the record points at the official portal page, never elsewhere.
      expect(o.url).toBe(NEW_YORK_SOURCE_URL);
      expect(o.raw.perOpportunityUrlAvailable).toBe(false);
    }
    // Every Due Date the portal publishes today is still ahead of 2026-09-20.
    expect(NY().filter((o) => o.status === "open").length).toBe(22);
    expect(NY().filter((o) => o.status === "closed").length).toBe(0);
    expect(NY().filter((o) => o.status === "rolling").length).toBe(0);
    expect(NY().filter((o) => o.status === "upcoming").length).toBe(0);
    expect(NY().filter((o) => o.status === "unverified").length).toBe(0);
  });

  test("the close date IS the source's own Due Date column, row for row", () => {
    expect(NY().map((o) => [slugOf(o), o.closeDate])).toEqual(
      EXPECTED.map(([slug, , , due]) => [slug, due]),
    );
    for (const o of NY()) {
      expect(o.closeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // The source's own cell text is kept beside the parsed day, verbatim.
      expect(String(o.raw.closeDateCellText)).toMatch(/^\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}(AM|PM)\s+E[DS]T$/);
      expect(o.raw.closeDateReadFromTheDueDateColumn).toBe(true);
      expect(o.raw.closeDateColumnLabel).toBe("Due Date");
    }
    // The one row whose Due Date is two years out is still the source's own date.
    expect(byId("venture-vi").raw.closeDateCellText).toBe("07/22/2030 5:00PM EDT");
  });

  test("column ownership is re-derived from the portal's own two declarations", () => {
    const raw = payload();
    const labels = [...newYorkColumnLabels(raw)].sort((a, b) => a[0] - b[0]);
    expect(labels).toEqual([
      [0, "Event ID"],
      [1, "Funding Agency"],
      [2, "Grant Opportunity"],
      [3, "Status"],
      [4, "Eligibility"],
      [6, "Availability Date"],
      [7, "Anticipated Release Date"],
      [8, "Due Date"],
    ]);
    // The grid's own field list, position for position, is the binding this
    // connector reads through — so "Due Date" is the LAST value column.
    expect(newYorkGridFieldOrder(raw)).toEqual([
      "AUC_ID_COL",
      "NY_AUC_INQ1_WRK_BUSINESS_UNIT",
      "AUC_NAME_LNK",
      "NY_AUC_INQ1_WRK_NY_GG_PORT_STATUS",
      "NY_AUC_INQ1_WRK_FIELDLIST",
      "RESP_INQA1_WK_AUC_DTTM_PREVIEW",
      "RESP_INQA1_WK_AUC_DTTM_START",
      "RESP_INQA1_WK_AUC_DTTM_FINISH",
    ]);
    expect(NEW_YORK_COLUMN_FIELD["Due Date"]).toBe("RESP_INQA1_WK_AUC_DTTM_FINISH");
    // The grid's own declared row count agrees with what was parsed.
    expect(newYorkDeclaredRowCount(raw)).toBe(22);
    expect(NY().every((o) => o.raw.gridRowsDeclaredByPortal === 22)).toBe(true);
    expect(NY().every((o) => o.raw.gridRowsParsed === 22)).toBe(true);
    // A grid whose own field list no longer matches its printed headers is
    // refused rather than read — the whole point of the structural gate.
    const swapped = raw.replace("gridFieldList_win0", "gridFieldList_RENAMED_win0");
    expect(() => parseGrantOpportunities(newYorkConnector, swapped, NOW)).toThrow(
      /ownership changed/,
    );
  });

  test("every other date column is REFUSED verbatim, and no estimate is produced", () => {
    for (const o of NY()) {
      expect(o.postedDate).toBeNull();
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.ongoing).toBe(false);
      expect(o.raw.availabilityDateNeverAPostingDate).toBe(true);
      expect(o.raw.anticipatedReleaseDateNeverADeadline).toBe(true);
      expect(o.raw.refusedDatesNeverCloseDates).toBe(true);
      const refused = o.raw.refusedDates as { text: string; kind: string; reason: string }[];
      const kinds = refused.map((r) => r.kind);
      // A portal always prints a value in both of its other date columns.
      expect(kinds).toContain("availability-date-column");
      expect(kinds).toContain("anticipated-release-date-column");
      for (const r of refused) {
        expect(r.reason.length).toBeGreaterThan(20);
        expect(r.text).not.toBe(o.raw.closeDateCellText);
      }
    }
    // The refused text is the source's own cell, verbatim.
    const evt = byId("evt0000003");
    const refused = evt.raw.refusedDates as { text: string; kind: string }[];
    expect(refused.find((r) => r.kind === "availability-date-column")?.text).toBe("09/10/26 8:30AM");
    expect(refused.find((r) => r.kind === "anticipated-release-date-column")?.text).toBe(
      "09/10/26 8:30AM",
    );
    // Eligibility is the portal's own column, read verbatim.
    expect(byId("pcscrd8").eligibleApplicants).toBe("Individual");
    expect(byId("dwfrfa2028").eligibleApplicants).toBe(
      "For Profit, Governmental Entity, Not-For-Profit",
    );
  });

  test("the source's own Status cell is the only declared state", () => {
    expect(byId("evt0000003").raw.portalStatus).toBe("Advertised Only - Not in SFS");
    expect(byId("fpig20").raw.portalStatus).toBe("Available");
    expect(NY().filter((o) => o.raw.portalStatus === "Available").length).toBe(15);
    expect(
      NY().filter((o) => o.raw.portalStatus === "Advertised Only - Not in SFS").length,
    ).toBe(7);
    expect(NY().every((o) => o.raw.portalStatusDeclaresClosed === false)).toBe(true);
    expect(NY().every((o) => o.raw.portalStatusDeclaresOngoing === false)).toBe(true);
    expect(NY().every((o) => o.raw.eventId.length > 0)).toBe(true);
    // Every record states the handshake it was read through, honestly.
    expect(NY().every((o) => o.raw.publicSessionOnly === true)).toBe(true);
    expect(NY().every((o) => o.raw.credentialsNeverSent === true)).toBe(true);
    expect(NY().every((o) => o.raw.oneSourceNeverStatewideCoverage === true)).toBe(true);
  });

  test("the corpus really is the portal's own page", () => {
    const text = payload();
    expect(text).toContain(NEW_YORK_LISTING_MARKER);
    expect(text).toContain("New York Statewide Fatherhood Engagement");
    expect(text).toContain("esupplier.sfs.ny.gov");
    expect(text).not.toContain("forecast");
  });

  test("deterministic: the same bytes parse to the same records, twice", () => {
    const first = JSON.stringify(NY());
    const second = JSON.stringify(NY());
    expect(second).toBe(first);
    // A later clock expires every published Due Date — but never a date.
    const later = NY(new Date("2031-01-01T12:00:00Z"));
    expect(later.map((o) => o.closeDate)).toEqual(NY().map((o) => o.closeDate));
    expect(later.filter((o) => o.status === "open").length).toBe(0);
    expect(later.filter((o) => o.status === "closed").length).toBe(22);
  });

  test("a payload that is not the portal's grid fails loudly", () => {
    expect(() => parseGrantOpportunities(newYorkConnector, "<html>hi</html>", NOW)).toThrow(
      /does not come from New York State Grant Opportunity Portal/,
    );
    // The marker without any grid row is a changed portal, not an empty listing.
    expect(() =>
      parseGrantOpportunities(newYorkConnector, `<html>${NEW_YORK_LISTING_MARKER}</html>`, NOW),
    ).toThrow();
    // A grid that declares more rows than it renders is refused, not truncated:
    // the portal's own row count is the cross-check.
    const lying = payload().replace("0,22,0,0,1", "0,23,0,0,1");
    expect(lying).not.toBe(payload());
    expect(() => parseGrantOpportunities(newYorkConnector, lying, NOW)).toThrow(
      /declares 23 rows but only 22/,
    );
  });
});
