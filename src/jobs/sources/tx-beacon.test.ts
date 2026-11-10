import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";
import { TX_BEACON_AGENCIES } from "./tx-beacon";
import { parseBeaconList } from "./tx-houston-beacon";

// Owner 2026-11-10: Texas cities. New Braunfels's open Beacon list, captured as ContraxBot 2026-11-10.
const list = JSON.parse(readFileSync(new URL("./fixtures/tx-beacon/city-of-new-braunfels-2026-11-10.json", import.meta.url), "utf8")).data.solicitations.data;

test("New Braunfels's open Beacon list parses under the city's name with real due dates", () => {
  const nb = TX_BEACON_AGENCIES[0];
  const { rows } = parseBeaconList(list, nb, Date.parse("2026-11-10T02:00:00Z"));
  expect(rows.map((r) => r.title)).toEqual(["On-Call Vehicle Repairs and Parts", "MURAL CONSERVATOR PROGRAM"]);
  for (const r of rows) {
    expect(r.agency).toBe("City of New Braunfels");
    expect(r.location).toBe("New Braunfels, TX");
    expect(r.source_url).toStartWith("https://www.beaconbid.com/solicitations/city-of-new-braunfels/");
  }
  expect(rows[0].due_date).toBe("2026-11-10T21:00:00.000Z");
  // After the first one's due time, only the second stays open.
  expect(parseBeaconList(list, nb, Date.parse("2026-11-11T00:00:00Z")).rows).toHaveLength(1);
});

test("scheduled, local, placed in Texas, with an agency page", () => {
  for (const a of TX_BEACON_AGENCIES) {
    expect(TAIL_SOURCES.some((t) => t.name === a.source)).toBe(true);
    expect(SOURCE_CLASSES[a.source]?.class).toBe("local");
    expect(SOURCE_HOME_JURISDICTIONS[a.source]).toBe("TX");
    expect(LOCAL_AGENCIES.some((x) => x.source === a.source)).toBe(true);
  }
});
