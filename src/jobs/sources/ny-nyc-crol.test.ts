import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";
import { fetchNycCrolBids, nycAgency, nycCrolUrl, nycDeadline, parseNycCrol } from "./ny-nyc-crol";

// Rows as the open dataset returned them on 2026-11-16 (read by a GitHub Actions job), trimmed to
// the columns this source selects. Contact columns are never requested.
const CAPTURE = [
  { request_id: "20260922020", start_date: "2026-09-29T00:00:00.000", agency_name: "Environmental Protection", short_title: "82626B0065-BEDC - CSO-GC-SFS-OH-CP3 Construction of CSO Facilities for Gowanus Canal", category_description: "Construction/Construction Services", selection_method_description: "Competitive Sealed Bids", pin: "82626B0065", due_date: "2026-11-17T10:00:00.000", additional_description_1: "<p>Construction of the CSO facility superstructure, reconstruction/abandonment of impacted conveyance, and construction of public amenities.</p>" },
  { request_id: "20261027032", start_date: "2026-11-02T00:00:00.000", agency_name: "Housing Authority", short_title: "SMD_MATERIAL JANITORIAL CLEANING PRODUCTS, FIVE BOROUGHS OF NEW YORK CITY", category_description: "Goods", selection_method_description: "Competitive Sealed Bids", due_date: "2026-11-20T12:00:00.000", additional_description_1: "The materials to be provided by the successful vendor are described in greater detail in the RFQ." },
  { request_id: "20260625055", start_date: "2026-07-01T00:00:00.000", agency_name: "NYC Health + Hospitals", short_title: "Elmhurst Hospital, Entryway Renovation", category_description: "Construction/Construction Services", selection_method_description: "Competitive Sealed Bids", pin: "ELM-2026-11", due_date: "2026-10-20T11:00:00.000" },
  { request_id: "20261101007", start_date: "2026-11-05T00:00:00.000", agency_name: "NYC Health + Hospitals", short_title: "Bid Extension: Elmhurst Hospital, Entryway Renovation", category_description: "Construction/Construction Services", selection_method_description: "Competitive Sealed Bids", pin: "ELM-2026-11", due_date: "2026-11-18T11:00:00.000" },
  { request_id: "20261009019", agency_name: "Citywide Administrative Services", short_title: "85727B0030-Auto Body and Chassis Repair Services for Queens East (RE-AD)", pin: "85727B0030", due_date: "2026-11-16T14:00:00.000" },
  { request_id: "20261010001", agency_name: "Parks and Recreation", short_title: "Tree Pruning Services, Staten Island", pin: "84627B0001", due_date: "9999-09-19T16:00:00.000" },
  { request_id: "", agency_name: "Education", short_title: "Untitled", due_date: "2026-12-01T10:00:00.000" },
];
const now = Date.parse("2026-11-17T00:10:00Z"); // 7:10 PM in New York on November 16

describe("New York City, the City Record Online", () => {
  test("open solicitations become bids with the agency, New York time and their own notice page", () => {
    const r = parseNycCrol(CAPTURE, now);
    expect(r.rows.map((b) => b.external_id)).toEqual(["nyc-crol-20260922020", "nyc-crol-20261027032", "nyc-crol-20261101007"]);
    const [dep, nycha, hh] = r.rows;
    expect(dep.agency).toBe("NYC Environmental Protection");
    expect(dep.due_date).toBe("2026-11-17T15:00:00.000Z");
    expect(dep.source_url).toBe("https://a856-cityrecord.nyc.gov/RequestDetail/20260922020");
    expect(dep.location).toBe("New York, NY");
    expect(dep.solicitation_number).toBe("82626B0065");
    expect(dep.description).toContain("Competitive Sealed Bids. Construction/Construction Services. PIN 82626B0065.");
    expect(dep.description).not.toContain("<p>");
    expect(nycha.agency).toBe("NYC Housing Authority");
    expect(nycha.solicitation_number).toBeNull();
    // The extension is the live notice for that PIN; its title loses the "Bid Extension:" prefix.
    expect(hh.agency).toBe("NYC Health + Hospitals");
    expect(hh.title).toBe("Elmhurst Hospital, Entryway Renovation");
    expect(hh.due_date).toBe("2026-11-18T16:00:00.000Z");
  });

  test("closed, placeholder-dated, superseded and unnumbered notices are counted, never stored", () => {
    const r = parseNycCrol(CAPTURE, now);
    expect(r.skipped).toEqual({ closed: 2, no_deadline: 1, no_notice_id: 1 });
    expect(r.rows.length + r.skippedRows.length).toBe(CAPTURE.length);
    const two = parseNycCrol(CAPTURE.slice(2, 4), Date.parse("2026-10-01T00:00:00Z"));
    expect(two.rows.map((b) => b.external_id)).toEqual(["nyc-crol-20261101007"]);
    expect(two.skipped).toEqual({ superseded_notice: 1 });
  });

  test("deadlines are New York wall time, in summer and winter; a date alone closes at day's end", () => {
    expect(nycDeadline("2026-07-01T10:30:00.000")).toBe("2026-07-01T14:30:00.000Z");
    expect(nycDeadline("2026-12-01T10:30:00.000")).toBe("2026-12-01T15:30:00.000Z");
    expect(nycDeadline("2026-12-01T00:00:00.000")).toBe("2026-12-02T04:59:00.000Z");
    expect(nycDeadline("soon")).toBeNull();
    expect(nycAgency("New York City Transit")).toBe("New York City Transit");
    expect(nycAgency("")).toBe("City of New York");
  });

  test("the query asks only for open procurement solicitations and never for contact columns", () => {
    const u = new URL(nycCrolUrl(now, 1000));
    expect(u.origin + u.pathname).toBe("https://data.cityofnewyork.us/resource/dg92-zbpx.json");
    expect(u.searchParams.get("$where")).toBe("section_name='Procurement' AND type_of_notice_description='Solicitation' AND due_date >= '2026-11-16T00:00:00'");
    expect(u.searchParams.get("$offset")).toBe("1000");
    expect(u.searchParams.get("$select")).not.toMatch(/contact|email|phone|fax/);
  });

  test("a failed or malformed answer fails the run instead of reading as an empty board", async () => {
    const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    await expect(fetchNycCrolBids(now, answer(503, {}))).rejects.toThrow();
    await expect(fetchNycCrolBids(now, answer(200, { error: true }))).rejects.toThrow();
    expect((await fetchNycCrolBids(now, answer(200, CAPTURE))).rows).toHaveLength(3);
    expect((await fetchNycCrolBids(now, answer(200, []))).rows).toHaveLength(0);
  });

  test("it is scheduled and known as a New York City source", () => {
    expect(readFileSync("src/jobs/runner.ts", "utf8")).toContain('{ name: "ny_nyc_city_record", fetchFn: () => fetchNycCrolBids() },');
    expect(SOURCE_CLASSES.ny_nyc_city_record).toEqual({ class: "local", city: "New York City", scopeState: "NY", searchScope: "city-open-data", recordType: "opportunity" });
    expect(SOURCE_HOME_JURISDICTIONS.ny_nyc_city_record).toBe("NY");
    expect(LOCAL_AGENCIES.find((a) => a.source === "ny_nyc_city_record")?.name).toBe("City of New York");
    expect(readFileSync("src/jobs/sources/ny-nyc-crol.ts", "utf8")).not.toMatch(/contact_name|contact_phone|\bemail\b,/);
  });
});
