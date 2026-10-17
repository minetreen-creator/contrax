import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { sourceBadgeLabel } from "~/lib/cert-matching";
import {
  parseVaVtJaggaer, parseVaGmuBonfire, parseVaNsuBonfire,
  fetchVaVtJaggaerBids, fetchVaGmuBonfireBids, fetchVaNsuBonfireBids,
} from "./va-university-portals";

const dir = new URL("./fixtures/va-university-portals/", import.meta.url);
const vt = gunzipSync(readFileSync(new URL("vt-open-2026-10-17.html.gz", dir))).toString("utf8");
const payload = (name: string) => JSON.parse(readFileSync(new URL(`${name}-open-2026-10-17.json`, dir), "utf8")).payload;
const now = Date.parse("2026-10-17T18:30:00Z");

describe("Virginia direct public-university sources", () => {
  test("the captured VT list yields all five source events and real Eastern deadlines", () => {
    const result = parseVaVtJaggaer(vt, now);
    expect(result.events).toHaveLength(5);
    expect(result.rows).toHaveLength(5);
    expect(result.skipped).toEqual({});
    const beverage = result.rows.find(r => r.solicitation_number === "154542701")!;
    expect(beverage.external_id).toBe("vavtjaggaer-1423621");
    expect(beverage.due_date).toBe("2026-10-23T19:00:00.000Z");
    const brand = result.rows.find(r => r.solicitation_number === "218672705")!;
    expect(brand.due_date).toBe("2026-11-06T20:00:00.000Z");
    for (const row of result.rows) {
      expect(row.agency).toBe("Virginia Tech");
      expect(row.location).toBe("Virginia");
      expect(row.set_aside).toBeNull();
      expect(row.naics_code).toBeNull();
      expect(row.source_url).toContain("CustomerOrg=VATech");
    }
    // New sources do not mean new janitorial contracts: none at capture time.
    expect(result.rows.filter(r => r.category === "Janitorial")).toHaveLength(0);
  });

  test("empty public Mason and Norfolk State lists remain honestly empty", () => {
    for (const [name, parse] of [["gmu", parseVaGmuBonfire], ["nsu", parseVaNsuBonfire]] as const) {
      const result = parse(payload(name), now);
      expect(result.rows).toEqual([]);
      expect(result.skipped).toEqual({});
    }
  });

  test("past VT closing dates are excluded without hiding the long-running RFQ", () => {
    const result = parseVaVtJaggaer(vt, Date.parse("2026-11-07T00:00:00Z"));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.solicitation_number).toBe("049302701");
    expect(result.skipped.closed).toBe(4);
  });

  test("all three run on the normal schedule and retain state provenance", () => {
    for (const [source, fetchFn] of [
      ["va_vt_jaggaer", fetchVaVtJaggaerBids],
      ["va_gmu_bonfire", fetchVaGmuBonfireBids],
      ["va_nsu_bonfire", fetchVaNsuBonfireBids],
    ] as const) {
      expect(TAIL_SOURCES.find(s => s.name === source)?.fetchFn).toBe(fetchFn);
      expect(SOURCE_CLASSES[source]).toMatchObject({class: "state", scopeState: "VA", recordType: "opportunity"});
      expect(SOURCE_HOME_JURISDICTIONS[source]).toBe("VA");
      expect(sourceBadgeLabel(source)).toBe("State (VA)");
    }
  });
});
