import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS, deriveInsertLocationColumns } from "~/lib/location-state";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";
import { fetchNjPanynjBonfireBids, panynjPlace, parseNjPanynjBonfire } from "./nj-panynj-bonfire";

const capture = (n: number) =>
  JSON.parse(readFileSync(new URL(`./fixtures/county-bonfire/panynj/open-2026-10-28-fetch${n}.json`, import.meta.url), "utf8")).payload;
const now = Date.parse("2026-10-28T12:00:00Z");

describe("Port Authority of NY & NJ Bonfire board", () => {
  test("both captures match; 89 open, 3 non-bids skipped", () => {
    expect(capture(1)).toEqual(capture(2));
    expect(Object.keys(capture(1).projects)).toHaveLength(89);
    const { rows, skipped } = parseNjPanynjBonfire(capture(1), now);
    expect(rows).toHaveLength(86);
    expect(skipped).toEqual({ not_a_bid: 3 });
    expect(rows.some((r) => /information only|development lease|notice of intent/i.test(r.title))).toBe(false);
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.external_id.startsWith("panynjbonfire-")).toBe(true);
      expect(r.source_url).toMatch(/^https:\/\/panynj\.bonfirehub\.com\/opportunities\/\d+$/);
      expect(r.agency.startsWith("Port Authority of NY & NJ")).toBe(true);
    }
  });

  test("each row is placed by the facility its title names", () => {
    expect(panynjPlace("Call-In Plumbing Maintenance At Newark Liberty International Airport").location).toBe("New Jersey");
    expect(panynjPlace("Supply and Deliver Trailer Mounted Pumps and Hoses to Holland Tunnel in NJ").location).toBe("New Jersey");
    expect(panynjPlace("LGA-124.881 - LaGuardia Airport - Rehabilitation of Taxilane").location).toBe("New York");
    expect(panynjPlace("MASTER AGREEMENTS – JOHN F. KENNEDY (JFK) REDEVELOPMENT PROGRAM").location).toBe("New York");
    // Both states, a bi-state crossing, or no facility: bi-state, listed under NJ.
    expect(panynjPlace("Cafeteria Supplies to Various Warehouses in NY and NJ").location).toBe("New Jersey (bi-state NY/NJ agency)");
    expect(panynjPlace("Lincoln Tunnel - Galvin Plaza Bridge Deck Replacement").location).toBe("New Jersey (bi-state NY/NJ agency)");
    expect(panynjPlace("Expert Professional Internal Audit Services").stateName).toBe("Bi-state NY/NJ");
  });

  test("stored state follows the row, not a source pin", () => {
    expect(SOURCE_HOME_JURISDICTIONS["nj_panynj_bonfire"]).toBeUndefined();
    const { rows } = parseNjPanynjBonfire(capture(1), now);
    const states = (loc: string) =>
      rows.filter((r) => r.location === loc).map((r) => deriveInsertLocationColumns({ ...r, sourceName: "nj_panynj_bonfire" }).normalized_state);
    expect(new Set(states("New York"))).toEqual(new Set(["NY"]));
    expect(new Set(states("New Jersey"))).toEqual(new Set(["NJ"]));
    expect(new Set(states("New Jersey (bi-state NY/NJ agency)"))).toEqual(new Set(["NJ"]));
  });

  test("closed rows drop out", () => {
    expect(parseNjPanynjBonfire(capture(1), Date.parse("2031-01-01T00:00:00Z")).rows).toHaveLength(0);
  });

  test("scheduled, classified and has an agency page", () => {
    expect(TAIL_SOURCES.find((t) => t.name === "nj_panynj_bonfire")?.fetchFn).toBe(fetchNjPanynjBonfireBids);
    expect(SOURCE_CLASSES["nj_panynj_bonfire"]?.class).toBe("local");
    expect(LOCAL_AGENCIES.some((a) => a.source === "nj_panynj_bonfire")).toBe(true);
  });
});
