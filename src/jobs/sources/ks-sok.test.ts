/**
 * Kansas bidding events (`ks_sok`) connector pins. Zero network, no database:
 * the fixture is the verbatim event list captured 2026-10-06 (gzipped; see
 * fixtures/ks-sok/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import { KS_SOK_URL, ksAgencyName, parseKsEvents } from "./ks-sok";
import { parseOkGrid } from "./ok-omes";

const HTML = gunzipSync(readFileSync(new URL("./fixtures/ks-sok/bidding-events-2026-10-06.html.gz", import.meta.url))).toString("utf8");
const EVENTS = parseOkGrid(HTML);
const CAPTURED = Date.parse("2026-10-06T06:00:00Z");

describe("ks_sok — parse (captured page)", () => {
  test("25 events listed, all accepted", () => {
    expect(EVENTS.length).toBe(25);
    const { rows, skipped } = parseKsEvents(EVENTS, CAPTURED);
    expect(skipped).toEqual({});
    expect(rows.length).toBe(25);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^kssok-EVT\d+$/);
      expect(r.agency).toMatch(/^Kansas /);
      expect(r.location).toBe("Kansas");
      expect(r.source_url).toBe(KS_SOK_URL);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "ks_sok" });
      expect(cols.source_jurisdiction).toBe("KS");
      expect(cols.normalized_state).toBe("KS");
    }
  });

  test("a row reads as the list shows it", () => {
    const r = parseKsEvents(EVENTS, CAPTURED).rows.find((x) => x.external_id === "kssok-EVT0010947")!;
    expect(r.title).toBe("Dredging Project - Sheridan State Lake");
    expect(r.agency).toBe("Kansas Wildlife & Parks");
    expect(r.due_date).toBe("2026-10-20T19:00:00.000Z"); // 02:00 PM Central (CDT)
    expect(r.solicitation_number).toBe("EVT0010947");
    expect(r.notice_type).toBeNull();
  });

  test("a passed end date is never accepted", () => {
    expect(parseKsEvents(EVENTS.slice(0, 1), Date.parse("2026-12-01T00:00:00Z")).skipped).toEqual({ closed: 1 });
  });

  test("helpers and registration", () => {
    expect(ksAgencyName("KS Wildlife & Parks")).toBe("Kansas Wildlife & Parks");
    expect(ksAgencyName("Judicial Branch")).toBe("Kansas Judicial Branch");
    expect(ksAgencyName("Kansas Water Office")).toBe("Kansas Water Office");
    expect(TAIL_SOURCES.some((s) => s.name === "ks_sok")).toBe(true);
    expect(SOURCE_CLASSES.ks_sok).toEqual({ class: "state", scopeState: "KS", searchScope: "state-portal", recordType: "opportunity" });
  });
});
