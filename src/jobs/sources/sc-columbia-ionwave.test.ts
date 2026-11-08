import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mapIonwaveBoard, readIonwavePage, SC_IONWAVE_BOARDS, SC_IONWAVE_SOURCES } from "./ar-ionwave";
import { SOURCE_CLASSES } from "~/lib/source-class";

// Owner 2026-11-08: the City of Columbia, SC posted that it is moving to Cobblestone and that bids
// stay on IonWave until it launches. Captured 2026-11-08: the board held only the "register for our
// new platform" notice, typed "Event".
const html = readFileSync(new URL("./fixtures/sc-columbia/columbiasc-ionwave-2026-11-08.html", import.meta.url), "utf8");

test("reads Columbia's public IonWave board", () => {
  const page = readIonwavePage("sc_columbia_ionwave", html);
  expect(page.total).toBe(1);
  expect(page.items[0].title).toBe("Register for Our New e-Procurement Platform");
  expect(page.items[0].type).toBe("Event");
});

test("an Event row is not a solicitation and never becomes a bid", () => {
  const page = readIonwavePage("sc_columbia_ionwave", html);
  const r = mapIonwaveBoard(SC_IONWAVE_BOARDS[0], page.items, Date.parse("2026-11-08T12:00:00Z"));
  expect(r.rows).toEqual([]);
  expect(r.skipped).toEqual({ not_a_solicitation: 1 });
});

test("a real Columbia bid maps to the city with its own place", () => {
  const r = mapIonwaveBoard(SC_IONWAVE_BOARDS[0], [
    { id: "2001", number: "BID041-26-27-WRO", title: "Public Works Road Resurfacing", type: "Invitation for Bid (IFB)", org: "Purchasing", close: "12/15/2026 02:00:00 PM (ET)" },
  ], Date.parse("2026-11-08T12:00:00Z"));
  expect(r.rows.length).toBe(1);
  expect(r.rows[0].agency).toBe("City of Columbia");
  expect(r.rows[0].location).toBe("Columbia, SC");
  expect(r.rows[0].external_id).toBe("columbiascionwave-2001");
  expect(r.rows[0].source_url).toBe("https://columbiasc.ionwave.net/PublicDetail.aspx?bidID=2001&SourceType=1");
});

test("the board is registered and classified as a South Carolina city source", () => {
  expect(SC_IONWAVE_SOURCES.map((s) => s.name)).toEqual(["sc_columbia_ionwave"]);
  expect(SOURCE_CLASSES.sc_columbia_ionwave?.scopeState).toBe("SC");
});
