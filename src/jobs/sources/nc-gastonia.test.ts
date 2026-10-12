/**
 * Gastonia, NC pins: the City's Bids & RFPs page (`nc_gastonia`, deadlines read
 * from each solicitation PDF) and Gaston County's CivicEngage board
 * (`nc_gaston_county`). Zero network: the page, the PDFs' extracted text and the
 * county board were captured 2026-10-12 (see fixtures/nc-gastonia/README.md).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { gastoniaRow, readGastoniaDeadline, readGastoniaListings } from "./nc-gastonia";
import { parseNcGastonCountyBoard } from "./nc-gaston-county";

const gz = (p: string) => gunzipSync(readFileSync(new URL(p, import.meta.url))).toString("utf8");
const PAGE = gz("./fixtures/nc-gastonia/bids-rfps-2026-10-12.html.gz");
const TEXTS: Record<string, string> = JSON.parse(gz("./fixtures/nc-gastonia/pdf-texts-2026-10-12.json.gz"));
const COUNTY = gz("./fixtures/nc-gaston-county/bids-2026-10-12.html.gz");
const CAPTURED = Date.parse("2026-10-12T12:00:00Z");
const file = (u: string) => u.split("/").pop();

describe("nc_gastonia — captured page", () => {
  test("8 solicitation links; addenda and recordings are not listings", () => {
    const l = readGastoniaListings(PAGE);
    expect(l.length).toBe(8);
    expect(l.some((x) => /addend|recording/i.test(x.title))).toBe(false);
    expect(l.map((x) => x.type)).toEqual(["RFP", "RFP", "RFP", "RFP", "RFP", "ITB", "RFQ", "RFQ"]);
    expect(l[0]!.title).toBe("Linwood Park Dredging and Pond Restoration");
  });

  test("each PDF's deadline is read as the City wrote it (Eastern time)", () => {
    const got = Object.fromEntries(readGastoniaListings(PAGE).map((l) => [file(l.url), readGastoniaDeadline(TEXTS[l.url]!)?.iso ?? null]));
    expect(got).toEqual({
      "LinwoodDredgingRFP.pdf": "2026-10-16T18:00:00.000Z", // "Proposal Due by 2:00 PM October 16, 2026"
      "RFP-Cold_Weather_Shelter-Timeline_Extension_FINAL.pdf": "2026-10-09T20:00:00.000Z",
      "RFP-Cold_Weather_Shelter-FINAL_Draft.pdf": "2026-10-02T20:00:00.000Z",
      "MarthaRiversPlaygroundRFP.pdf": "2026-10-02T18:00:00.000Z",
      "RFP-Gastonia_IFA_FY_2027.pdf": "2026-10-28T19:00:00.000Z", // "no later than 3:00PM EST, Wednesday, October 28, 2026"
      "Garland_Center_Chiller_Invitation_to_Bid.pdf": null, // no readable deadline → skipped, never invented
      "RFQ_-_Broker_3-13-2026_V1.pdf": "2026-03-25T19:00:00.000Z", // not the "DATE: MARCH 13, 2026" issue date
      "2026-Transfer_Station_RFQ.pdf": "2026-10-05T21:00:00.000Z",
    });
  });

  test("2 open on Oct 12: Linwood Park dredging and equipment installation financing", () => {
    const results = readGastoniaListings(PAGE).map((l) => gastoniaRow(l, TEXTS[l.url]!, CAPTURED));
    const rows = results.flatMap((r) => ("row" in r ? [r.row] : []));
    const skips = results.flatMap((r) => ("skip" in r ? [r.skip] : []));
    expect(rows.map((r) => r.title)).toEqual(["Linwood Park Dredging and Pond Restoration", "Equipment Installation Financing"]);
    expect(skips.sort()).toEqual(["closed", "closed", "closed", "closed", "closed", "no_deadline"]);
    const r = rows[0]!;
    expect(r.external_id).toBe("gastonia-linwooddredgingrfp");
    expect(r.agency).toBe("City of Gastonia");
    expect(r.location).toBe("Gastonia, NC");
    expect(r.notice_type).toBe("RFP");
    expect(r.source_url).toBe("https://gastonianc.gov/images/BidsRFQ/LinwoodDredgingRFP.pdf");
    expect(r.description).toContain('"Proposal Due by 2:00 PM October 16, 2026');
    expect(r.set_aside).toBeNull();
  });

  test("an unreadable PDF is skipped, not listed", () => {
    expect(gastoniaRow({ title: "X", type: "RFP", url: "https://gastonianc.gov/images/x.pdf" }, null, CAPTURED)).toEqual({ skip: "pdf_unreadable" });
  });

  test("date-only deadline → 11:59 PM Eastern; questions deadlines are not the deadline", () => {
    expect(readGastoniaDeadline("Bids are due December 3, 2026 at the City Warehouse")!.iso).toBe("2026-12-04T04:59:00.000Z");
    expect(readGastoniaDeadline("Deadline for Written Questions October 20, 2026 4 pm. Submission Deadline October 30, 2026, 2 pm")!.iso).toBe(
      "2026-10-30T18:00:00.000Z",
    );
    expect(readGastoniaDeadline("No dates here at all")).toBeNull();
  });

  test("rows land in North Carolina", () => {
    const l = readGastoniaListings(PAGE)[0]!;
    const r = gastoniaRow(l, TEXTS[l.url]!, CAPTURED);
    if (!("row" in r)) throw new Error("expected a row");
    const cols = deriveInsertLocationColumns({ location: r.row.location, agency: r.row.agency, title: r.row.title, description: r.row.description, sourceName: "nc_gastonia" });
    expect(cols.normalized_state).toBe("NC");
  });
});

describe("nc_gaston_county — captured board", () => {
  test("the board's 'no open bid postings' page is an honest empty, not an error", () => {
    expect(COUNTY).toContain("There are no open bid postings at this time.");
    const r = parseNcGastonCountyBoard(COUNTY, CAPTURED);
    expect(r.rows.length).toBe(0);
  });
});

describe("Gastonia — registration", () => {
  test("both are tail sync sources with a North Carolina home jurisdiction", () => {
    for (const name of ["nc_gastonia", "nc_gaston_county"]) {
      expect(TAIL_SOURCES.some((s) => s.name === name)).toBe(true);
      expect(SOURCE_HOME_JURISDICTIONS[name]).toBe("NC");
      expect(isStateLocalSource([name])).toBe(true);
    }
  });
});
