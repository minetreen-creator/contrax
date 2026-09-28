/**
 * RADAR SCAN DIAGNOSTICS — the owner's spec (2026-09-28), pinned.
 *
 * Deterministic, network-free, database-free: every input is a literal, and the
 * two route/panel assertions read the SHIPPED SOURCE (the same technique as
 * src/lib/funnel-ux.test.ts and tests/funnel-ux-radar-render.test.tsx). No
 * mock.module anywhere — this file needs no module substitution at all
 * (skill: contrax-bun-mock-module-leak).
 *
 * WHAT IS PINNED, in order of how much damage getting it wrong would do:
 *   1. THE SCAN COHORT IS DECIDED BY THE SHIPPED TERNARY, not by a copy of it:
 *      the expression is lifted out of src/routes/radar.tsx and evaluated for
 *      all four combinations (signed-in × matches-found). Renaming a cohort
 *      event, swapping two arms or dropping the zero case fails here.
 *   2. THE WIRE NAMES ARE UNIQUE AND EXACT — the four new names, and the five
 *      pre-existing results-screen names this release only starts counting
 *      (renaming one would orphan rows already in `funnel_events`).
 *   3. `emptyRadarConversionFunnel()` ZERO-FILLS EVERY KEY, so the admin panel
 *      never has to tell "no such diagnostic" from "not collected yet".
 *   4. THE ADMIN QUERY SHAPE: independent statement, same window + same
 *      bot/QA/admin exclusions as the stage counts, GROUP BY event_name,
 *      DISTINCT visitors, fail-soft try/catch, diagnostics in the payload.
 *   5. THE PANEL COPY, byte for byte, and that it reads the diagnostics map.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  RADAR_CONVERSION_FUNNEL_STAGES,
  RADAR_DIAGNOSTIC_EVENTS,
  emptyRadarConversionFunnel,
} from "./radar-conversion-funnel";

const REPO_SRC = join(import.meta.dir, "..");
const RADAR_ROUTE = readFileSync(join(REPO_SRC, "routes", "radar.tsx"), "utf8");
const FUNNEL_API = readFileSync(
  join(REPO_SRC, "routes", "api", "admin", "radar-conversion-funnel.ts"),
  "utf8",
);
const ADMIN_PANEL = readFileSync(join(REPO_SRC, "routes", "admin", "index.tsx"), "utf8");

const ALL_DIAGNOSTIC_KEYS = Object.keys(RADAR_DIAGNOSTIC_EVENTS);

/** The four NEW cohort names, in the owner's cohort order. */
const COHORT_KEYS = [
  "anonymousMatches",
  "anonymousZero",
  "signedInMatches",
  "signedInZero",
] as const;
/** The five PRE-EXISTING results-screen events this release starts counting. */
const PRE_EXISTING_KEYS = [
  "anonymousResultsViewed",
  "lockedShown",
  "lockedClicked",
  "smallCtaShown",
  "smallCtaClicked",
] as const;

// ── 1. the cohort decision, evaluated from the shipped source ────────────────
/**
 * Lift the cohort ternary out of the Radar scan-success path. The anchor is the
 * `trackEvent(` call whose FIRST argument starts with `getTrackingUser()` —
 * there is exactly one such call in the file, and the lazy body stops at the
 * `, input.cert);` that closes it (so the pre-existing radar_scan_complete call
 * above and the radar_nudge_shown call below are never captured).
 */
function shippedCohortExpression(): string {
  const match = RADAR_ROUTE.match(/trackEvent\(\s*(getTrackingUser\(\)[\s\S]*?)\s*,\s*input\.cert\);/);
  if (!match) throw new Error("the radar cohort trackEvent call was not found in radar.tsx");
  return match[1]!.trim();
}

/** The shipped expression, as a real function — evaluated, never re-typed. */
const cohortEvent = new Function(
  "getTrackingUser",
  "res",
  `return (${shippedCohortExpression()});`,
) as (getTrackingUser: () => unknown, res: { matches: unknown[] }) => string;

const signedIn = () => ({ id: 7 });
const anonymous = () => null;

describe("radar scan cohort — decided by the SHIPPED expression", () => {
  test("the anchor is unique and the expression is the owner's ternary", () => {
    const expr = shippedCohortExpression();
    expect(expr.startsWith("getTrackingUser() ?")).toBe(true);
    expect(expr).toContain("res.matches.length");
    // The `, input.cert);` terminator is consumed by the anchor, never lifted.
    expect(expr).not.toContain("input.cert");
    // Exactly one cohort call exists — the pre-existing events are untouched.
    expect(RADAR_ROUTE.split("getTrackingUser() ? (res.matches.length").length - 1).toBe(1);
  });

  test("anonymous + matches → anonymousMatches", () => {
    expect(cohortEvent(anonymous, { matches: [{ id: 1 }] })).toBe(
      RADAR_DIAGNOSTIC_EVENTS.anonymousMatches,
    );
  });

  test("anonymous + ZERO matches → anonymousZero (never the matches arm)", () => {
    expect(cohortEvent(anonymous, { matches: [] })).toBe(RADAR_DIAGNOSTIC_EVENTS.anonymousZero);
  });

  test("signed in + matches → signedInMatches", () => {
    expect(cohortEvent(signedIn, { matches: [{ id: 1 }, { id: 2 }] })).toBe(
      RADAR_DIAGNOSTIC_EVENTS.signedInMatches,
    );
  });

  test("signed in + ZERO matches → signedInZero", () => {
    expect(cohortEvent(signedIn, { matches: [] })).toBe(RADAR_DIAGNOSTIC_EVENTS.signedInZero);
  });

  test("the four arms are four DIFFERENT events (no arm collapses into another)", () => {
    const arms = [
      cohortEvent(anonymous, { matches: [{}] }),
      cohortEvent(anonymous, { matches: [] }),
      cohortEvent(signedIn, { matches: [{}] }),
      cohortEvent(signedIn, { matches: [] }),
    ];
    expect(new Set(arms).size).toBe(4);
    expect(arms).toEqual(COHORT_KEYS.map((k) => RADAR_DIAGNOSTIC_EVENTS[k]));
  });

  test("it fires on the SAME success path as radar_scan_complete, right below it", () => {
    const complete = RADAR_ROUTE.indexOf('trackEvent("radar_scan_complete", input.cert);');
    const cohort = RADAR_ROUTE.indexOf("trackEvent(getTrackingUser()");
    expect(complete).toBeGreaterThan(-1);
    expect(cohort).toBeGreaterThan(complete);
    // Nothing but the new comment block sits between them.
    const completeCall = 'trackEvent("radar_scan_complete", input.cert);';
    const between = RADAR_ROUTE.slice(complete + completeCall.length, cohort);
    expect(between).toContain("Radar scan diagnostics");
    expect(between.includes("trackEvent(")).toBe(false);
  });
});

// ── 2. the wire names ────────────────────────────────────────────────────────
describe("RADAR_DIAGNOSTIC_EVENTS — the exact wire names", () => {
  test("every value is unique", () => {
    const values = Object.values(RADAR_DIAGNOSTIC_EVENTS);
    expect(new Set(values).size).toBe(values.length);
  });

  test("the four cohort names are the owner's, exactly", () => {
    expect(RADAR_DIAGNOSTIC_EVENTS.anonymousMatches).toBe("radar_scan_anonymous_matches");
    expect(RADAR_DIAGNOSTIC_EVENTS.anonymousZero).toBe("radar_scan_anonymous_zero");
    expect(RADAR_DIAGNOSTIC_EVENTS.signedInMatches).toBe("radar_scan_signed_in_matches");
    expect(RADAR_DIAGNOSTIC_EVENTS.signedInZero).toBe("radar_scan_signed_in_zero");
  });

  test("the five pre-existing names are the ones radar.tsx already tracks", () => {
    expect(RADAR_DIAGNOSTIC_EVENTS.anonymousResultsViewed).toBe("radar_results_viewed");
    expect(RADAR_DIAGNOSTIC_EVENTS.lockedShown).toBe("radar_results_unlock_shown");
    expect(RADAR_DIAGNOSTIC_EVENTS.lockedClicked).toBe("radar_results_unlock_clicked");
    expect(RADAR_DIAGNOSTIC_EVENTS.smallCtaShown).toBe("radar_results_cta_shown");
    expect(RADAR_DIAGNOSTIC_EVENTS.smallCtaClicked).toBe("radar_results_cta_clicked");
    // …and each one is really tracked there, so none of them is a typo.
    for (const key of PRE_EXISTING_KEYS) {
      const name = RADAR_DIAGNOSTIC_EVENTS[key];
      expect(RADAR_ROUTE).toContain(`trackEvent("${name}"`);
    }
  });

  test("the diagnostic keys are exactly the 4 cohorts + the 5 surfaces", () => {
    expect(ALL_DIAGNOSTIC_KEYS).toEqual([...COHORT_KEYS, ...PRE_EXISTING_KEYS]);
  });

  test("the 9-stage funnel definition is UNCHANGED by this release", () => {
    expect(RADAR_CONVERSION_FUNNEL_STAGES.length).toBe(9);
    expect(RADAR_CONVERSION_FUNNEL_STAGES.map((s) => s.stage)).toEqual([
      "qualified",
      "radar_started",
      "radar_completed",
      "results_viewed",
      "unlock_shown",
      "unlock_clicked",
      "signup",
      "activated",
      "paid",
    ]);
  });
});

// ── 3. the zero-filled diagnostics map ───────────────────────────────────────
describe("emptyRadarConversionFunnel — diagnostics are always zero-filled", () => {
  test("ALL keys exist and read 0", () => {
    const range = 30;
    const result = emptyRadarConversionFunnel(range);
    expect(Object.keys(result.diagnostics).sort()).toEqual(
      Object.keys(RADAR_DIAGNOSTIC_EVENTS).sort(),
    );
    for (const key of Object.keys(RADAR_DIAGNOSTIC_EVENTS)) {
      expect(result.diagnostics[key]).toBe(0);
    }
    expect(Object.values(result.diagnostics)).toEqual(new Array(ALL_DIAGNOSTIC_KEYS.length).fill(0));
  });

  test("a zeroed diagnostic map is honest 0, never undefined (the panel shows 0)", () => {
    const result = emptyRadarConversionFunnel(30);
    for (const key of ALL_DIAGNOSTIC_KEYS) {
      expect(Number.isFinite(result.diagnostics[key])).toBe(true);
    }
  });

  test("the pre-existing shape of the empty funnel is untouched", () => {
    const result = emptyRadarConversionFunnel(7);
    expect(result.rangeDays).toBe(7);
    expect(result.funnel.length).toBe(9);
    expect(result.funnel[0]!.count).toBe(0);
    expect(result.funnel[0]!.dropOffPct).toBeNull();
    expect(result.funnel[1]!.dropOffPct).toBe(0);
    // The two timestamps still describe the requested window.
    const span = new Date(result.to).getTime() - new Date(result.from).getTime();
    expect(Math.round(span / 86400000)).toBe(7);
  });
});

// ── 4. the admin query shape ────────────────────────────────────────────────
describe("the admin diagnostics query — independent, same filters, fail-soft", () => {
  /** The diagnostics block alone, whitespace-normalized. */
  const block = (() => {
    const start = FUNNEL_API.indexOf("// ── Radar scan diagnostics");
    const end = FUNNEL_API.indexOf("// ── Consecutive drop-off");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return FUNNEL_API.slice(start, end).replace(/\s+/g, " ");
  })();

  test("it selects the diagnostic events and counts DISTINCT visitors, grouped", () => {
    expect(block).toContain("const diagnosticEvents = Object.values(RADAR_DIAGNOSTIC_EVENTS);");
    expect(block).toContain("SELECT event_name, COUNT(DISTINCT visitor_id) AS n FROM funnel_events");
    expect(block).toContain("event_name = ANY(${diagnosticEvents})");
    expect(block).toContain("GROUP BY event_name");
    expect(block).toContain("visitor_id IS NOT NULL AND visitor_id <> ''");
  });

  test("it reuses the SAME window + bot/QA/admin filters already in scope", () => {
    expect(block).toContain("created_at >= ${fromIso}");
    expect(block).toContain("${sql().unsafe(HUMAN_FILTER)}");
    expect(block).toContain("${sql().unsafe(qaFilter)} AND ${sql().unsafe(adminFilter)}");
  });

  test("it is INDEPENDENT of the stage maths and fail-soft", () => {
    expect(block).toContain("try {");
    expect(block).toContain("} catch (err) {");
    expect(block).toContain(
      'console.error("[api/admin/radar-conversion-funnel] diagnostics failed (continuing):", err);',
    );
    // The stage maths is untouched: the nine stages + their filters still there.
    expect(FUNNEL_API).toContain("for (const s of RADAR_CONVERSION_FUNNEL_STAGES) counts[s.stage] = 0;");
    expect(FUNNEL_API).toContain('counts.paid = paidCount;');
    expect(FUNNEL_API).toContain("conversionDropOff(counts[s.stage] ?? 0, prev)");
  });

  test("an unknown event_name can never inject a key into the payload", () => {
    expect(block).toContain("if (key in result.diagnostics) result.diagnostics[key] = Number(row.n ?? 0);");
  });

  test("the diagnostics map is returned in the payload (and the empty fallback carries it too)", () => {
    expect(FUNNEL_API).toContain("diagnostics: result.diagnostics,");
    expect(FUNNEL_API).toContain("return Response.json(emptyRadarConversionFunnel(30));");
    // The default-per-key comes from the zero-filled map, never from a literal.
    expect(FUNNEL_API).not.toContain("diagnostics: {}");
  });
});

// ── 5. the admin panel ──────────────────────────────────────────────────────
describe("the admin panel — owner copy + the four cohorts", () => {
  /** The panel's own JSX: from its heading down to the next section's comment. */
  const panel = (() => {
    const start = ADMIN_PANEL.indexOf(">Radar scan diagnostics \u00b7 30 days</h2>");
    const end = ADMIN_PANEL.indexOf("BID SCOUT FUNNEL — separate assisted-service path");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return ADMIN_PANEL.slice(start, end);
  })();
  /** The four-cohort table that feeds it. */
  const cohortsTable = (() => {
    const start = ADMIN_PANEL.indexOf("const RADAR_SCAN_COHORTS");
    const end = ADMIN_PANEL.indexOf("];", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return ADMIN_PANEL.slice(start, end);
  })();

  test("the heading is the owner's, byte for byte", () => {
    expect(ADMIN_PANEL).toContain(">Radar scan diagnostics \u00b7 30 days</h2>");
  });

  test("the four cohort labels are the owner's, in the owner's order", () => {
    const labels = ["Anonymous \u00b7 matches", "Anonymous \u00b7 zero matches", "Signed in \u00b7 matches", "Signed in \u00b7 zero matches"];
    const at = labels.map((l) => cohortsTable.indexOf(`label: "${l}"`));
    for (let i = 0; i < at.length; i += 1) expect(at[i], `missing label ${labels[i]}`).toBeGreaterThan(-1);
    for (let i = 1; i < at.length; i += 1) expect(at[i]!).toBeGreaterThan(at[i - 1]!);
    // …mapped to the diagnostics keys, and only those four.
    for (const key of COHORT_KEYS) expect(cohortsTable).toContain(`key: "${key}"`);
    expect(cohortsTable.split('key: "').length - 1).toBe(4);
  });

  test("the three summary lines use the owner's wording", () => {
    expect(panel).toContain("Anonymous results viewed:");
    expect(panel).toContain("More than 3 matches \u00b7 free signup card:");
    expect(panel).toContain("1\u20133 matches \u00b7 free signup CTA:");
    // Each line shows a "shown" × "clicked" pair from the diagnostics map.
    expect(panel).toContain("radarConv.diagnostics?.lockedShown ?? 0");
    expect(panel).toContain("radarConv.diagnostics?.lockedClicked ?? 0");
    expect(panel).toContain("radarConv.diagnostics?.smallCtaShown ?? 0");
    expect(panel).toContain("radarConv.diagnostics?.smallCtaClicked ?? 0");
    expect(panel).toContain("radarConv.diagnostics?.anonymousResultsViewed ?? 0");
  });

  test("every cohort number comes from the diagnostics map with a 0 default", () => {
    expect(panel).toContain("{radarConv.diagnostics?.[c.key] ?? 0}");
  });

  test("the honest note says the cohorts start with this release and may overlap", () => {
    expect(panel).toContain("begin collecting with this release");
    expect(panel).toContain("distinct visitors per event and may overlap");
  });

  test("it sits BELOW the Radar Conversion funnel block and above Bid Scout", () => {
    const funnel = ADMIN_PANEL.indexOf("Radar Conversion (09-07 sprint)");
    const diag = ADMIN_PANEL.indexOf(">Radar scan diagnostics \u00b7 30 days</h2>");
    const bidScout = ADMIN_PANEL.indexOf("BID SCOUT FUNNEL — separate assisted-service path");
    expect(funnel).toBeGreaterThan(-1);
    expect(diag).toBeGreaterThan(funnel);
    expect(bidScout).toBeGreaterThan(diag);
  });

  test("the existing funnel panel copy is untouched", () => {
    expect(ADMIN_PANEL).toContain("Drop-off % is lost vs. the previous stage; 0 when the previous stage is 0.");
    expect(ADMIN_PANEL).toContain("Signup \u2192 Activated \u2192 Paid — separate from the 7-stage Radar-Leads funnel");
  });
});
