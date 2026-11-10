import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS, resolveStateFromText } from "~/lib/location-state";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";
import { CIVICENGAGE_NOT_A_BID_TITLE } from "./civicengage-bids";
import { AR_IONWAVE_BOARDS, arIonwaveDeps, fetchIonwaveBoard, ionwaveClose, mapIonwaveBoard, readIonwavePage } from "./ar-ionwave";
import { ionwaveThrottleDeps } from "./ionwave-throttle";

ionwaveThrottleDeps.gapMs = 0; // the shared IonWave pace is tested in ionwave-throttle.test.ts

// Owner 2026-11-07: "Add Arkansas city and county boards".
const fx = (f: string) => readFileSync(new URL(`./fixtures/ar-ionwave/${f}-2026-11-07.html`, import.meta.url), "utf8");
const now = Date.parse("2026-11-07T08:00:00Z");
const [central, fayetteville] = AR_IONWAVE_BOARDS;

test("shared central-Arkansas board: each row keeps its own buyer and place, Central close times", () => {
  const board = readIonwavePage(central.source, fx("central"));
  expect(board).toMatchObject({ total: 16, pages: 1 });
  const { rows, skipped } = mapIonwaveBoard(central, board.items, now);
  expect(skipped).toEqual({});
  expect(rows).toHaveLength(16);
  const byAgency = (a: string) => rows.filter((r) => r.agency === a).length;
  expect(byAgency("City of Hot Springs")).toBe(8);
  expect(byAgency("Little Rock Water Reclamation Authority")).toBe(4);
  const conway = rows.find((r) => r.agency === "City of Conway")!;
  expect(conway.title).toBe("Airport Park Improvements");
  expect(conway.location).toBe("Conway, AR");
  expect(conway.due_date).toBe("2026-11-09T20:00:00.000Z"); // 2:00 PM CST
  expect(conway.description).toContain("Addendum 2 has been issued.");
  expect(conway.source_url).toMatch(/^https:\/\/arkansas\.ionwave\.net\/PublicDetail\.aspx\?bidID=\d+&SourceType=1$/);
  expect(rows.find((r) => r.agency === "Pulaski County")!.location).toBe("Pulaski County, Arkansas");
  for (const r of rows) expect(resolveStateFromText(r.location)).toBe("AR");
});

test("Fayetteville's board reads as an honest empty list; an unknown buyer falls back to Arkansas", () => {
  const f = readIonwavePage(fayetteville.source, fx("fayetteville"));
  expect(f).toMatchObject({ total: 0, items: [] });
  const [r] = mapIonwaveBoard(central, [{ id: "1", number: "X-1", title: "Road Work", type: "ITB", org: "City of Somewhere", close: "12/1/2026 02:00:00 PM (CT)" }], now).rows;
  expect([r.agency, r.location]).toEqual(["City of Somewhere", "Arkansas"]);
  expect(mapIonwaveBoard(central, [{ id: "2", number: "S-1", title: "Parts", type: "Sole Source", org: "Pulaski County", close: "12/1/2026 02:00:00 PM (CT)" }], now).skipped).toEqual({ not_competitive: 1 });
  expect(() => readIonwavePage(central.source, "<html></html>")).toThrow();
});

test("close-time parsing and the CivicEngage bid-tabulation rule", () => {
  expect(ionwaveClose("11/23/2026 02:00:00 PM (CT)")).toBe("2026-11-23T20:00:00.000Z");
  expect(ionwaveClose("11/23/2026 02:00:00 PM (ET)")).toBe("2026-11-23T19:00:00.000Z");
  expect(ionwaveClose("soon")).toBeNull();
  for (const t of ["2024 Bid Tabulations", "Bid Results", "Bid Tabs"]) expect(CIVICENGAGE_NOT_A_BID_TITLE.test(t)).toBe(true);
  for (const t of ["Bid for Tabulation Software", "Street Resurfacing Bid"]) expect(CIVICENGAGE_NOT_A_BID_TITLE.test(t)).toBe(false);
});

test("readers fail loudly on HTTP errors; Arkansas sources are scheduled and registered", async () => {
  const saved = { ...arIonwaveDeps };
  try {
    arIonwaveDeps.fetch = async () => new Response("no", { status: 503 });
    await expect(fetchIonwaveBoard(central, now)).rejects.toThrow();
  } finally { Object.assign(arIonwaveDeps, saved); }
  for (const s of ["ar_ionwave_central", "ar_fayetteville_ionwave", "ar_little_rock_bonfire", "ar_jonesboro", "ar_siloam_springs", "ar_rogers", "ar_bentonville", "ar_russellville", "ar_cabot", "ar_maumelle", "ar_west_memphis", "ar_garland_county"]) {
    expect(TAIL_SOURCES.some((t) => t.name === s)).toBe(true);
    expect(SOURCE_CLASSES[s]).toMatchObject({ class: "local", scopeState: "AR" });
    expect(SOURCE_HOME_JURISDICTIONS[s]).toBe("AR");
    expect(LOCAL_AGENCIES.some((a) => a.source === s)).toBe(true);
  }
});
