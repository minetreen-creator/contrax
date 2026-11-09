import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mapIonwaveBoard, readIonwavePage, TX_IONWAVE_BOARDS, TX_IONWAVE_SOURCES } from "./ar-ionwave";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";

// Owner 2026-11-09: "resume the texas cities work". Boards captured as ContraxBot on 2026-11-09.
const NOW = Date.parse("2026-11-09T21:00:00Z");
const fixture = (h: string) => readFileSync(new URL(`./fixtures/tx-ionwave/${h}-2026-11-09.html`, import.meta.url), "utf8");
const board = (source: string) => TX_IONWAVE_BOARDS.find((b) => b.source === source)!;

test.each([
  ["tx_plano_ionwave", "planotx", 7, "City of Plano", "Plano, TX"],
  ["tx_irving_ionwave", "cityofirving", 9, "City of Irving", "Irving, TX"],
  ["tx_georgetown_ionwave", "gtowntx", 7, "City of Georgetown", "Georgetown, TX"],
] as const)("%s: reads every bid on the board and maps it to the city", (source, host, total, agency, location) => {
  const page = readIonwavePage(source, fixture(host));
  expect(page.total).toBe(total);
  expect(page.items.length).toBe(total);
  const r = mapIonwaveBoard(board(source), page.items, NOW);
  expect(r.rows.length).toBe(total);
  for (const row of r.rows) {
    expect(row.agency).toBe(agency);
    expect(row.location).toBe(location);
    expect(row.source_url).toMatch(new RegExp(`^https://${host}\\.ionwave\\.net/PublicDetail\\.aspx\\?bidID=\\d+&SourceType=1$`));
  }
});

test("Central-time close times become the right instant (2:00 PM CT in November = 20:00 UTC)", () => {
  const r = mapIonwaveBoard(board("tx_plano_ionwave"), readIonwavePage("tx_plano_ionwave", fixture("planotx")).items, NOW);
  const generator = r.rows.find((x) => x.title === "Generator Maintenance and Repair Services")!;
  expect(generator.due_date).toBe("2026-11-16T20:00:00.000Z");
  expect(generator.description).toContain("Central");
});

test("registered, classified as Texas city sources, and listed as local agencies", () => {
  expect(TX_IONWAVE_SOURCES.map((s) => s.name)).toEqual(["tx_plano_ionwave", "tx_irving_ionwave", "tx_georgetown_ionwave"]);
  for (const s of ["tx_plano_ionwave", "tx_irving_ionwave", "tx_georgetown_ionwave"]) {
    expect(SOURCE_CLASSES[s]?.scopeState).toBe("TX");
    expect(LOCAL_AGENCIES.some((a) => a.source === s)).toBe(true);
  }
  const runner = readFileSync(new URL("../runner.ts", import.meta.url), "utf8");
  expect(runner).toContain("...TX_IONWAVE_SOURCES,");
});
