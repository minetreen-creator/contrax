import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { activeSources, ROBOTS_PAUSED_SOURCES, TAIL_SOURCES } from "./runner";

// 2026-11-12: Dubuque took down its own bid list. The eight IonWave boards were paused over their
// robots.txt and restored the same day on the owner's word ("keep them").
const IONWAVE = ["ar_ionwave_central", "ar_fayetteville_ionwave", "sc_columbia_ionwave", "tx_plano_ionwave", "tx_irving_ionwave", "tx_georgetown_ionwave", "ne_omaha_ionwave", "fl_lee_county"];

test("only Dubuque, whose bid list is gone, is paused", () => {
  expect([...ROBOTS_PAUSED_SOURCES]).toEqual(["ia_dubuque"]);
});

test("a sync reads the eight IonWave boards again, and does not read Dubuque", () => {
  const active = activeSources(TAIL_SOURCES).map((s) => s.name);
  for (const name of IONWAVE) expect(active).toContain(name);
  expect(active).not.toContain("ia_dubuque");
  expect(active.length).toBe(TAIL_SOURCES.length - 1);
});

test("every paused name is a real registered source, so a typo cannot pause nothing", () => {
  const registered = new Set(TAIL_SOURCES.map((s) => s.name));
  for (const name of ROBOTS_PAUSED_SOURCES) expect(registered.has(name)).toBe(true);
});

test("the sync applies the pause to both lists, and the owner's decision is written down", () => {
  const runner = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
  expect(runner).toContain("const allSources = activeSources([...SAM_GOV_SOURCES, ...STATE_KEYWORD_SOURCES, ...TAIL_SOURCES]);");
  expect(runner).toContain("const tailSources = activeSources(TAIL_SOURCES).filter(");
  expect(runner).toContain('owner decision 2026-11-12, "keep them"');
  expect(runner).toContain("No new IonWave board is added without the owner's word.");
});
