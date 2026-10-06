/**
 * Idaho IPRO (`id_ipro`) connector pins. Zero network, no database: the
 * fixture is the verbatim open-events JSON captured 2026-10-06 (gzipped; see
 * fixtures/id-ipro/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import { buildIproRows, ID_IPRO_PAGE_URL, iproUtcMs, parseIproList } from "./id-ipro";

const BODY = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/id-ipro/open-events-2026-10-06.json.gz", import.meta.url))).toString("utf8"));
const EVENTS = parseIproList(BODY);
const CAPTURED = Date.parse("2026-10-06T03:00:00Z");

describe("id_ipro — parse (captured response)", () => {
  test("15 open events on one page, all accepted", () => {
    expect(BODY.dataViewSet.pagingInfo.hasNext).toBe(false);
    expect(EVENTS.length).toBe(15);
    const { rows, skipped } = buildIproRows(EVENTS, CAPTURED);
    expect(skipped).toEqual({});
    expect(rows.length).toBe(15);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^idipro-\d+$/);
      expect(r.agency).toBe("State of Idaho");
      expect(r.location).toBe("Idaho");
      expect(r.source_url).toBe(ID_IPRO_PAGE_URL);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "id_ipro" });
      expect(cols.source_jurisdiction).toBe("ID");
      expect(cols.normalized_state).toBe("ID");
    }
  });

  test("a row reads as the portal lists it (close is UTC)", () => {
    const r = buildIproRows(EVENTS, CAPTURED).rows.find((x) => x.external_id === "idipro-1368")!;
    expect(r.title).toBe("ODP Printing Services");
    expect(r.due_date).toBe("2026-10-16T23:00:00.000Z"); // 5:00 PM MDT
    expect(r.solicitation_number).toBe("1368");
  });

  test("a passed close or other status is never accepted", () => {
    expect(buildIproRows(EVENTS.slice(0, 1), Date.parse("2026-12-01T00:00:00Z")).skipped).toEqual({ closed: 1 });
    expect(buildIproRows([{ ...EVENTS[0], status: "Closed" }], CAPTURED).skipped).toEqual({ not_open: 1 });
    expect(buildIproRows([{ ...EVENTS[0], close: "" }], CAPTURED).skipped).toEqual({ bad_date: 1 });
  });

  test("helpers and registration", () => {
    expect(iproUtcMs("2026111000000000")).toBe(Date.parse("2026-11-10T00:00:00Z"));
    expect(TAIL_SOURCES.some((s) => s.name === "id_ipro")).toBe(true);
    expect(SOURCE_CLASSES.id_ipro).toEqual({ class: "state", scopeState: "ID", searchScope: "state-portal", recordType: "opportunity" });
  });
});
