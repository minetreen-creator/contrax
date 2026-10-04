/**
 * Washington WEBS (`wa_webs`) connector pins. Zero network, no database: the
 * fixtures are calendar pages captured 2026-10-04 (gzipped, viewstate
 * stripped; see fixtures/wa-webs/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import {
  parseWaListings,
  parseWaPages,
  waAgencyName,
  waBidIds,
  waCloseMs,
  waHiddenFields,
  waOrganizations,
  waPagerLinks,
  waSelectedOrganization,
} from "./wa-webs";

const load = (name: string) =>
  gunzipSync(readFileSync(new URL(`./fixtures/wa-webs/${name}`, import.meta.url))).toString("utf8");
const ALL = [0, 1, 2, 3, 4, 5].map((i) => load(`all-page${i}-2026-10-04.html.gz`));
const WSDOT = load("org-16-wsdot-2026-10-04.html.gz");
const DES = [0, 1].map((i) => load(`org-3512-des-page${i}-2026-10-04.html.gz`));
const CAPTURED = Date.parse("2026-10-04T19:00:00Z");

function agencyMap(): Map<string, string> {
  const m = new Map<string, string>();
  for (const id of waBidIds(WSDOT)) m.set(id, "Transportation, Dept of");
  for (const page of DES) for (const id of waBidIds(page)) m.set(id, "Enterprise Services (DES), Dept. of");
  return m;
}

describe("wa_webs — parse (captured pages)", () => {
  test("127 listed on 6 pages; the 2 Selective bids are skipped", () => {
    const listings = ALL.flatMap(parseWaListings);
    expect(listings.length).toBe(127);
    expect(new Set(listings.map((l) => l.id)).size).toBe(127);
    const { rows, skipped } = parseWaPages(ALL, agencyMap(), CAPTURED);
    expect(skipped).toEqual({ selective: 2 });
    expect(rows.length).toBe(125);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^wawebs-\d+$/);
      expect(r.location).toBe("Washington");
      expect(Date.parse(r.due_date!)).toBeGreaterThan(CAPTURED);
      expect(r.source_url).toBe("https://pr-webs-vendor.des.wa.gov/BidCalendar.aspx");
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "wa_webs" });
      expect(cols.source_jurisdiction).toBe("WA");
      expect(cols.normalized_state).toBe("WA");
    }
  });

  test("a row reads as the calendar shows it", () => {
    const l = parseWaListings(ALL[0])[0];
    expect(l).toMatchObject({
      id: "57521",
      title: "WA OpenProfTech Project Phase 2",
      ref: "2026-RFP-002",
      closeDate: "10/05/26",
      amendmentDate: "09/21/26",
      selective: false,
      preBid: "09/17/26 10:30",
      questionsDue: "09/28/26",
      contact: "Abraham Rocha",
    });
    expect(l.text.startsWith("The Open ProfTech project, Phase 2")).toBe(true);
    expect(l.text).not.toContain("Ref#");
    const r = parseWaPages(ALL, agencyMap(), CAPTURED).rows.find((x) => x.external_id === "wawebs-57521")!;
    expect(r.solicitation_number).toBe("2026-RFP-002");
    expect(r.due_date).toBe("2026-10-06T06:59:00.000Z"); // 11:59 PM PDT on 10/05
    expect(r.agency).toBe("State of Washington (WEBS)"); // not in the fixture map
  });

  test("agency comes from the organization filter that lists the bid", () => {
    const rows = parseWaPages(ALL, agencyMap(), CAPTURED).rows;
    const byAgency = (a: string) => rows.filter((r) => r.agency === a).length;
    // WSDOT lists 5; one is marked Selective and skipped.
    expect(byAgency("Department of Transportation")).toBe(4);
    expect(parseWaListings(WSDOT).filter((l) => l.selective).length).toBe(1);
    expect(byAgency("Department of Enterprise Services (DES)")).toBe(36);
  });

  test("organization filter, pager and hidden fields", () => {
    expect(waSelectedOrganization(ALL[0])).toBe("0");
    expect(waSelectedOrganization(WSDOT)).toBe("16");
    expect(waSelectedOrganization(DES[1])).toBe("3512");
    expect(waBidIds(WSDOT).length).toBe(5);
    expect(waPagerLinks(ALL[0])).toMatchObject({ "2": "DataGrid1$_ctl29$_ctl1", "6": "DataGrid1$_ctl29$_ctl5" });
    expect(waPagerLinks(DES[0])).toEqual({ "2": "DataGrid1$_ctl29$_ctl1" });
    const orgs = waOrganizations(ALL[0]);
    expect(orgs.length).toBe(42);
    expect(orgs).toContainEqual({ value: "3512", name: "Enterprise Services (DES), Dept. of" });
    expect(waHiddenFields(ALL[0]).map(([k]) => k)).toEqual(["__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION"]);
  });

  test("agency names read naturally", () => {
    expect(waAgencyName("Labor & Industries, Department of")).toBe("Department of Labor & Industries");
    expect(waAgencyName("Transportation, Dept of")).toBe("Department of Transportation");
    expect(waAgencyName("Commerce, Dept. of")).toBe("Department of Commerce");
    expect(waAgencyName("Courts, Administrative Office of the")).toBe("Administrative Office of the Courts");
    expect(waAgencyName("Community and Technical Colleges, State Board for")).toBe("State Board for Community and Technical Colleges");
    expect(waAgencyName("Parks & Recreation Commission, State")).toBe("State Parks & Recreation Commission");
    expect(waAgencyName("State Patrol, Washington")).toBe("Washington State Patrol");
    expect(waAgencyName("Seattle Housing Authority")).toBe("Seattle Housing Authority");
  });

  test("close dates are 11:59 PM Pacific (DST-aware)", () => {
    expect(waCloseMs("10/05/26")).toBe(Date.parse("2026-10-05T23:59:00-07:00"));
    expect(waCloseMs("12/03/26")).toBe(Date.parse("2026-12-03T23:59:00-08:00"));
    expect(waCloseMs("07/31/35")).toBe(Date.parse("2035-07-31T23:59:00-07:00"));
    expect(waCloseMs("TBD")).toBeNaN();
  });

  test("a passed close date is skipped", () => {
    const later = Date.parse("2026-10-07T00:00:00Z");
    const { skipped } = parseWaPages([ALL[0]], new Map(), later);
    expect(skipped.closed ?? 0).toBeGreaterThan(0);
  });

  test("registered as a Washington state source", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "wa_webs")).toBe(true);
    expect(SOURCE_CLASSES.wa_webs?.scopeState).toBe("WA");
  });
});
