import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { activeSources, ROBOTS_PAUSED_SOURCES, TAIL_SOURCES } from "./runner";

// Owner standing rule: respect robots.txt. Checked as ContraxBot on 2026-11-12: every *.ionwave.net
// board answers "User-agent: * / Disallow: /", and Dubuque moved its bids onto one.
const PAUSED = ["ar_ionwave_central", "ar_fayetteville_ionwave", "sc_columbia_ionwave", "tx_plano_ionwave", "tx_irving_ionwave", "tx_georgetown_ionwave", "ne_omaha_ionwave", "fl_lee_county", "ia_dubuque"];

test("the nine sources whose robots.txt disallows reading are paused", () => {
  expect([...ROBOTS_PAUSED_SOURCES].sort()).toEqual([...PAUSED].sort());
});

test("a sync reads none of them, and still reads everything else", () => {
  const active = activeSources(TAIL_SOURCES).map((s) => s.name);
  for (const name of PAUSED) expect(active).not.toContain(name);
  const registered = TAIL_SOURCES.map((s) => s.name);
  expect(active.length).toBe(registered.length - PAUSED.filter((n) => registered.includes(n)).length);
  expect(active).toContain("vt_vbr");
});

test("every paused name is a real registered source, so a typo cannot pause nothing", () => {
  const registered = new Set(TAIL_SOURCES.map((s) => s.name));
  for (const name of PAUSED) expect(registered.has(name)).toBe(true);
});

test("the sync applies the pause to both the full list and the tail list", () => {
  const runner = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
  expect(runner).toContain("const allSources = activeSources([...SAM_GOV_SOURCES, ...STATE_KEYWORD_SOURCES, ...TAIL_SOURCES]);");
  expect(runner).toContain("const tailSources = activeSources(TAIL_SOURCES).filter(");
});
