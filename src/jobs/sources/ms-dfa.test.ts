/**
 * Mississippi procurement search (`ms_dfa`) connector pins. Zero network, no
 * database: the fixture is the verbatim BidData JSON captured 2026-10-05
 * (gzipped; see fixtures/ms-dfa/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import {
  isNonCompetitiveMsNotice,
  msAgencyName,
  msAttachmentSubject,
  msDueMs,
  msLocalEntity,
  msNoticeTitle,
  msRequestBody,
  msSubject,
  parseMsBids,
  type MsBid,
} from "./ms-dfa";

const BODY = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/ms-dfa/open-bids-2026-10-05.json.gz", import.meta.url))).toString("utf8"),
);
const ITEMS: MsBid[] = BODY.aaData;
const CAPTURED = Date.parse("2026-10-05T20:00:00Z");

describe("ms_dfa — parse (captured response)", () => {
  test("140 listed; 14 sole-source / intent-to-award notices skipped; the rest accepted", () => {
    expect(ITEMS.length).toBe(140);
    expect(BODY.iTotalRecords).toBe(140);
    const { rows, skipped } = parseMsBids(ITEMS, CAPTURED);
    expect(skipped).toEqual({ not_competitive: 14 });
    expect(rows.length).toBe(126);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^msdfa-\d+$/);
      expect(r.location).toBe("Mississippi");
      expect(Date.parse(r.due_date!)).toBeGreaterThan(CAPTURED);
      expect(r.source_url).toMatch(/^https:\/\/www\.ms\.gov\/dfa\/contract_bid_search\/Bid\/Details\/\d+\?AppId=1$/);
      expect(r.title.length).toBeGreaterThan(5);
      expect(r.title.length).toBeLessThanOrEqual(141);
      expect(r.agency).not.toMatch(/^(MPTAP|MS |Given|By |Received)\b/);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "ms_dfa" });
      expect(cols.source_jurisdiction).toBe("MS");
      expect(cols.normalized_state).toBe("MS");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("an MPTAP legal notice reads as the notice says", () => {
    const r = parseMsBids(ITEMS, CAPTURED).rows.find((x) => x.external_id === "msdfa-46700")!;
    expect(r.title).toBe("East Bank Port Pad Site Preparation at the Lowndes County East Bank Port Facility");
    expect(r.agency).toBe("Lowndes County Port Authority");
    expect(r.solicitation_number).toBe("60-20260904134656 LCPA");
    expect(r.notice_type).toBe("MDA - RFx");
    // SubmissionDate is midnight Central (CDT) on Oct 13; SubmissionTime 14:00 → 2:00 PM CDT.
    expect(r.due_date).toBe("2026-10-13T19:00:00.000Z");
  });

  test("a state agency record keeps its own text; blank Agency is named from the buyer's domain", () => {
    const r = parseMsBids(ITEMS, CAPTURED).rows.find((x) => x.external_id === "msdfa-46305")!;
    expect(r.agency).toBe("Mississippi Dept of Information Technology Services");
    expect(r.title.startsWith("RFP 3849: to enhance the vendor pool")).toBe(true);
    expect(r.solicitation_number).toBe("1601-27-R-RFPR-00001");
  });

  test("a passed submission date or other status is never accepted", () => {
    const base = ITEMS.find((b) => String(b.BidID) === "46700")!;
    expect(parseMsBids([{ ...base, SubmissionDate: "/Date(1790830800000)/" }], CAPTURED).skipped).toEqual({ closed: 1 });
    expect(parseMsBids([{ ...base, BidStatus: "Awarded" }], CAPTURED).skipped).toEqual({ not_open: 1 });
    expect(parseMsBids([{ ...base, SubmissionDate: null }], CAPTURED).skipped).toEqual({ bad_date: 1 });
    expect(parseMsBids([base, base], CAPTURED).skipped).toEqual({ duplicate: 1 });
  });
});

describe("ms_dfa — helpers", () => {
  test("due date and request body", () => {
    expect(msDueMs("/Date(1791867600000)/", "14:00:00")).toBe(Date.parse("2026-10-13T19:00:00Z"));
    expect(msDueMs("soon", "14:00:00")).toBeNaN();
    const body = new URLSearchParams(msRequestBody());
    expect(body.get("iDisplayLength")).toBe("9999");
    expect(body.get("mDataProp_8")).toBe("BidID");
  });

  test("agency names", () => {
    expect(msAgencyName({ Agency: "MS DEPT OF HEALTH", BidNumber: "x", BuyerEmail: null })).toBe("Mississippi Dept of Health");
    expect(msAgencyName({ Agency: "MS DEPT ENVIRONMENTAL QUALITY", BidNumber: "x", BuyerEmail: null })).toBe("Mississippi Dept of Environmental Quality");
    expect(msAgencyName({ Agency: "", BidNumber: "x", BuyerEmail: "a@DFA.MS.GOV" })).toBe("Mississippi Dept of Finance and Administration");
    expect(msAgencyName({ Agency: "MPTAP", BidNumber: "2-20260928082807 MSU", BuyerEmail: null })).toBe("Mississippi State University");
    expect(msAgencyName({ Agency: "MPTAP", BidNumber: "57-1 Grenda", BuyerEmail: null, BidDescription: "Hello." })).toBe("Grenada");
    expect(msAgencyName({ Agency: "MPTAP", BidNumber: "1-1 XYZQ", BuyerEmail: null, BidDescription: "Bids are due." })).toBe("Mississippi public entity (XYZQ)");
    expect(msLocalEntity("Sealed bids will be received by the Board of Supervisors of Pike County, Mississippi at")).toBe("Pike County");
    expect(msLocalEntity("The NESHOBA COUNTY BOARD OF SUPERVISORS will receive sealed bids")).toBe("Neshoba County");
    expect(msLocalEntity("NOTICE is hereby given that the Harmony Water Association will receive")).toBe("Harmony Water Association");
    expect(msLocalEntity("SEALED proposals will be received by the TOWN OF BRAXTON at the office")).toBe("Town of Braxton");
    expect(msLocalEntity("Bids are due Friday.")).toBeNull();
  });

  test("titles come from the notice's own words", () => {
    expect(msSubject("Sealed or electronic bids for the construction of INDUSTRIAL ROAD DRAINAGE IMPROVEMENTS will be received by the City")).toBe(
      "Construction of INDUSTRIAL ROAD DRAINAGE IMPROVEMENTS",
    );
    expect(msSubject("accepting proposals for the following project: WASTE TIRE REMOVAL Electronic or sealed Proposals will")).toBe("Waste Tire Removal");
    expect(msSubject("Sealed bids for the purchase of the following, will be received in the Office")).toBeNull();
    expect(msNoticeTitle("Sealed bids will be received by the Board of Supervisors of Pike County at the Courthouse", "Pike County", "CONSTRUCTION")).toBe(
      "Pike County construction bid notice",
    );
    expect(msNoticeTitle("A Bid Schedule is attached for your review.", "X", null, [{ Description: "LCIDA - Part 1 Cinco Elevated Tank.pdf" }])).toBe(
      "Part 1 Cinco Elevated Tank",
    );
    expect(msAttachmentSubject("ADVERTISEMENT FOR BIDS.pdf")).toBeNull();
    expect(msAttachmentSubject("Contract Documents_Part1.pdf")).toBeNull();
    expect(msAttachmentSubject("Roy Cumbest Bridge Relocation Advertisement (1).docx - 1.pdf")).toBe("Roy Cumbest Bridge Relocation");
  });

  test("non-competitive notices", () => {
    expect(isNonCompetitiveMsNotice("SOLE SOURCE REQUEST TO PURCHASE The Archer 1200")).toBe(true);
    expect(isNonCompetitiveMsNotice("IFB Intent to Award for Beautification Services")).toBe(true);
    expect(isNonCompetitiveMsNotice("Notice of Intent 1. A description of the commodity")).toBe(true);
    expect(isNonCompetitiveMsNotice("Harmonize is the only discussion tool on the market that integrates")).toBe(true);
    expect(isNonCompetitiveMsNotice("Sealed bids for HVAC replacement")).toBe(false);
  });
});

describe("ms_dfa — registration", () => {
  test("runs in the tail and is a Mississippi state portal", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "ms_dfa")).toBe(true);
    expect(SOURCE_CLASSES.ms_dfa).toEqual({ class: "state", scopeState: "MS", searchScope: "state-portal", recordType: "opportunity" });
  });
});
