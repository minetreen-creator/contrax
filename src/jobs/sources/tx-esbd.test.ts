/**
 * Texas ESBD (`tx_esbd`) connector pins. Zero network, no database: the
 * fixtures are ESBD list responses captured 2026-10-01 (see
 * fixtures/tx-esbd/README.md) and `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import {
  esbdAgencyName,
  esbdDetailUrl,
  esbdDueToIso,
  parseEsbdLines,
  type EsbdLine,
  type EsbdResponse,
} from "./tx-esbd";

const fixture = (name: string): EsbdResponse =>
  JSON.parse(readFileSync(new URL(`./fixtures/tx-esbd/${name}`, import.meta.url), "utf8"));
// Just before the capture: the earliest fixture deadline (Oct 1, 3 PM Central) is still open.
const CAPTURED = Date.parse("2026-10-01T15:27:00Z");

describe("tx_esbd — parse (captured fixtures)", () => {
  test("open Posted and Addendum Posted rows become Texas bids with honest fields", () => {
    const lines = [...fixture("posted-page1-2026-10-01.json").lines!, ...fixture("addendum-page1-2026-10-01.json").lines!];
    const { rows, skipped } = parseEsbdLines(lines, CAPTURED);
    expect(rows.length).toBeGreaterThan(30);
    expect(skipped.not_open ?? 0).toBe(0);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^esbd-\d+$/);
      expect(r.location).toBe("Texas");
      expect(r.source_url.startsWith("https://www.txsmartbuy.gov/esbd/")).toBe(true);
      expect(r.solicitation_number).toBeTruthy();
      expect(r.agency).not.toMatch(/ - [A-Z]{0,2}\d[A-Z0-9]*$/);
      expect(r.naics_code).toBeNull();
      expect(r.set_aside).toBeNull();
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "tx_esbd" });
      expect(cols.source_jurisdiction).toBe("TX");
      expect(cols.normalized_state).toBe("TX");
    }
    // the same notice reached by both status filters is kept once
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("the UT Tyler A/E solicitation maps field by field", () => {
    const line = fixture("posted-page1-2026-10-01.json").lines!.find((l) => l.solicitationId === "750-26-27-001")!;
    const [row] = parseEsbdLines([line], CAPTURED).rows;
    expect(row.title).toBe("Architect/Engineer Professional Services");
    expect(row.agency).toBe("University Of Texas At Tyler");
    expect(row.due_date).toBe("2026-10-28T20:00:00.000Z"); // 3:00 PM CDT
    expect(row.notice_type).toBe("Posted");
    expect(row.source_url).toBe("https://www.txsmartbuy.gov/esbd/750-26-27-001");
    expect(row.description).toContain("Commodity codes (NIGP): 90607-Architect Services");
  });

  test("closed, past-due and incomplete rows are skipped with a reason", () => {
    const closed = fixture("closed-page1-2026-10-01.json").lines!;
    const res = parseEsbdLines(closed, CAPTURED);
    expect(res.rows.length).toBe(0);
    expect(res.skipped.not_open).toBe(closed.length);
    const base: EsbdLine = { internalid: "1", title: "Hauling", solicitationId: "X-1", statusName: "Posted", responseDue: "9/30/2026", responseTime: "2:00 PM" };
    expect(parseEsbdLines([base], CAPTURED).skipped).toEqual({ closed: 1 });
    expect(parseEsbdLines([{ ...base, responseDue: "12/1/2026", solicitationId: "" }], CAPTURED).skipped).toEqual({ missing_solicitation_id: 1 });
    expect(parseEsbdLines([{ ...base, responseDue: "12/1/2026", statusName: "New" }], CAPTURED).skipped).toEqual({ not_open: 1 });
  });
});

describe("tx_esbd — helpers", () => {
  test("due date + time are Texas local time, DST-aware", () => {
    expect(esbdDueToIso("10/28/2026", "3:00 PM")).toBe("2026-10-28T20:00:00.000Z"); // CDT, UTC-5
    expect(esbdDueToIso("12/15/2026", "10:00 AM")).toBe("2026-12-15T16:00:00.000Z"); // CST, UTC-6
    expect(esbdDueToIso("10/7/2026", "12:00 PM")).toBe("2026-10-07T17:00:00.000Z");
    expect(esbdDueToIso("10/7/2026", "12:30 AM")).toBe("2026-10-07T05:30:00.000Z");
    expect(esbdDueToIso("10/7/2026", "")).toBe("2026-10-08T04:59:00.000Z"); // 11:59 PM CDT
    expect(esbdDueToIso("", "3:00 PM")).toBeNull();
    expect(esbdDueToIso("13/40/2026", "3:00 PM")).toBeNull();
  });

  test("agency names drop ESBD's trailing code only", () => {
    expect(esbdAgencyName("University Of Texas At Tyler - 750")).toBe("University Of Texas At Tyler");
    expect(esbdAgencyName("City of San Antonio - M0152")).toBe("City of San Antonio");
    expect(esbdAgencyName("Texas Department of Transportation")).toBe("Texas Department of Transportation");
    expect(esbdAgencyName("East Texas A&amp;M - 751")).toBe("East Texas A&M");
  });

  test("detail links use the solicitation number", () => {
    expect(esbdDetailUrl("750-26-27-001")).toBe("https://www.txsmartbuy.gov/esbd/750-26-27-001");
    expect(esbdDetailUrl("RFP 26/27")).toBe("https://www.txsmartbuy.gov/esbd/RFP%2026%2F27");
  });
});

describe("tx_esbd — registration", () => {
  test("registered as a tail sync source, Texas home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "tx_esbd")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["tx_esbd"]).toBe("TX");
    expect(isStateLocalSource(["tx_esbd"])).toBe(true);
    expect(sourceBadgeLabel("tx_esbd")).toBe("State (TX)");
  });
});
