/**
 * Indiana IDOA Current Business Opportunities (`in_idoa`) connector pins.
 * Zero network, no database: the fixture is the verbatim page captured
 * 2026-10-02 (gzipped; see fixtures/in-idoa/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { idoaDateToIso, IN_IDOA_URL, parseIdoaPage, readIdoaEvents } from "./in-idoa";

const HTML = gunzipSync(
  readFileSync(new URL("./fixtures/in-idoa/current-business-opportunities-2026-10-02.html.gz", import.meta.url)),
).toString("utf8");
const CAPTURED = Date.parse("2026-10-02T03:30:00Z");

describe("in_idoa — parse (captured page)", () => {
  test("finds the open-events table (not the conference schedules): 55 events, all open", () => {
    expect(readIdoaEvents(HTML)!.length).toBe(55);
    const { rows, skipped } = parseIdoaPage(HTML, CAPTURED);
    expect(skipped).toEqual({});
    expect(rows.length).toBe(55);
    for (const r of rows) {
      expect(r.external_id).toBe(`inidoa-${r.solicitation_number}`);
      expect(r.source_url).toBe(IN_IDOA_URL);
      expect(r.location).toBe("Indiana");
      expect(r.title).not.toContain("Bid Documents");
      expect(r.description).not.toMatch(/\w@\w/); // no buyer emails
      expect(r.description).not.toMatch(new RegExp(`\\b${r.agency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "in_idoa" });
      expect(cols.source_jurisdiction).toBe("IN");
      expect(cols.normalized_state).toBe("IN");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("a DNR trash contract maps field by field", () => {
    const row = parseIdoaPage(HTML, CAPTURED).rows.find((r) => r.solicitation_number === "003000000088448")!;
    expect(row.title).toBe("300 FW Driftwood 2-year Trash Service Contract");
    expect(row.agency).toBe("Natural Resources");
    expect(row.due_date).toBe("2026-10-02T14:00:00.000Z"); // 10:00 AM Indianapolis (EDT)
  });

  test("the bid package link is kept; a November due date is read in EST", () => {
    const row = parseIdoaPage(HTML, CAPTURED).rows.find((r) => r.solicitation_number === "007300000088394")!;
    expect(row.description).toContain("Bid package: https://www.in.gov/idoa/proc/solicitations/files/007300000088394.zip");
    expect(row.due_date).toBe("2026-11-11T20:00:00.000Z"); // 3:00 PM EST
    expect(row.description).not.toContain("State the buyer");
  });

  test("events past their due time are closed", () => {
    const later = parseIdoaPage(HTML, Date.parse("2026-10-20T00:00:00Z"));
    expect(later.skipped.closed).toBeGreaterThan(0);
    expect(later.rows.length + later.skipped.closed!).toBe(55);
  });

  test("dates and a page without the table", () => {
    expect(idoaDateToIso("10/02/2026  8:30:00AM EST")).toBe("2026-10-02T12:30:00.000Z");
    expect(idoaDateToIso("12/01/2026 12:00:00PM EST")).toBe("2026-12-01T17:00:00.000Z");
    expect(idoaDateToIso("TBD")).toBeNull();
    expect(readIdoaEvents("<html><table><tr><td>x</td></tr></table></html>")).toBeNull();
  });
});

describe("in_idoa — registration", () => {
  test("registered as a tail sync source, Indiana home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "in_idoa")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["in_idoa"]).toBe("IN");
    expect(isStateLocalSource(["in_idoa"])).toBe(true);
    expect(sourceBadgeLabel("in_idoa")).toBe("State (IN)");
  });
});
