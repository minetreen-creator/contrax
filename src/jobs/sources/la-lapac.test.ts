/**
 * Louisiana LaPAC (`la_lapac`) connector pins. Zero network, no database: the
 * fixtures are LaPAC's department list and all 41 department bid pages,
 * captured 2026-10-01 (see fixtures/la-lapac/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import {
  lapacAgencyName,
  lapacDateToIso,
  LAPAC_STATEWIDE_TERM,
  parseLapacDepartment,
  readLapacDepartmentPage,
  readLapacDepartments,
} from "./la-lapac";

const gz = (name: string) => gunzipSync(readFileSync(new URL(`./fixtures/la-lapac/${name}`, import.meta.url))).toString("utf8");
const DEPARTMENTS = readLapacDepartments(gz("departments-2026-10-01.html.gz"));
const PAGES = JSON.parse(gz("department-pages-2026-10-01.json.gz")) as Record<string, string>;
const CAPTURED = Date.parse("2026-10-01T22:45:00Z");

/** Same order and de-duplication as fetchLaLapacBids. */
function parseAll(now: number) {
  const ordered = [
    ...DEPARTMENTS.filter((d) => d.term !== LAPAC_STATEWIDE_TERM),
    ...DEPARTMENTS.filter((d) => d.term === LAPAC_STATEWIDE_TERM),
  ];
  const seen = new Set<string>();
  const rows: ReturnType<typeof parseLapacDepartment>["rows"] = [];
  const skipped: Record<string, number> = {};
  let bids = 0;
  for (const d of ordered) {
    const r = parseLapacDepartment(d.name, PAGES[d.term]!, now);
    bids += r.bids.length;
    for (const row of r.rows) if (!seen.has(row.external_id)) (seen.add(row.external_id), rows.push(row));
    for (const [k, n] of Object.entries(r.skipped)) skipped[k] = (skipped[k] ?? 0) + n;
  }
  return { rows, skipped, bids };
}

describe("la_lapac — department list", () => {
  test("41 departments with bids, the statewide group first", () => {
    expect(DEPARTMENTS.length).toBe(41);
    expect(DEPARTMENTS[0]).toEqual({ term: "1", name: "*** State Procurement ***", count: 81 });
    expect(DEPARTMENTS.find((d) => d.term === "13")).toEqual({ term: "13", name: "+ State - Transportation and Development", count: 12 });
    for (const d of DEPARTMENTS) expect(readLapacDepartmentPage(PAGES[d.term]!).length).toBeGreaterThan(0);
  });

  test("agency names drop LaPAC's list prefixes", () => {
    expect(lapacAgencyName("*** State Procurement ***")).toBe("Office of State Procurement");
    expect(lapacAgencyName("+ State - Transportation and Development")).toBe("Transportation and Development");
    expect(lapacAgencyName("++ University - LSU - Baton Rouge")).toBe("LSU - Baton Rouge");
    expect(lapacAgencyName("+- Comm/Tech College - Delgado Community College")).toBe("Delgado Community College");
    expect(lapacAgencyName("Non State - City of New Orleans")).toBe("City of New Orleans");
    expect(lapacAgencyName("+ State - LDH")).toBe("Louisiana Department of Health");
  });
});

describe("la_lapac — parse (captured pages)", () => {
  test("282 bid rows; open, uncancelled ones become Louisiana bids", () => {
    const { rows, skipped, bids } = parseAll(CAPTURED);
    expect(bids).toBe(282);
    expect(skipped).toEqual({ cancelled: 12, closed: 138 });
    expect(rows.length).toBe(132);
    for (const r of rows) {
      expect(r.external_id).toBe(`lapac-${r.solicitation_number}`);
      expect(r.source_url).toBe(`https://wwwcfprd.doa.louisiana.gov/osp/lapac/dspBid.cfm?search=bidno&term=${encodeURIComponent(r.solicitation_number)}`);
      expect(r.location).toBe("Louisiana");
      expect(r.description.toLowerCase()).not.toContain(r.agency.toLowerCase());
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "la_lapac" });
      expect(cols.source_jurisdiction).toBe("LA");
      expect(cols.normalized_state).toBe("LA");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("a DOTD bid maps field by field; boilerplate attachments are left out", () => {
    const row = parseAll(CAPTURED).rows.find((r) => r.external_id === "lapac-3000026730")!;
    expect(row.title).toBe("DOTD 2WAY YEL. STAND. PAVEMENT MARKERS");
    expect(row.agency).toBe("Transportation and Development");
    expect(row.due_date).toBe("2026-10-14T15:00:00.000Z"); // 10:00 AM CDT
    expect(row.description).toContain("Bid documents include: AML Raised Pavement Markers_09.");
    expect(row.description).not.toContain("Louisiana Preference");
    expect(row.description).not.toContain("Bid Submission Instructions");
  });

  test("cancelled bids are skipped even before their open date", () => {
    const html = PAGES["13"]!;
    const cancelled = readLapacDepartmentPage(html).filter((b) => b.cancelled).map((b) => b.number);
    expect(cancelled).toContain("3000026739");
    const { rows } = parseLapacDepartment("+ State - Transportation and Development", html, Date.parse("2026-08-01T00:00:00Z"));
    expect(rows.map((r) => r.solicitation_number)).not.toContain("3000026739");
  });

  test("Central time: CDT, CST, 11:59 PM; garbage is null", () => {
    expect(lapacDateToIso("10/21/2026 10:00:00 AM CT")).toBe("2026-10-21T15:00:00.000Z");
    expect(lapacDateToIso("12/03/2026 10:00:00 AM CT")).toBe("2026-12-03T16:00:00.000Z");
    expect(lapacDateToIso("10/06/2026 11:59:00 PM CT")).toBe("2026-10-07T04:59:00.000Z");
    expect(lapacDateToIso("TBD")).toBeNull();
  });
});

describe("la_lapac — registration", () => {
  test("registered as a tail sync source, Louisiana home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "la_lapac")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["la_lapac"]).toBe("LA");
    expect(isStateLocalSource(["la_lapac"])).toBe(true);
    expect(sourceBadgeLabel("la_lapac")).toBe("State (LA)");
  });
});
