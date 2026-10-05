/**
 * Utah U3P / Bonfire (`ut_bonfire`) connector pins. Zero network, no database:
 * the fixture is the verbatim open-opportunities JSON captured 2026-10-05
 * (gzipped; see fixtures/ut-bonfire/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import { isNonCompetitiveUtNotice, parseUtBonfire, utAgencyName, utCloseMs, type UtPayload } from "./ut-bonfire";

const PAYLOAD: UtPayload = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/ut-bonfire/open-opportunities-2026-10-05.json.gz", import.meta.url))).toString("utf8"),
).payload;
const CAPTURED = Date.parse("2026-10-05T20:00:00Z");

describe("ut_bonfire — parse (captured response)", () => {
  test("186 listed; 3 non-competitive notices skipped; the rest accepted", () => {
    expect(Object.keys(PAYLOAD.projects).length).toBe(186);
    const { rows, skipped } = parseUtBonfire(PAYLOAD, CAPTURED);
    expect(skipped).toEqual({ not_competitive: 3 });
    expect(rows.length).toBe(183);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^utbonfire-\d+$/);
      expect(r.location).toBe("Utah");
      expect(Date.parse(r.due_date!)).toBeGreaterThan(CAPTURED);
      expect(r.source_url).toMatch(/^https:\/\/utah\.bonfirehub\.com\/opportunities\/\d+$/);
      expect(r.agency).not.toMatch(/^[A-Z ]+ - /);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "ut_bonfire" });
      expect(cols.source_jurisdiction).toBe("UT");
      expect(cols.normalized_state).toBe("UT");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("a row reads as the portal lists it", () => {
    const r = parseUtBonfire(PAYLOAD, CAPTURED).rows.find((x) => x.external_id === "utbonfire-253985")!;
    expect(r.title).toBe("BEHAVIORAL HEALTH UNIT IN THE SUMMIT COUNTY JAIL");
    expect(r.solicitation_number).toBe("SUCO9142026");
    expect(r.due_date).toBe("2026-10-05T23:00:00.000Z");
    expect(r.agency).toBe("Summit County");
  });

  test("a passed close date or other status is never accepted", () => {
    const base = PAYLOAD.projects["253985"];
    expect(parseUtBonfire({ projects: { a: { ...base, DateClose: "2026-10-01 20:00:00" } }, departments: PAYLOAD.departments }, CAPTURED).skipped).toEqual({ closed: 1 });
    expect(parseUtBonfire({ projects: { a: { ...base, ProjectStatusID: "3" } }, departments: PAYLOAD.departments }, CAPTURED).skipped).toEqual({ not_open: 1 });
  });

  test("helpers", () => {
    expect(utAgencyName("CITIES - City of Orem")).toBe("City of Orem");
    expect(utAgencyName("EXECUTIVE BRANCH AGENCIES - Department of Health and Human Services")).toBe("Department of Health and Human Services");
    expect(utAgencyName("Division of Purchasing")).toBe("Utah Division of Purchasing");
    expect(utAgencyName("EXECUTIVE BRANCH AGENCIES - DFCM - Division of Facilities Construction and Management")).toBe("Division of Facilities Construction and Management (DFCM)");
    expect(utAgencyName(null)).toBe("State of Utah");
    expect(utCloseMs("2026-10-19 21:00:00")).toBe(Date.parse("2026-10-19T21:00:00Z"));
    expect(utCloseMs("soon")).toBeNaN();
    expect(isNonCompetitiveUtNotice("Contract 256230 Amendment 4 request to increase funding")).toBe(true);
    expect(isNonCompetitiveUtNotice("Notice of Intent to Award Without Engaging in a Standard Procurement Process - X")).toBe(true);
    expect(isNonCompetitiveUtNotice("HVAC & Mechanical Maintenance Services")).toBe(false);
  });

  test("registered as a Utah state source", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "ut_bonfire")).toBe(true);
    expect(SOURCE_CLASSES.ut_bonfire?.scopeState).toBe("UT");
  });
});
