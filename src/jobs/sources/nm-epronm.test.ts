/**
 * New Mexico eProNM (`nm_epronm`) connector pins. Zero network, no database:
 * the fixture is the public event list captured 2026-10-06 (gzipped; see
 * fixtures/nm-epronm/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import { buildNmRows, NM_EPRONM_URL, nmCloseMs, parseNmEvents } from "./nm-epronm";

const HTML = gunzipSync(readFileSync(new URL("./fixtures/nm-epronm/public-events-2026-10-06.html.gz", import.meta.url))).toString("utf8");
const EVENTS = parseNmEvents(HTML);
const CAPTURED = Date.parse("2026-10-06T03:00:00Z");

describe("nm_epronm — parse (captured page)", () => {
  test("10 events listed (as the page counts them), all accepted", () => {
    expect(/of\s+10\s+Results/.test(HTML)).toBe(true);
    expect(EVENTS.length).toBe(10);
    const { rows, skipped } = buildNmRows(EVENTS, CAPTURED);
    expect(skipped).toEqual({});
    expect(rows.length).toBe(10);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^nmepronm-\d+$/);
      expect(r.location).toBe("New Mexico");
      expect(r.source_url).toBe(NM_EPRONM_URL);
      expect(r.title).not.toMatch(/&\w+;/);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "nm_epronm" });
      expect(cols.source_jurisdiction).toBe("NM");
      expect(cols.normalized_state).toBe("NM");
    }
  });

  test("a row reads as the list shows it", () => {
    const rows = buildNmRows(EVENTS, CAPTURED).rows;
    const r = rows.find((x) => x.external_id === "nmepronm-1441421")!;
    expect(r.title).toBe("Gallup State Veterans Cemetary Site Rehabilitation");
    expect(r.solicitation_number).toBe("71-35000-26-08804");
    expect(r.notice_type).toBe("ITB C");
    expect(r.due_date).toBe("2026-10-13T20:00:00.000Z"); // 2:00 PM MDT
    expect(r.description).toContain("Gallup State Veterans Cemetery");
    expect(rows.find((x) => x.external_id === "nmepronm-1450143")!.title).toBe("Precipitation Enhancement Program – Part 1: Feasibility & Research");
  });

  test("closed or not-open events are never accepted", () => {
    expect(buildNmRows(EVENTS.slice(0, 1), Date.parse("2026-12-01T00:00:00Z")).skipped).toEqual({ closed: 1 });
    expect(buildNmRows([{ ...EVENTS[0], status: "Closed" }], CAPTURED).skipped).toEqual({ not_open: 1 });
    expect(buildNmRows([{ ...EVENTS[0], close: "TBD" }], CAPTURED).skipped).toEqual({ bad_date: 1 });
  });

  test("helpers and registration", () => {
    expect(nmCloseMs("12/1/2026, 2:00 PM MST")).toBe(Date.parse("2026-12-01T21:00:00Z"));
    expect(TAIL_SOURCES.some((s) => s.name === "nm_epronm")).toBe(true);
    expect(SOURCE_CLASSES.nm_epronm).toEqual({ class: "state", scopeState: "NM", searchScope: "state-portal", recordType: "opportunity" });
  });
});
