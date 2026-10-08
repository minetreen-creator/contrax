/**
 * DEADLINE-LABEL POLICY PINS (owner ruling 2026-10-08, Virginia drive).
 *
 * DETERMINISTIC and network-free by construction: every input is a literal, a
 * repo constant, or a file read from this checkout. No DATABASE_URL, no fetch.
 *
 * What it proves:
 *   1. the pinned suppressed-source set is EXACTLY the set of connectors that
 *      mint a `*_DUE_DATE_ZONE_UNVERIFIED` flag (derived from `src/jobs/runner.ts`
 *      + `src/jobs/sources/*.ts`, so a future connector that mints the flag but
 *      forgets the list fails LOUD here instead of shipping a countdown);
 *   2. flagged source ⇒ countdown suppressed, raw published date (UTC-rendered);
 *   3. unflagged source and NULL/unknown source ⇒ byte-identical unchanged label;
 *   4. the bare-`Z` value is never shifted by the reader's zone (UTC render);
 *   5. the honesty note still quotes `VA_EVA_COPY.timeZoneNote` verbatim, the
 *      sentence that promises "does not show a countdown for these rows".
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  COUNTDOWN_SUPPRESSED_SOURCES,
  DEADLINE_AS_PUBLISHED_LABEL,
  ZONE_UNVERIFIED_DEADLINE_NOTE,
  countdownText,
  daysUntilDeadline,
  deadlineLabel,
  isCountdownSuppressed,
  publishedDateText,
} from "./deadline-label";
import { VA_EVA_COPY, VA_EVA_DUE_DATE_ZONE_UNVERIFIED } from "~/jobs/sources/va-eva";

const SOURCES_DIR = join(import.meta.dir, "..", "jobs", "sources");
const RUNNER = readFileSync(join(import.meta.dir, "..", "jobs", "runner.ts"), "utf8");

/**
 * `*_DUE_DATE_ZONE_UNVERIFIED` flag declarations in src/jobs/sources, as
 * flag name → filename. A declaration counts only when its value is genuinely
 * true: either the literal `true` (the shared reader) or a re-export of another
 * `*_DUE_DATE_ZONE_UNVERIFIED` flag (how each Virginia locality adopts the
 * shared reader's flag). Any other right-hand side fails loud below.
 */
function flagBearingConnectorFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /export const ([A-Z0-9_]+_DUE_DATE_ZONE_UNVERIFIED) = ([^;]+);/;
  for (const file of readdirSync(SOURCES_DIR)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const text = readFileSync(join(SOURCES_DIR, file), "utf8");
    const m = text.match(re);
    if (!m) continue;
    const rhs = m[2].trim();
    if (rhs !== "true") expect(rhs).toMatch(/^[A-Z0-9_]+_DUE_DATE_ZONE_UNVERIFIED$/);
    out[m[1]] = file;
  }
  return out;
}

/** source file (no extension) → the identifiers runner.ts imports from it. */
function runnerImports(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const re = /import \{([^}]+)\} from "\.\/sources\/([a-z0-9-]+)"/g;
  for (const m of RUNNER.matchAll(re)) {
    const ids = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    out[m[2]] = (out[m[2]] ?? []).concat(ids);
  }
  return out;
}

/** registered source name → the fetchFn expression text. */
function registeredSources(): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /\{ name: "([a-z0-9_]+)", fetchFn: ([^}]+)\}/g;
  for (const m of RUNNER.matchAll(re)) out[m[1]] = m[2];
  return out;
}

describe("the pinned set is derived from the flag-bearing connectors", () => {
  test("every connector that mints a zone-unverified flag is pinned, and nothing else is", () => {
    const flags = flagBearingConnectorFiles();
    const imports = runnerImports();
    const registered = registeredSources();

    // Sanity: the flags this build was scoped to exist at all.
    const expectedFlagFiles = [
      "va-eva.ts",
      "va-loudoun.ts",
      "va-suffolk.ts",
      "va-lynchburg.ts",
      "va-charlottesville.ts",
    ].sort();
    expect(Object.values(flags).filter((f) => f !== "civicengage-bids.ts").sort()).toEqual(expectedFlagFiles);

    const derived: string[] = [];
    for (const [flagName, file] of Object.entries(flags)) {
      const stem = file.replace(/\.ts$/, "");
      const ids = imports[stem] ?? [];
      const names = Object.entries(registered)
        .filter(([, expr]) => ids.some((id) => expr.includes(id)))
        .map(([name]) => name);
      if (stem === "civicengage-bids") {
        // The SHARED reader: it mints the flag its four VA localities re-export,
        // and it is not a registered source of its own. It must stay unregistered
        // (Dayton, its other consumer, is deliberately out of scope).
        expect(flagName).toBe("CIVICENGAGE_DUE_DATE_ZONE_UNVERIFIED");
        expect(names).toEqual([]);
        continue;
      }
      // Fail loud: a flag-bearing connector that lost its runner registration.
      expect(names.length).toBeGreaterThan(0);
      derived.push(...names);
    }

    expect(derived.sort()).toEqual([...COUNTDOWN_SUPPRESSED_SOURCES].sort());
  });

  test("deliberately excluded neighbours are not pinned", () => {
    const pinned = new Set<string>(COUNTDOWN_SUPPRESSED_SOURCES);
    // Their zone rules are deliberate / unsettled elsewhere — do not add without
    // an owner ruling (see the helper's docstring).
    for (const s of [
      "oh_dayton",
      "pennbid",
      "va_fairfax_bonfire",
      "va_alexandria_bonfire",
      "va_evirginia",
      "tx_bonfire",
      "wi_vendornet",
    ]) {
      expect(pinned.has(s)).toBe(false);
      expect(isCountdownSuppressed(s)).toBe(false);
    }
  });

  test("the va_eva flag is live and asserts its own name", () => {
    expect(VA_EVA_DUE_DATE_ZONE_UNVERIFIED).toBe(true);
    expect(COUNTDOWN_SUPPRESSED_SOURCES).toContain("va_eva");
  });
});

describe("isCountdownSuppressed — fail-open", () => {
  test("every pinned source is suppressed", () => {
    for (const s of COUNTDOWN_SUPPRESSED_SOURCES) expect(isCountdownSuppressed(s)).toBe(true);
  });

  test("NULL / undefined / unknown / cased input is NOT suppressed", () => {
    for (const v of [null, undefined, "", "  ", "va_eva_x", "sam_gov", "VA_EVA", 0 as unknown]) {
      expect(isCountdownSuppressed(v as any)).toBe(false);
    }
  });

  test("surrounding whitespace on a pinned label still suppresses", () => {
    expect(isCountdownSuppressed(" va_eva ")).toBe(true);
  });
});

describe("deadlineLabel — flagged sources show the published date", () => {
  // 2026-10-15T02:00:00Z is the traffic case: a bare `Z` Eastern wall-clock whose
  // US-local rendering is 2026-10-14T22:00 — the published day is the 15th.
  const bareZ = "2026-10-15T02:00:00Z";
  const now = new Date("2026-10-10T12:00:00Z");

  test("suppressed ⇒ raw published date, no countdown", () => {
    const r = deadlineLabel({ due_date: bareZ, source: "va_eva", now });
    expect(r.suppressed).toBe(true);
    expect(r.dateText).toBe("Oct 15, 2026");
    expect(r.text).toBe("Closes Oct 15, 2026");
    expect(r.text).not.toContain("left");
    expect(r.note).toBe(ZONE_UNVERIFIED_DEADLINE_NOTE);
    // `days` is still reported (informational) but never rendered as a countdown.
    expect(r.days).toBe(5);
  });

  test("all four Virginia locality boards are suppressed", () => {
    for (const s of ["va_loudoun", "va_suffolk", "va_lynchburg", "va_charlottesville"]) {
      const r = deadlineLabel({ due_date: bareZ, source: s, now });
      expect(r.suppressed).toBe(true);
      expect(r.text).toBe("Closes Oct 15, 2026");
    }
  });

  test("the published day never shifts with the reader's zone (UTC render)", () => {
    expect(publishedDateText(bareZ)).toBe("Oct 15, 2026");
    // Same instant, explicitly UTC-formatted: the label is a property of the
    // stored value, not of where the reader is standing.
    expect(publishedDateText("2026-10-15T00:30:00Z")).toBe("Oct 15, 2026");
    expect(publishedDateText("2026-10-15")).toBe("Oct 15, 2026");
    expect(publishedDateText(new Date("2026-10-15T02:00:00Z"))).toBe("Oct 15, 2026");
  });

  test("unreadable / missing date on a flagged source falls back to the honest chip", () => {
    for (const due of [null, undefined, "", "not-a-date"]) {
      const r = deadlineLabel({ due_date: due as any, source: "va_eva", now });
      expect(r.suppressed).toBe(true);
      expect(r.text).toBe(DEADLINE_AS_PUBLISHED_LABEL);
      expect(r.dateText).toBeNull();
      expect(r.note).toBe(ZONE_UNVERIFIED_DEADLINE_NOTE);
    }
  });
});

describe("deadlineLabel — unflagged and NULL sources are byte-identical", () => {
  // Same time-of-day as every `due` below, so the ceil() deltas are integers.
  const now = new Date("2026-10-10T14:00:00Z");

  test("NULL source ⇒ unchanged countdown text", () => {
    const r = deadlineLabel({ due_date: "2026-10-15T14:00:00Z", source: null, now });
    expect(r.suppressed).toBe(false);
    expect(r.note).toBeNull();
    expect(r.text).toBe(countdownText(5));
    expect(r.text).toBe("5d left");
  });

  test("unflagged source ≡ no source, byte for byte, across the whole countdown range", () => {
    const cases: [string, number][] = [
      ["2026-10-08T14:00:00Z", -2], // Closed
      ["2026-10-10T14:00:00Z", 0], // Due today!
      ["2026-10-11T14:00:00Z", 1],
      ["2026-10-17T14:00:00Z", 7],
      ["2026-12-31T14:00:00Z", 82],
    ];
    for (const [due, days] of cases) {
      const withSource = deadlineLabel({ due_date: due, source: "sam_gov", now });
      const withoutSource = deadlineLabel({ due_date: due, source: null, now });
      expect(withSource.text).toBe(withoutSource.text);
      expect(withSource.days).toBe(days);
      expect(withSource.text).toBe(countdownText(days));
      expect(withSource.suppressed).toBe(false);
      expect(withSource.dateText).toBe(publishedDateText(due));
    }
  });

  test("an unreadable date on an unflagged source keeps its old fallback shape", () => {
    const r = deadlineLabel({ due_date: "nope", source: "sam_gov", now });
    expect(r.suppressed).toBe(false);
    expect(r.days).toBeNull();
    expect(r.text).toBe(DEADLINE_AS_PUBLISHED_LABEL);
  });

  test("daysUntilDeadline matches the surfaces' ceil()/86400000 convention", () => {
    expect(daysUntilDeadline("2026-10-10T14:00:01Z", now)).toBe(1);
    expect(daysUntilDeadline("2026-10-10T13:59:59Z", now)).toBe(0);
    expect(daysUntilDeadline("2026-10-10T14:00:00Z", now)).toBe(0);
    expect(daysUntilDeadline(null, now)).toBeNull();
    expect(daysUntilDeadline("nope", now)).toBeNull();
  });
});

describe("honesty copy", () => {
  test("the note quotes VA_EVA_COPY.timeZoneNote's promise verbatim", () => {
    const promise =
      "Contrax stores the value exactly as published, never shifted, and does not show a countdown for these rows.";
    expect(ZONE_UNVERIFIED_DEADLINE_NOTE).toContain(promise);
    expect(VA_EVA_COPY.timeZoneNote).toContain(promise);
  });

  test("the short chip never claims a countdown", () => {
    expect(DEADLINE_AS_PUBLISHED_LABEL).toBe("Deadline as published");
    expect(DEADLINE_AS_PUBLISHED_LABEL.toLowerCase()).not.toContain("left");
  });
});
