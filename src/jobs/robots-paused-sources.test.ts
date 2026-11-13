import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { activeSources, ROBOTS_PAUSED_SOURCES, TAIL_SOURCES } from "./runner";

// 2026-11-12: the eight IonWave boards were paused over their robots.txt and restored the same day
// on the owner's word ("keep them"); Dubuque's IonWave board was added on the owner's word.
const IONWAVE = ["ar_ionwave_central", "ar_fayetteville_ionwave", "sc_columbia_ionwave", "tx_plano_ionwave", "tx_irving_ionwave", "tx_georgetown_ionwave", "ne_omaha_ionwave", "fl_lee_county", "ia_dubuque"];

test("Knox County (403 = stop) and Minnesota QuestCDN (robots.txt disallows all) are paused, and a sync reads all nine IonWave boards", () => {
  expect([...ROBOTS_PAUSED_SOURCES]).toEqual(["tn_knox_county", "mn_questcdn"]);
  const active = activeSources(TAIL_SOURCES).map((s) => s.name);
  for (const name of IONWAVE) expect(active).toContain(name);
  expect(active).not.toContain("tn_knox_county");
  expect(active).not.toContain("mn_questcdn");
  expect(active.length).toBe(TAIL_SOURCES.filter((s) => !ROBOTS_PAUSED_SOURCES.has(s.name)).length);
});

test("the pause still works when a name is added", () => {
  const list = [{ name: "a" }, { name: "b" }];
  expect(activeSources(list)).toEqual(list);
});

test("the sync applies the pause to both lists, and the owner's decisions are written down", () => {
  const runner = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
  expect(runner).toContain("const allSources = activeSources([...SAM_GOV_SOURCES, ...STATE_KEYWORD_SOURCES, ...TAIL_SOURCES]);");
  expect(runner).toContain("const tailSources = activeSources(TAIL_SOURCES).filter(");
  expect(runner).toContain('owner\'s word ("keep them")');
  expect(runner).toContain('owner\'s word ("add Dubuque")');
  expect(runner).toContain("No new IonWave board is added without the owner's word.");
});
