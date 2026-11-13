import { expect, test } from "bun:test";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { MEVSS_CONFIG, MEVSS_URL, parseMeVssGrid } from "./me-vss";

// Owner 2026-11-13 ("add Maine"): Maine's state bids moved to its VSS portal in October 2025.
test("Maine VSS is read as ContraxBot from the state's own portal", () => {
  expect(MEVSS_URL).toBe("https://mevss.hostams.com/PRDVSS1X1/Advantage4");
  expect(MEVSS_CONFIG.userAgent).toContain("ContraxBot/1.0");
});

test("Maine VSS is scheduled, classified as the state portal and placed in Maine", () => {
  expect(TAIL_SOURCES.some((s) => s.name === "me_vss")).toBe(true);
  expect(SOURCE_CLASSES.me_vss?.class).toBe("state");
  expect(SOURCE_CLASSES.me_vss?.scopeState).toBe("ME");
  expect(SOURCE_HOME_JURISDICTIONS.me_vss).toBe("ME");
});

test("an empty grid parses to no rows", () => {
  expect(parseMeVssGrid({ row_data: [], rows_total: 0 } as any, Date.UTC(2026, 10, 13)).rows).toEqual([]);
});
