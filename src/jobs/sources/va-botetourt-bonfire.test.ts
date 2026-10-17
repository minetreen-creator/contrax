import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";
import { fetchVaBotetourtBonfireBids, parseVaBotetourtBonfire } from "./va-botetourt-bonfire";

const capture = (n: number) => JSON.parse(readFileSync(new URL(
  `./fixtures/va-botetourt-bonfire/open-2026-10-17-fetch${n}.json`, import.meta.url,
), "utf8")).payload;
const now = Date.parse("2026-10-17T18:00:00Z");

describe("Botetourt County's public procurement board", () => {
  test("two live captures preserve the cleaning bid and its extended deadline", () => {
    expect(capture(1)).toEqual(capture(2));
    const result = parseVaBotetourtBonfire(capture(1), now);
    expect(result.rows).toHaveLength(2);
    expect(result.skipped).toEqual({});
    const cleaning = result.rows.find(r => r.solicitation_number === "26-045")!;
    expect(cleaning.title).toBe("Janitorial Services");
    expect(cleaning.external_id).toBe("botetourtbonfire-257743");
    expect(cleaning.category).toBe("Janitorial");
    expect(cleaning.agency).toBe("Botetourt County, Virginia");
    expect(cleaning.location).toBe("Botetourt County, VA");
    expect(cleaning.source_url).toBe("https://botetourtva.bonfirehub.com/opportunities/257743");
    expect(cleaning.due_date).toBe("2026-11-05T19:00:00.000Z");
    expect(cleaning.naics_code).toBeNull();
    expect(cleaning.set_aside).toBeNull();
    expect(result.rows.find(r => r.solicitation_number === "26-054")!.category).not.toBe("Janitorial");
  });

  test("closed or non-open projects cannot become cleaning leads", () => {
    expect(parseVaBotetourtBonfire(capture(1), Date.parse("2026-11-06T00:00:00Z")).rows).toHaveLength(0);
    const payload = capture(1);
    payload.projects["257743"].ProjectStatusID = "3";
    expect(parseVaBotetourtBonfire(payload, now).rows.some(r => r.solicitation_number === "26-045")).toBe(false);
  });

  test("the scheduled source, locality badge, state, and agency page are wired", () => {
    expect(TAIL_SOURCES.find(s => s.name === "va_botetourt_bonfire")?.fetchFn).toBe(fetchVaBotetourtBonfireBids);
    expect(SOURCE_CLASSES.va_botetourt_bonfire).toMatchObject({ class: "local", scopeState: "VA", city: "Botetourt County" });
    expect(SOURCE_HOME_JURISDICTIONS.va_botetourt_bonfire).toBe("VA");
    expect(LOCAL_AGENCIES.some(a => a.source === "va_botetourt_bonfire" && a.slug === "botetourt-county")).toBe(true);
  });
});
