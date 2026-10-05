/**
 * Minnesota eAdvert on ConneX (`mn_connex`) connector pins. Zero network, no
 * database: the fixture is the verbatim out-for-bid JSON captured 2026-10-05
 * (gzipped; see fixtures/mn-connex/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import { connexAgencyName, connexTitle, parseConnex, type ConnexContract } from "./mn-connex";

const BODY = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/mn-connex/out-for-bid-2026-10-05.json.gz", import.meta.url))).toString("utf8"),
);
const ITEMS: ConnexContract[] = BODY.data;
const CAPTURED = Date.parse("2026-10-05T20:00:00Z");

describe("mn_connex — parse (captured response)", () => {
  test("25 Minnesota contracts, all accepted", () => {
    expect(ITEMS.length).toBe(25);
    expect(BODY.meta.totalRows).toBe(25);
    const { rows, skipped } = parseConnex(ITEMS, CAPTURED);
    expect(skipped).toEqual({});
    expect(rows.length).toBe(25);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^mnconnex-\d+$/);
      expect(r.location).toBe("Minnesota");
      expect(r.agency).not.toMatch(/, MN$/);
      expect(r.category).toBe("Construction");
      expect(r.source_url).toMatch(/^https:\/\/connex\.rtvision\.com\/contract\/out-for-bid\/\d+$/);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "mn_connex" });
      expect(cols.source_jurisdiction).toBe("MN");
      expect(cols.normalized_state).toBe("MN");
    }
  });

  test("a row reads as ConneX lists it", () => {
    const r = parseConnex(ITEMS, CAPTURED).rows.find((x) => x.external_id === "mnconnex-43536")!;
    expect(r.title).toBe("East Lyon Street Bike Trail");
    expect(r.agency).toBe("City of Marshall");
    expect(r.solicitation_number).toBe("PK-012");
    expect(r.due_date).toBe("2026-10-06T15:00:00.000Z");
    expect(r.description).toContain("Trail Construction");
  });

  test("other states, passed openings and bad dates are never accepted", () => {
    const base = ITEMS[0];
    expect(parseConnex([{ ...base, state: "Iowa" }], CAPTURED).skipped).toEqual({ out_of_state: 1 });
    expect(parseConnex([{ ...base, bidOpening: "2026-10-01T15:00:00.000Z" }], CAPTURED).skipped).toEqual({ closed: 1 });
    expect(parseConnex([{ ...base, bidOpening: null }], CAPTURED).skipped).toEqual({ bad_date: 1 });
    expect(parseConnex([base, base], CAPTURED).skipped).toEqual({ duplicate: 1 });
  });

  test("helpers and registration", () => {
    expect(connexAgencyName("Hennepin County, MN")).toBe("Hennepin County");
    expect(connexTitle({ name: "CP 0000-933835", number: "CP 0000-933835", type: "Road and Street" })).toBe("Road and Street contract CP 0000-933835");
    expect(connexTitle({ name: "CP 1", number: "CP 1", type: null })).toBe("Contract CP 1");
    expect(TAIL_SOURCES.some((s) => s.name === "mn_connex")).toBe(true);
    expect(SOURCE_CLASSES.mn_connex.scopeState).toBe("MN");
  });
});
