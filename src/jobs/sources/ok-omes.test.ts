/**
 * Oklahoma OMES bidding events (`ok_omes`) connector pins. Zero network, no
 * database: the fixture is the verbatim event list captured 2026-10-06
 * (gzipped; see fixtures/ok-omes/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import { OK_OMES_URL, okAgencyName, okDueMs, parseOkEvents, parseOkGrid } from "./ok-omes";

const HTML = gunzipSync(readFileSync(new URL("./fixtures/ok-omes/bidding-events-2026-10-06.html.gz", import.meta.url))).toString("utf8");
const EVENTS = parseOkGrid(HTML);
const CAPTURED = Date.parse("2026-10-06T06:00:00Z");

describe("ok_omes — parse (captured page)", () => {
  test("10 events listed, all accepted", () => {
    expect(EVENTS.length).toBe(10);
    const { rows, skipped } = parseOkEvents(EVENTS, CAPTURED);
    expect(skipped).toEqual({});
    expect(rows.length).toBe(10);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^okomes-EV\d+$/);
      expect(r.agency).toMatch(/^Oklahoma /);
      expect(r.location).toBe("Oklahoma");
      expect(r.source_url).toBe(OK_OMES_URL);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "ok_omes" });
      expect(cols.source_jurisdiction).toBe("OK");
      expect(cols.normalized_state).toBe("OK");
    }
  });

  test("a row reads as the list shows it", () => {
    const rows = parseOkEvents(EVENTS, CAPTURED).rows;
    const r = rows.find((x) => x.external_id === "okomes-EV00000939")!;
    expect(r.title).toBe("Inmate Communications Solutions");
    expect(r.agency).toBe("Oklahoma Department of Corrections");
    expect(r.due_date).toBe("2026-10-29T20:00:00.000Z"); // 03:00 PM Central (CDT)
    expect(r.solicitation_number).toBe("EV00000939");
    expect(r.notice_type).toBe("RFx");
    // The portal cuts names at 50 characters.
    expect(rows.find((x) => x.external_id === "okomes-EV00000973")!.title).toBe("SW1023-Supplemental RFP-Online database informatio…");
  });

  test("a passed end date is never accepted; a repeat is skipped", () => {
    expect(parseOkEvents(EVENTS.slice(0, 1), Date.parse("2026-10-07T00:00:00Z")).skipped).toEqual({ closed: 1 });
    expect(parseOkEvents([EVENTS[0], EVENTS[0]], CAPTURED).skipped).toEqual({ duplicate: 1 });
    expect(parseOkEvents([{ ...EVENTS[0], end: "soon" }], CAPTURED).skipped).toEqual({ bad_date: 1 });
  });

  test("helpers and registration", () => {
    expect(okDueMs("11/17/2026 03:00 PM CST")).toBe(Date.parse("2026-11-17T21:00:00Z")); // CST after Nov 1
    expect(okAgencyName("Mgmt and Enterprise Services")).toBe("Oklahoma Office of Management and Enterprise Services");
    expect(okAgencyName("Department of Health")).toBe("Oklahoma Department of Health");
    expect(TAIL_SOURCES.some((s) => s.name === "ok_omes")).toBe(true);
    expect(SOURCE_CLASSES.ok_omes).toEqual({ class: "state", scopeState: "OK", searchScope: "state-portal", recordType: "opportunity" });
  });
});
