import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";
import { fetchFlBrowardBonfireBids, parseFlBrowardBonfire } from "./fl-broward-bonfire";

const capture = (n: number) => JSON.parse(readFileSync(new URL(
  `./fixtures/fl-broward-bonfire/open-2026-10-27-fetch${n}.json`, import.meta.url,
), "utf8")).payload;
const now = Date.parse("2026-10-27T01:15:48Z");

describe("Broward County's public BPRO (Bonfire) board", () => {
  test("two live captures parse every open project", () => {
    expect(capture(1)).toEqual(capture(2));
    const result = parseFlBrowardBonfire(capture(1), now);
    expect(result.rows).toHaveLength(25);
    expect(result.skipped).toEqual({});
    const court = result.rows.find(r => r.solicitation_number === "PNC2132739C1")!;
    expect(court.title).toBe("Broward County Judicial Court West Tower Repairs");
    expect(court.external_id).toBe("browardbonfire-248449");
    expect(court.agency).toBe("Broward County FASD - Purchasing");
    expect(court.location).toBe("Broward County, FL");
    expect(court.source_url).toBe("https://broward.bonfirehub.com/opportunities/248449");
    expect(court.due_date).toBe("2026-11-20T19:00:00.000Z");
    const canopy = result.rows.find(r => r.solicitation_number === "WWOD102226228")!;
    expect(canopy.agency).toBe("Broward County Public Works - Water & Wastewater Operations");
  });

  test("closed or non-open projects are dropped", () => {
    expect(parseFlBrowardBonfire(capture(1), Date.parse("2026-11-21T00:00:00Z")).rows).toHaveLength(0);
    const payload = capture(1);
    payload.projects["248449"].ProjectStatusID = "3";
    expect(parseFlBrowardBonfire(payload, now).rows.some(r => r.solicitation_number === "PNC2132739C1")).toBe(false);
  });

  test("the scheduled source, locality badge, state, and agency page are wired", () => {
    expect(TAIL_SOURCES.find(s => s.name === "fl_broward_bonfire")?.fetchFn).toBe(fetchFlBrowardBonfireBids);
    expect(SOURCE_CLASSES.fl_broward_bonfire).toMatchObject({ class: "local", scopeState: "FL", city: "Broward County" });
    expect(SOURCE_HOME_JURISDICTIONS.fl_broward_bonfire).toBe("FL");
    expect(LOCAL_AGENCIES.some(a => a.source === "fl_broward_bonfire" && a.slug === "broward-county")).toBe(true);
  });
});
