/**
 * California Cal eProcure (`ca_eprocure`) connector pins. Zero network, no
 * database: the fixture is the verbatim PeopleSoft inquiry page captured
 * 2026-10-01 (gzipped; see fixtures/ca-eprocure/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { expandTrade, MAX_EXPANDED_TERMS } from "~/lib/trade-registry";
import { TAIL_SOURCES } from "../runner";
import { caepEndToIso, caepEventUrl, isCaepInquiryPage, parseCaepInquiry } from "./ca-eprocure";

const HTML = gunzipSync(readFileSync(new URL("./fixtures/ca-eprocure/event-inquiry-2026-10-01.html.gz", import.meta.url))).toString("utf8");
const CAPTURED = Date.parse("2026-10-01T15:00:00Z");

describe("ca_eprocure — parse (captured page)", () => {
  test("reads all 354 grid rows; open ones become California bids", () => {
    expect(isCaepInquiryPage(HTML)).toBe(true);
    const { rows, parsed, skipped } = parseCaepInquiry(HTML, CAPTURED);
    expect(parsed.length).toBe(354);
    expect(rows.length + Object.values(skipped).reduce((a, b) => a + b, 0)).toBe(354);
    expect(skipped.not_open ?? 0).toBe(0);
    for (const r of rows) {
      expect(r.location).toBe("California");
      // event ids are free text on Cal eProcure ("32A0738", "5327*001", "B (2026)")
      expect(r.external_id.startsWith(`caeprocure-`)).toBe(true);
      expect(r.source_url).not.toMatch(/\s/);
      expect(r.source_url.startsWith("https://caleprocure.ca.gov/event/")).toBe(true);
      expect(r.agency.length).toBeGreaterThan(0);
      expect(r.description).not.toContain(r.agency);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "ca_eprocure" });
      expect(cols.source_jurisdiction).toBe("CA");
      expect(cols.normalized_state).toBe("CA");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("the Caltrans plumbing IFB maps field by field", () => {
    const { rows } = parseCaepInquiry(HTML, CAPTURED);
    const row = rows.find((r) => r.solicitation_number === "32A0738")!;
    expect(row.agency).toBe("Department of Transportation");
    expect(row.title.startsWith("IFB Install New Plumbing System, Eureka")).toBe(true);
    expect(row.due_date).toBe("2026-10-01T21:00:00.000Z"); // 2:00 PM PDT
    expect(row.source_url).toBe("https://caleprocure.ca.gov/event/2660/32A0738");
    expect(row.notice_type).toBe("RFx");
  });

  test("an agency name never creates a trade match (CHP 'patrol' ≠ security guard)", () => {
    const { rows } = parseCaepInquiry(HTML, CAPTURED);
    const terms = expandTrade("security guard").terms.slice(0, MAX_EXPANDED_TERMS);
    const chp = rows.filter((r) => /highway patrol/i.test(r.agency));
    expect(chp.length).toBeGreaterThan(0);
    for (const r of chp) {
      const text = `${r.title} ${r.description} ${r.category}`.toLowerCase();
      const own = `${r.title} ${r.category}`.toLowerCase();
      // any security-guard hit must come from the bid's own title/category
      expect(terms.some((t) => text.includes(t))).toBe(terms.some((t) => own.includes(t)));
    }
  });

  test("events already ended are skipped", () => {
    const later = Date.parse("2026-10-02T00:00:00Z");
    const { skipped } = parseCaepInquiry(HTML, later);
    expect(skipped.closed).toBeGreaterThan(0);
  });

  test("a page that is not the inquiry grid is rejected", () => {
    expect(isCaepInquiryPage("<html><title>302 Moved Temporarily</title></html>")).toBe(false);
  });
});

describe("ca_eprocure — helpers", () => {
  test("end times honour the stated PDT/PST zone", () => {
    expect(caepEndToIso("10/07/2026  1:00PM PDT")).toBe("2026-10-07T20:00:00.000Z");
    expect(caepEndToIso("12/30/2027  5:00PM PST")).toBe("2027-12-31T01:00:00.000Z");
    expect(caepEndToIso("10/01/2026 10:00AM PDT")).toBe("2026-10-01T17:00:00.000Z");
    expect(caepEndToIso("01/15/2027 12:30AM")).toBe("2027-01-15T08:30:00.000Z"); // no zone → PST in January
    expect(caepEndToIso("07/15/2027")).toBe("2027-07-16T06:59:00.000Z"); // date only → 11:59 PM PDT
    expect(caepEndToIso("not a date")).toBeNull();
  });

  test("event links", () => {
    expect(caepEventUrl("8940", "0000040442")).toBe("https://caleprocure.ca.gov/event/8940/0000040442");
  });
});

describe("ca_eprocure — registration", () => {
  test("registered as a tail sync source, California home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "ca_eprocure")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["ca_eprocure"]).toBe("CA");
    expect(isStateLocalSource(["ca_eprocure"])).toBe(true);
    expect(sourceBadgeLabel("ca_eprocure")).toBe("State (CA)");
  });
});
