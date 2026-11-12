import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { IA_IONWAVE_BOARDS, IA_IONWAVE_SOURCES, mapIonwaveBoard, readIonwavePage } from "./ar-ionwave";
import { COUNTY_CIVICENGAGE_CONFIGS } from "./county-civicengage-boards";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";

// Owner 2026-11-12: "add Dubuque". The city took down its own bid list and posts on IonWave.
// Board captured as ContraxBot on 2026-11-12 at 17:31 UTC.
const NOW = Date.parse("2026-11-12T17:31:00Z");
const html = readFileSync(new URL("./fixtures/ia-ionwave/cityofdubuque-2026-11-12.html", import.meta.url), "utf8");
const board = IA_IONWAVE_BOARDS.find((b) => b.source === "ia_dubuque")!;

test("reads every bid on Dubuque's board and maps it to the city", () => {
  const page = readIonwavePage("ia_dubuque", html);
  expect(page.total).toBe(6);
  expect(page.items.length).toBe(6);
  const r = mapIonwaveBoard(board, page.items, NOW);
  expect(r.rows.length).toBe(6);
  for (const row of r.rows) {
    expect(row.agency).toBe("City of Dubuque");
    expect(row.location).toBe("Dubuque, IA");
    expect(row.external_id).toMatch(/^dubuqueiaionwave-\d+$/);
    expect(row.source_url).toMatch(/^https:\/\/cityofdubuque\.ionwave\.net\/PublicDetail\.aspx\?bidID=\d+&SourceType=1$/);
  }
  expect(r.rows.map((x) => x.title)).toContain("Financial Advisory Services");
});

test("Central-time close times become the right instant (2:00 PM CT in November = 20:00 UTC)", () => {
  const r = mapIonwaveBoard(board, readIonwavePage("ia_dubuque", html).items, NOW);
  const snow = r.rows.find((x) => x.title === "2026-2027 Snow and Ice Removal From Public Sidewalks")!;
  expect(snow.due_date).toBe("2026-11-19T20:00:00.000Z");
  expect(snow.solicitation_number).toBe("5521000006");
});

test("an addendum is noted and kept out of the bid number; a bid past its close is dropped", () => {
  const items = readIonwavePage("ia_dubuque", html).items;
  const r = mapIonwaveBoard(board, items, NOW);
  const healthy = r.rows.find((x) => x.solicitation_number === "FY27-0017")!;
  expect(healthy.description).toContain("Addendum 1 has been issued.");
  // The two "Healthy Homes" bids close at 1:00 PM CT on capture day (19:00 UTC).
  const later = mapIonwaveBoard(board, items, Date.parse("2026-11-12T19:30:00Z"));
  expect(later.rows.length).toBe(4);
  expect(later.skipped.closed).toBe(2);
});

test("ia_dubuque is read by the IonWave reader now, not the old city-site reader", () => {
  expect(IA_IONWAVE_SOURCES.map((s) => s.name)).toEqual(["ia_dubuque"]);
  expect(COUNTY_CIVICENGAGE_CONFIGS.some((c) => c.source === "ia_dubuque")).toBe(false);
  expect(SOURCE_CLASSES.ia_dubuque?.scopeState).toBe("IA");
  expect(LOCAL_AGENCIES.some((a) => a.source === "ia_dubuque")).toBe(true);
  const runner = readFileSync(new URL("../runner.ts", import.meta.url), "utf8");
  expect(runner).toContain("...IA_IONWAVE_SOURCES,");
});
