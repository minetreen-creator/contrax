/**
 * D14 CORPUS-LABEL ALARM — regression pins (post-PR-1 metrics layer).
 *
 * WHY THIS FILE EXISTS: the approved source-provenance policy reverses the old
 * fail-OPEN classification default — an UNCLASSIFIED `bids.source` label now
 * resolves to INTERNAL (`src/lib/source-class.ts`, conflict C7) and can never be
 * read as a state/local opportunity. That reversal shipped with NO alarm, so a
 * future collector label could quietly become INTERNAL: its rows would leave the
 * Small-Business pool / coverage counts and nobody would be told. The runner now
 * logs the D14 alarm on every run (one SELECT over `bids GROUP BY source`,
 * log-only, never fails the run, writes nothing). These pins fix the alarm's
 * contract without a database.
 *
 * DETERMINISTIC, ZERO NETWORK, NO DATABASE: the helper is pure and reads only the
 * committed class map; importing runner.ts is side-effect-free (its CLI entry is
 * behind `import.meta.main`, same pattern as runner.dedupe.test.ts) and nothing
 * here touches the Neon driver.
 *
 * LISTED EXPLICITLY in .github/workflows/build-check.yml — a new deterministic
 * suite that no workflow names runs nowhere (runner.dedupe.test.ts is still in
 * that state).
 */
import { describe, expect, test } from "bun:test";
import {
  formatInternalCorpusAlarm,
  internalCorpusLabels,
  type CorpusLabelCount,
} from "./runner";
import { resolveSourceClass } from "../lib/source-class";

describe("D14 internalCorpusLabels", () => {
  test("flags the legacy INTERNAL labels with their row counts (the honest today-case)", () => {
    const counts: CorpusLabelCount[] = [
      { source: "sam_gov", rows: 9000 },
      { source: "md_dc", rows: 226 },
      { source: "al", rows: 500 },
      { source: "seed", rows: 10 },
      { source: "contrax-demo", rows: 13 },
      { source: "pennbid", rows: 120 },
    ];
    expect(internalCorpusLabels(counts)).toEqual([
      { label: "md_dc", rows: 226 },
      { label: "contrax-demo", rows: 13 },
      { label: "seed", rows: 10 },
    ]);
  });

  test("flags an UNCLASSIFIED label — the whole point of the alarm (C7 fail-closed)", () => {
    const counts: CorpusLabelCount[] = [
      { source: "sam_gov", rows: 1 },
      { source: "brand_new_door_zz", rows: 42 },
    ];
    // Precondition: the label really is unclassified (resolves INTERNAL).
    expect(resolveSourceClass("brand_new_door_zz")).toBe("internal");
    expect(internalCorpusLabels(counts)).toEqual([
      { label: "brand_new_door_zz", rows: 42 },
    ]);
  });

  test("does NOT flag federal / state / local labels", () => {
    const counts: CorpusLabelCount[] = [
      { source: "sam_gov", rows: 1 },
      { source: "sam_gov_regional", rows: 1 },
      { source: "sam_naics_561720", rows: 1 },
      { source: "sam_naics_484121", rows: 1 },
      { source: "cities", rows: 1 },
      { source: "va_evirginia", rows: 1 },
      { source: "oh", rows: 1 },
      { source: "pennbid", rows: 1 },
      { source: "oh_dayton", rows: 1 },
      { source: "chicago_open_data", rows: 1 },
      { source: "nyc_open_data", rows: 1 },
      { source: "nys_socrata", rows: 0 }, // STATE (retired) — not INTERNAL
    ];
    expect(internalCorpusLabels(counts)).toEqual([]);
  });

  test("case/whitespace-insensitive, matching resolveSourceClass normalization", () => {
    const counts: CorpusLabelCount[] = [
      { source: "  MD_DC  ", rows: 3 },
      { source: null, rows: 7 }, // a row with no source is unclassified → INTERNAL
    ];
    expect(internalCorpusLabels(counts)).toEqual([
      { label: "(null)", rows: 7 },
      { label: "  MD_DC  ", rows: 3 },
    ]);
  });

  test("empty input → no alarm", () => {
    expect(internalCorpusLabels([])).toEqual([]);
  });
});

describe("D14 formatInternalCorpusAlarm", () => {
  test("success form names the label count when nothing is INTERNAL", () => {
    const counts: CorpusLabelCount[] = [
      { source: "sam_gov", rows: 12 },
      { source: "pennbid", rows: 3 },
    ];
    const line = formatInternalCorpusAlarm(counts);
    expect(line).toContain("✅ D14 corpus-label alarm");
    expect(line).toContain("all 2 corpus source label(s)");
    expect(line).not.toContain("⛔");
  });

  test("alarm form names every INTERNAL label with rows and the affected total", () => {
    const counts: CorpusLabelCount[] = [
      { source: "sam_gov", rows: 100 },
      { source: "md_dc", rows: 226 },
      { source: "seed", rows: 10 },
    ];
    const line = formatInternalCorpusAlarm(counts);
    expect(line).toContain("⛔ D14 corpus-label alarm");
    expect(line).toContain("2 source label(s) resolve to INTERNAL");
    expect(line).toContain("236 row(s)");
    expect(line).toContain("md_dc=226");
    expect(line).toContain("seed=10");
    expect(line).not.toContain("sam_gov=");
  });
});

