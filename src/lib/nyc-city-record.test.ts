import { describe, expect, test } from "bun:test";
import { CITY_SOURCES, cityProcurementDeps } from "./city-procurement";
import { newestPerPin, nycAgency, nycCrolQuery, nycDeadline, nycTitle } from "./nyc-city-record";

// Rows as NYC Open Data returned them on 2026-11-16 (read by a GitHub Actions job), trimmed to the
// columns this source asks for. The Elmhurst pair shows an extension of an earlier notice.
const CAPTURE = [
  { request_id: "20261101007", agency_name: "NYC Health + Hospitals", short_title: "Bid Extension: Elmhurst Hospital, Entryway Renovation", category_description: "Construction/Construction Services", selection_method_description: "Competitive Sealed Bids", type_of_notice_description: "Solicitation", pin: "ELM-2026-11", due_date: "2026-12-18T11:00:00.000" },
  { request_id: "20261027032", agency_name: "Housing Authority", short_title: "SMD_MATERIAL JANITORIAL CLEANING PRODUCTS, FIVE BOROUGHS OF NEW YORK CITY", category_description: "Goods", type_of_notice_description: "Solicitation", due_date: "2026-12-20T12:00:00.000", additional_description_1: "<p>The materials to be provided are described in the RFQ.</p>" },
  { request_id: "20260922020", agency_name: "Environmental Protection", short_title: "82626B0065-BEDC - CSO-GC-SFS-OH-CP3 Construction of CSO Facilities for Gowanus Canal", type_of_notice_description: "Solicitation", pin: "82626B0065", due_date: "2026-12-17T10:00:00.000" },
  { request_id: "20260625055", agency_name: "NYC Health + Hospitals", short_title: "Elmhurst Hospital, Entryway Renovation", type_of_notice_description: "Solicitation", pin: "ELM-2026-11", due_date: "2026-11-30T11:00:00.000" },
];

describe("New York City, the City Record (owner 2026-11-16)", () => {
  const nyc = CITY_SOURCES.find((s) => s.name === "nyc_open_data")!;

  test("the source asks for open procurement solicitations, newest first, and never for contact columns", async () => {
    const saved = { ...cityProcurementDeps };
    const urls: string[] = [];
    cityProcurementDeps.fetch = async (url: string) => { urls.push(url); return new Response(JSON.stringify(CAPTURE), { status: 200 }); };
    try {
      const rows = await nyc.fetch();
      const u = new URL(urls[0]);
      expect(u.origin + u.pathname).toBe("https://data.cityofnewyork.us/resource/dg92-zbpx.json");
      expect(u.searchParams.get("$where")).toContain("section_name='Procurement' AND type_of_notice_description='Solicitation' AND due_date >= '");
      expect(u.searchParams.get("$order")).toBe("request_id DESC");
      expect(u.searchParams.get("$limit")).toBe("100");
      expect(u.searchParams.get("$select")).not.toMatch(/contact|email|phone|fax/);
      // One row per solicitation: the extension replaces the notice it extends.
      expect(rows.map((r) => r.external_id).sort()).toEqual(["nyc-20260922020", "nyc-20261027032", "nyc-20261101007"]);
      const hh = rows.find((r) => r.external_id === "nyc-20261101007")!;
      expect(hh.title).toBe("Elmhurst Hospital, Entryway Renovation");
      expect(hh.agency).toBe("NYC Health + Hospitals");
      expect(hh.due_date).toBe("2026-12-18T16:00:00.000Z");
      expect(hh.source_url).toBe("https://a856-cityrecord.nyc.gov/RequestDetail/20261101007");
      const nycha = rows.find((r) => r.external_id === "nyc-20261027032")!;
      expect(nycha.agency).toBe("NYC Housing Authority");
      expect(nycha.location).toBe("New York, NY");
      expect(nycha.description).not.toContain("<p>");
    } finally {
      Object.assign(cityProcurementDeps, saved);
    }
    expect(nyc.maxPages).toBe(10);
  });

  test("the query's dates are New York wall time and leave out placeholder years", () => {
    // 03:30 UTC on the 17th is still the evening of the 16th in New York.
    expect(nycCrolQuery(Date.parse("2026-11-17T03:30:00Z")).$where).toBe("section_name='Procurement' AND type_of_notice_description='Solicitation' AND due_date >= '2026-11-16T00:00:00' AND due_date < '2029-01-01T00:00:00'");
  });

  test("deadlines are New York time in summer and winter; a date alone closes at day's end", () => {
    expect(nycDeadline("2026-07-01T10:30:00.000")).toBe("2026-07-01T14:30:00.000Z");
    expect(nycDeadline("2026-12-01T10:30:00.000")).toBe("2026-12-01T15:30:00.000Z");
    expect(nycDeadline("2026-12-01T00:00:00.000")).toBe("2026-12-02T04:59:00.000Z");
    expect(nycDeadline("soon")).toBeNull();
    expect(nycDeadline(null)).toBeNull();
  });

  test("agency and title read as a bidder would say them", () => {
    expect(nycAgency("Housing Authority")).toBe("NYC Housing Authority");
    expect(nycAgency("NYC Health + Hospitals")).toBe("NYC Health + Hospitals");
    expect(nycAgency("New York City Transit")).toBe("New York City Transit");
    expect(nycAgency("")).toBe("City of New York");
    expect(nycTitle("Bid Extension: Correction: Stump Grinder - PARKS")).toBe("Stump Grinder - PARKS");
    expect(nycTitle("Correction:")).toBe("Correction:");
  });

  test("rows with no PIN are all kept", () => {
    const row = (id: string, pin: string | null) => ({ external_id: id, solicitation_number: pin }) as never;
    expect(newestPerPin([row("nyc-3", null), row("nyc-2", "A"), row("nyc-1", "a"), row("nyc-4", null)]).map((r) => r.external_id)).toEqual(["nyc-3", "nyc-4", "nyc-2"]);
  });
});
