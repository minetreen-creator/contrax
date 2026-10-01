/**
 * Georgia Procurement Registry (`ga_gpr`) connector pins. Zero network, no
 * database: the fixture is the registry's own open-event JSON captured
 * 2026-10-01 (gzipped; see fixtures/ga-gpr/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { gprEventUrl, gprSearchBody, parseGprEvents, type GprEvent } from "./ga-gpr";

const BODY = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/ga-gpr/open-events-2026-10-01.json.gz", import.meta.url))).toString("utf8"),
);
const EVENTS = BODY.data as GprEvent[];
const CAPTURED = Date.parse("2026-10-01T16:00:00Z");

describe("ga_gpr — parse (captured events)", () => {
  test("reads all 503 open events; they become Georgia bids", () => {
    expect(BODY.recordsTotal).toBe(503);
    expect(EVENTS.length).toBe(503);
    const { rows, skipped } = parseGprEvents(EVENTS, CAPTURED);
    expect(rows.length + Object.values(skipped).reduce((a, b) => a + b, 0)).toBe(503);
    expect(rows.length).toBeGreaterThan(490);
    for (const r of rows) {
      expect(r.location).toBe("Georgia");
      expect(r.external_id.startsWith("gpr-")).toBe(true);
      expect(r.source_url.startsWith("https://ssl.doas.state.ga.us/gpr/eventDetails?eSourceNumber=")).toBe(true);
      expect(r.description).not.toContain(r.agency);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "ga_gpr" });
      expect(cols.source_jurisdiction).toBe("GA");
      expect(cols.normalized_state).toBe("GA");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("the Bartow County Schools IFB maps field by field", () => {
    const { rows } = parseGprEvents(EVENTS, CAPTURED);
    const row = rows.find((r) => r.solicitation_number === "PE-55391-NONST-2027-000000034")!;
    expect(row.title).toBe("School Nutrition Program Paper Goods & Supplies IFB 2027-03");
    expect(row.agency).toBe("Bartow County Schools");
    expect(row.due_date).toBe("2026-10-02T12:00:00.000Z"); // 8:00 AM EDT
    expect(row.notice_type).toBe("Non-State Agency");
    expect(row.description).toContain("Georgia school system");
    expect(row.source_url).toBe(gprEventUrl("gpr20", "PE-55391-NONST-2027-000000034"));
  });

  test("sole-source and notice events, non-open and closed events are skipped", () => {
    const base: GprEvent = { sourceId: "gpr20", esourceNumberKey: "K-1", esourceNumber: "K-1", title: "Road salt", agencyName: "City of X", status: "Open", closingDateSort: Date.parse("2026-10-20T16:00:00Z") };
    const { rows, skipped } = parseGprEvents(
      [
        base,
        { ...base, esourceNumberKey: "K-2", soleSource: true },
        { ...base, esourceNumberKey: "K-3", title: "Notice of Intent to Award - Fleet fuel" },
        { ...base, esourceNumberKey: "K-4", status: "CLOSED" },
        { ...base, esourceNumberKey: "K-5", closingDateSort: Date.parse("2026-09-01T16:00:00Z") },
      ],
      CAPTURED,
    );
    expect(rows.map((r) => r.solicitation_number)).toEqual(["K-1"]);
    expect(skipped).toEqual({ notice_not_bid: 2, not_open: 1, closed: 1 });
  });
});

describe("ga_gpr — helpers", () => {
  test("the search asks for every OPEN event in one page", () => {
    const body = gprSearchBody();
    expect(body.get("eventStatus")).toBe("OPEN");
    expect(body.get("length")).toBe("2000");
    expect(body.get("start")).toBe("0");
  });

  test("event links are encoded", () => {
    expect(gprEventUrl("jag", "A B/1")).toBe("https://ssl.doas.state.ga.us/gpr/eventDetails?eSourceNumber=A%20B%2F1&sourceSystemType=jag");
  });
});

describe("ga_gpr — registration", () => {
  test("registered as a tail sync source, Georgia home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "ga_gpr")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["ga_gpr"]).toBe("GA");
    expect(isStateLocalSource(["ga_gpr"])).toBe(true);
    expect(sourceBadgeLabel("ga_gpr")).toBe("State (GA)");
  });
});
