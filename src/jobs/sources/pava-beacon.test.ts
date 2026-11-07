import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";
import { PAVA_BEACON_AGENCIES } from "./pava-beacon";
import { parseBeaconList } from "./tx-houston-beacon";

// Owner 2026-11-07: "Yes do Pennsylvania, Virginia and Ohio". Captured 2026-11-07.
const list = (tag: string) => JSON.parse(readFileSync(new URL(`./fixtures/pava-beacon/${tag}-2026-11-07.json`, import.meta.url), "utf8")).data.solicitations.data;
const now = Date.parse("2026-11-07T04:00:00Z");

test("each buyer's open Beacon list parses under its own name; an RFI is not a bid", () => {
  const counts: Record<string, number> = {};
  for (const a of PAVA_BEACON_AGENCIES) {
    const { rows } = parseBeaconList(list(a.agencyTag), a, now);
    counts[a.source] = rows.length;
    for (const r of rows) {
      expect(r.agency).toBe(a.agency);
      expect(r.location).toBe(a.location);
      expect(r.source_url).toStartWith(`https://www.beaconbid.com/solicitations/${a.agencyTag}/`);
    }
  }
  expect(counts).toEqual({ va_vbcps_beacon: 4, va_grtc_beacon: 0, pa_pittsburgh_schools_beacon: 7 });
  const vb = parseBeaconList(list("va-beach-city-public-schools"), PAVA_BEACON_AGENCIES[0], now).rows;
  expect(vb.find((r) => r.title.startsWith("Landstown High School Chiller"))!.due_date).toBe("2026-11-24T19:00:00.000Z");
});

test("scheduled, local, placed in their states, with agency pages", () => {
  for (const a of PAVA_BEACON_AGENCIES) {
    expect(TAIL_SOURCES.some((t) => t.name === a.source)).toBe(true);
    expect(SOURCE_CLASSES[a.source]?.class).toBe("local");
    expect(SOURCE_HOME_JURISDICTIONS[a.source]).toBe(a.location.endsWith(", PA") ? "PA" : "VA");
    expect(LOCAL_AGENCIES.some((x) => x.source === a.source)).toBe(true);
  }
});
