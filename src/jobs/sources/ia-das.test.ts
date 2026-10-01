/**
 * Iowa Bid Opportunities (`ia_das`) connector pins. Zero network, no
 * database: the fixture is the listing's verbatim JSON captured 2026-10-01
 * (see fixtures/ia-das/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { iaAgencyName, iaDateToIso, parseIaDasList, type IaDasList } from "./ia-das";

const LIST = JSON.parse(readFileSync(new URL("./fixtures/ia-das/open-bids-2026-10-01.json", import.meta.url), "utf8")) as IaDasList;
const CAPTURED = Date.parse("2026-10-01T22:40:00Z");

describe("ia_das — parse (captured listing)", () => {
  test("all 51 open bids become Iowa bids", () => {
    expect(LIST.iTotalRecords).toBe(51);
    const { rows, skipped } = parseIaDasList(LIST, CAPTURED);
    expect(skipped).toEqual({});
    expect(rows.length).toBe(51);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^iadas-[0-9a-f-]{36}$/);
      expect(r.source_url).toBe(`https://bidopportunities.iowa.gov/Home/BidInfo?bidId=${r.external_id.slice(6)}`);
      expect(r.location).toBe("Iowa");
      expect(r.description.toLowerCase()).not.toContain(r.agency.toLowerCase());
      expect(r.description).not.toMatch(/\w@\w/); // no contact emails
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "ia_das" });
      expect(cols.source_jurisdiction).toBe("IA");
      expect(cols.normalized_state).toBe("IA");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("the benefits consultant RFP maps field by field", () => {
    const row = parseIaDasList(LIST, CAPTURED).rows.find((r) => r.solicitation_number === "005-RFP-3086-2027")!;
    expect(row.title).toBe("Employee Benefits Consultant Services");
    expect(row.agency).toBe("Department of Administrative Services");
    expect(row.due_date).toBe("2026-10-20T19:00:00.000Z"); // the bid page: "10/20/2026 2:00:00 PM" Central
    expect(row.description).toContain("Keywords: benefits, actuarial.");
  });

  test("closed and inactive rows are skipped", () => {
    const later = parseIaDasList(LIST, Date.parse("2026-10-21T00:00:00Z"));
    expect(later.skipped.closed).toBeGreaterThan(0);
    expect(later.rows.length + later.skipped.closed!).toBe(51);
    const row = LIST.aaData![0]!;
    expect(parseIaDasList({ aaData: [{ ...row, Status: "Closed" }] }, CAPTURED).skipped).toEqual({ not_open: 1 });
    expect(parseIaDasList({ aaData: [{ ...row, IsActive: false }] }, CAPTURED).skipped).toEqual({ not_open: 1 });
  });

  test("helpers", () => {
    expect(iaDateToIso("/Date(1792522800000)/")).toBe("2026-10-20T19:00:00.000Z");
    expect(iaDateToIso("2026-10-20")).toBeNull();
    expect(iaAgencyName("Natural Resources, Dept Of")).toBe("Department of Natural Resources");
    expect(iaAgencyName("Administrative Services, Dept")).toBe("Department of Administrative Services");
    expect(iaAgencyName("Transportation")).toBe("Transportation");
  });
});

describe("ia_das — registration", () => {
  test("registered as a tail sync source, Iowa home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "ia_das")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["ia_das"]).toBe("IA");
    expect(isStateLocalSource(["ia_das"])).toBe(true);
    expect(sourceBadgeLabel("ia_das")).toBe("State (IA)");
  });
});
