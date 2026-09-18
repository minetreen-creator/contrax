/**
 * ── NEW (owner 09-18 follow-up to PR #397) ─────────────────────────────────
 * Loader-core tests for the TWO changes the owner required before acceptance
 * closes:
 *
 *  (1) NON-BLOCKING SELF-HEAL — a homepage request must never be held to the
 *      repair timeout. Fast path = no repair work, no model call. Recovery path
 *      = bounded by a short grace (EXAMPLE_BRIEF_RECOVERY_GRACE_MS), then null
 *      (section hides) while the bounded regeneration continues so a LATER
 *      request serves the persisted brief.
 *  (2) ORIGINAL NOTICE LINK MUST RESOLVE — a candidate whose source_url does not
 *      resolve is ineligible; selection falls through to the next eligible bid;
 *      an unverifiable ("unknown") link is used only when nothing proven-live
 *      exists (never hide everything, never show a proven-dead link).
 *
 * Everything is dependency-injected (clock, generator, link checker, cooldown
 * gate) so the semantics are deterministic — no DB, no network, no model.
 */
import { describe, expect, test } from "bun:test";
import {
  evaluateExample,
  fingerprintFor,
  type ExampleBidRow,
  type ExampleEvaluation,
  type ExampleSelection,
} from "~/lib/brief-source";
import {
  EXAMPLE_BRIEF_MAX_LINK_CHECKS,
  EXAMPLE_BRIEF_RECOVERY_GRACE_DEFAULT_MS,
  EXAMPLE_BRIEF_RECOVERY_GRACE_ENV,
  EXAMPLE_BRIEF_RECOVERY_GRACE_MAX_MS,
  EXAMPLE_BRIEF_RECOVERY_GRACE_MIN_MS,
  EXAMPLE_BRIEF_LINK_BUDGET_DEFAULT_MS,
  EXAMPLE_BRIEF_LINK_BUDGET_ENV,
  __inFlightRecoveryCount,
  loadExampleBriefWithDeps,
  parseLinkBudgetMs,
  parseRecoveryGraceMs,
  pickLinkableCandidate,
  type ExampleBriefDeps,
} from "~/lib/example-brief-loader";
import type { NoticeLinkStatus } from "~/lib/notice-link-check";

const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const LIVE_URL = "https://a856-cityrecord.nyc.gov/RequestDetail/20260902028";
const OTHER_URL = "https://pennbid.bonfirehub.com/portal/?projectID=252497";

const SUMMARY = {
  summary: "Replacement of a cooling tower at an occupied hospital campus.",
  mandatory_requirements: [{ text: "Bidders must attend the mandatory meeting", source: "quote" }],
  key_milestones: [{ event: "bid due date", date: "2026-11-05", source: "quote" }],
  trade_category: "HVAC",
  red_flags: [],
};

function row(over: Partial<ExampleBidRow> = {}): ExampleBidRow {
  return {
    id: 134946,
    title: "Harlem Hospital_Ron Brown Cooling Tower Replacement",
    agency: "NYC Health + Hospitals",
    description: "Cooling tower replacement.",
    category: "construction",
    set_aside: null,
    due_date: "2026-11-05T11:00:00.000Z",
    estimated_value: null,
    source_url: LIVE_URL,
    location: "New York, NY",
    naics_code: "238220",
    updated_at: "2026-09-10T15:50:45.552Z",
    latest_amendment_at: null,
    ai_summary: SUMMARY,
    ai_summary_at: "2026-09-14T17:07:42.146Z",
    ai_summary_source_hash: null,
    ai_summary_schema_version: 2,
    ai_summary_model: "gpt-4o-mini",
    ...over,
  } as ExampleBidRow;
}

/** Evaluate a row with a CURRENT (matching) fingerprint ⇒ fully eligible. */
async function evaluated(over: Partial<ExampleBidRow> = {}): Promise<ExampleEvaluation> {
  const r = row(over);
  const fp = await fingerprintFor(r);
  return evaluateExample({ row: { ...r, ai_summary_source_hash: fp }, currentFingerprint: fp }, NOW);
}

/** Evaluate a row whose cached brief is STALE (fingerprint mismatch). */
async function staleEvaluated(over: Partial<ExampleBidRow> = {}): Promise<ExampleEvaluation> {
  const r = row(over);
  return evaluateExample(
    { row: { ...r, ai_summary_source_hash: "0".repeat(64) }, currentFingerprint: await fingerprintFor(r) },
    NOW,
  );
}

function selection(
  eligible: ExampleEvaluation[] = [],
  staleEligible: ExampleEvaluation[] = [],
): ExampleSelection {
  return { best: eligible[0] ?? null, eligible, staleEligible, all: [...eligible, ...staleEligible] };
}

interface Harness {
  deps: ExampleBriefDeps;
  regenCalls: number;
  markCalls: Array<[number, number]>;
  setSelection: (s: ExampleSelection) => void;
  logEvents: Array<Record<string, unknown>>;
}

function harness(opts: {
  initialSelection: ExampleSelection;
  checkLink?: (url: string, timeoutMs: number) => Promise<NoticeLinkStatus>;
  regenerate?: (r: ExampleBidRow) => Promise<boolean>;
  repairAllowed?: (bidId: number, now: number) => boolean;
  graceMs?: number;
  maxLinkChecks?: number;
}): Harness {
  let current = opts.initialSelection;
  const state: Harness = {
    regenCalls: 0,
    markCalls: [],
    logEvents: [],
    setSelection: (s) => {
      current = s;
    },
    deps: {
      now: () => Date.now(),
      loadSelection: async () => current,
      checkLink: opts.checkLink ?? (async () => "live"),
      regenerate: async (r) => {
        state.regenCalls += 1;
        return opts.regenerate ? opts.regenerate(r) : true;
      },
      repairAllowed: opts.repairAllowed ?? (() => true),
      markRepairAttempt: (bidId, now) => {
        state.markCalls.push([bidId, now]);
      },
      graceMs: opts.graceMs ?? 400,
      linkTimeoutMs: 4_500,
      maxLinkChecks: opts.maxLinkChecks ?? EXAMPLE_BRIEF_MAX_LINK_CHECKS,
      log: (event) => state.logEvents.push(event),
    },
  };
  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// (1) NON-BLOCKING SELF-HEAL
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW (1) non-blocking self-heal — fast path", () => {
  test("a fresh persisted candidate is served with NO repair work and no model call", async () => {
    const eligible = await evaluated();
    const h = harness({ initialSelection: selection([eligible]) });
    const started = Date.now();
    const res = await loadExampleBriefWithDeps(h.deps);
    const elapsed = Date.now() - started;

    expect(res.brief?.id).toBe(134946);
    expect(res.path).toBe("fresh");
    expect(res.repairTargetId).toBeNull();
    expect(h.regenCalls).toBe(0);
    expect(h.logEvents).toHaveLength(0); // nothing to say: ordinary request
    expect(elapsed).toBeLessThan(500);
  });

  test("the fast path still performs exactly ONE link probe per candidate", async () => {
    const eligible = await evaluated();
    const urls: string[] = [];
    const h = harness({
      initialSelection: selection([eligible]),
      checkLink: async (url) => {
        urls.push(url);
        return "live";
      },
    });
    await loadExampleBriefWithDeps(h.deps);
    expect(urls).toEqual([LIVE_URL]);
    expect(h.regenCalls).toBe(0);
  });
});

describe("NEW (1) non-blocking self-heal — recovery is bounded by the grace", () => {
  test("a generator slower than the grace returns null WITHOUT waiting past it, and keeps running", async () => {
    const stale = await staleEvaluated({ id: 22, source_url: OTHER_URL });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const h = harness({
      initialSelection: selection([], [stale]),
      graceMs: 80,
      regenerate: async () => {
        await gate;
        return true;
      },
    });

    const started = Date.now();
    const res = await loadExampleBriefWithDeps(h.deps);
    const elapsed = Date.now() - started;

    expect(res.brief).toBeNull();
    expect(res.path).toBe("deferred");
    expect(res.repairTargetId).toBe(22);
    expect(h.regenCalls).toBe(1);
    // Waited the grace, not the generator (which is still pending forever).
    expect(elapsed).toBeGreaterThanOrEqual(60);
    expect(elapsed).toBeLessThan(900);
    // The invalidated cache is not re-attempted on every request.
    expect(h.markCalls.map(([id]) => id)).toEqual([22]);
    // The bounded regeneration is still tracked in the background.
    expect(__inFlightRecoveryCount()).toBe(1);

    // Convergence: once the background attempt persists, the NEXT request is a
    // plain fast-path hit (still inside the cooldown ⇒ no second model call).
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(__inFlightRecoveryCount()).toBe(0);

    const fresh = await evaluated({ id: 22, source_url: OTHER_URL });
    h.setSelection(selection([fresh]));
    const second = await loadExampleBriefWithDeps(h.deps);
    expect(second.brief?.id).toBe(22);
    expect(second.path).toBe("fresh");
    expect(h.regenCalls).toBe(1); // the cooldown gate was not consulted for a fast path
  });

  test("a fast generator persists and the SAME request serves the brief (inside the grace)", async () => {
    const stale = await staleEvaluated({ id: 33, source_url: OTHER_URL });
    const fresh = await evaluated({ id: 33, source_url: OTHER_URL });
    const h = harness({
      initialSelection: selection([], [stale]),
      graceMs: 1_000,
      regenerate: async () => {
        h.setSelection(selection([fresh]));
        return true;
      },
    });

    const res = await loadExampleBriefWithDeps(h.deps);
    expect(res.path).toBe("recovered");
    expect(res.brief?.id).toBe(33);
    expect(h.regenCalls).toBe(1);
    expect(res.waitedMs).toBeLessThan(1_000);
  });

  test("a template-filling failure inside the grace hides the section without a deferred wait", async () => {
    const stale = await staleEvaluated({ id: 44, source_url: OTHER_URL });
    const h = harness({
      initialSelection: selection([], [stale]),
      graceMs: 1_000,
      regenerate: async () => false,
    });
    const started = Date.now();
    const res = await loadExampleBriefWithDeps(h.deps);

    expect(res.brief).toBeNull();
    expect(res.path).toBe("none");
    expect(Date.now() - started).toBeLessThan(900);
  });

  test("the cooldown gate prevents a second attempt (one repair per bid per window)", async () => {
    const stale = await staleEvaluated({ id: 55, source_url: OTHER_URL });
    const h = harness({
      initialSelection: selection([], [stale]),
      repairAllowed: () => false,
      graceMs: 1_000,
    });
    const started = Date.now();
    const res = await loadExampleBriefWithDeps(h.deps);

    expect(res.brief).toBeNull();
    expect(res.path).toBe("cooldown");
    expect(h.regenCalls).toBe(0);
    expect(h.markCalls).toHaveLength(0);
    expect(Date.now() - started).toBeLessThan(500); // never waits when it cannot help
  });

  test("nothing eligible and nothing stale ⇒ null immediately (section hides)", async () => {
    const h = harness({ initialSelection: selection([], []) });
    const res = await loadExampleBriefWithDeps(h.deps);
    expect(res.brief).toBeNull();
    expect(res.path).toBe("none");
    expect(h.regenCalls).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (2) ORIGINAL NOTICE LINK MUST RESOLVE
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW (2) a dead original-notice link is not displayable", () => {
  test("a dead-link candidate is SKIPPED when a working-link candidate exists", async () => {
    const dead = await evaluated({ id: 61, source_url: LIVE_URL });
    const live = await evaluated({ id: 62, source_url: OTHER_URL });
    const h = harness({
      initialSelection: selection([dead, live]),
      checkLink: async (url) => (url === LIVE_URL ? "dead" : "live"),
    });

    const res = await loadExampleBriefWithDeps(h.deps);
    expect(res.brief?.id).toBe(62);
    expect(res.path).toBe("fresh");
    expect(res.deadLinkIds).toEqual([61]);
    expect(res.linkChecks).toBe(2);
  });

  test("all-proven-dead candidates ⇒ null (never a link that 404s)", async () => {
    const a = await evaluated({ id: 71 });
    const b = await evaluated({ id: 72, source_url: OTHER_URL });
    const h = harness({ initialSelection: selection([a, b]), checkLink: async () => "dead" });

    const res = await loadExampleBriefWithDeps(h.deps);
    expect(res.brief).toBeNull();
    expect(res.path).toBe("none");
    expect(res.deadLinkIds).toEqual([71, 72]);
  });

  test("an UNVERIFIABLE link is used when nothing is proven live (never hide everything)", async () => {
    const uncertain = await evaluated({ id: 81, source_url: OTHER_URL });
    const h = harness({
      initialSelection: selection([uncertain]),
      checkLink: async () => "unknown",
    });

    const res = await loadExampleBriefWithDeps(h.deps);
    expect(res.brief?.id).toBe(81);
    expect(res.path).toBe("fresh");
    expect(res.uncertainLinkIds).toEqual([81]);
    expect(res.deadLinkIds).toEqual([]);
  });

  test("a proven-live candidate outranks an earlier unverifiable one", async () => {
    const uncertain = await evaluated({ id: 91, source_url: LIVE_URL });
    const live = await evaluated({ id: 92, source_url: OTHER_URL });
    const h = harness({
      initialSelection: selection([uncertain, live]),
      checkLink: async (url) => (url === LIVE_URL ? "unknown" : "live"),
    });

    const res = await loadExampleBriefWithDeps(h.deps);
    expect(res.brief?.id).toBe(92);
    expect(res.uncertainLinkIds).toEqual([91]);
  });

  test("the link pass is bounded (first N ranked candidates only)", async () => {
    const rows = await Promise.all(
      [101, 102, 103, 104, 105].map((id) => evaluated({ id })),
    );
    const h = harness({
      initialSelection: selection(rows),
      checkLink: async () => "dead",
      maxLinkChecks: EXAMPLE_BRIEF_MAX_LINK_CHECKS,
    });

    const res = await loadExampleBriefWithDeps(h.deps);
    expect(res.brief).toBeNull();
    expect(res.linkChecks).toBe(EXAMPLE_BRIEF_MAX_LINK_CHECKS);
    expect(res.deadLinkIds).toHaveLength(EXAMPLE_BRIEF_MAX_LINK_CHECKS);
  });

  test("a stale candidate with a dead link is NOT regenerated (no model call for nothing)", async () => {
    const stale = await staleEvaluated({ id: 111, source_url: LIVE_URL });
    const h = harness({
      initialSelection: selection([], [stale]),
      checkLink: async () => "dead",
    });

    const res = await loadExampleBriefWithDeps(h.deps);
    expect(res.brief).toBeNull();
    expect(res.path).toBe("none");
    expect(h.regenCalls).toBe(0);
    expect(h.markCalls).toHaveLength(0);
  });

  test("pickLinkableCandidate reports the probe count and skips blank URLs", async () => {
    const blank = await evaluated({ id: 121, source_url: "   " });
    const live = await evaluated({ id: 122, source_url: OTHER_URL });
    const pick = await pickLinkableCandidate([blank, live], {
      now: () => Date.now(),
      linkTimeoutMs: 4_500,
      checkLink: async () => "live",
    });
    expect(pick.chosen?.row.id).toBe(122);
    expect(pick.checked).toBe(1);
    expect(pick.deadLinkIds).toEqual([121]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Config surface
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW (1) recovery grace is env-configurable like the GRANTS flag", () => {
  test("default, override, and clamping", () => {
    expect(EXAMPLE_BRIEF_RECOVERY_GRACE_DEFAULT_MS).toBe(2_500);
    expect(parseRecoveryGraceMs({})).toBe(EXAMPLE_BRIEF_RECOVERY_GRACE_DEFAULT_MS);
    expect(parseRecoveryGraceMs({ [EXAMPLE_BRIEF_RECOVERY_GRACE_ENV]: "3000" })).toBe(3_000);
    expect(parseRecoveryGraceMs({ [EXAMPLE_BRIEF_RECOVERY_GRACE_ENV]: " 2000 " })).toBe(2_000);
    expect(parseRecoveryGraceMs({ [EXAMPLE_BRIEF_RECOVERY_GRACE_ENV]: "abc" })).toBe(
      EXAMPLE_BRIEF_RECOVERY_GRACE_DEFAULT_MS,
    );
    expect(parseRecoveryGraceMs({ [EXAMPLE_BRIEF_RECOVERY_GRACE_ENV]: "0" })).toBe(
      EXAMPLE_BRIEF_RECOVERY_GRACE_DEFAULT_MS,
    );
    expect(parseRecoveryGraceMs({ [EXAMPLE_BRIEF_RECOVERY_GRACE_ENV]: "-5" })).toBe(
      EXAMPLE_BRIEF_RECOVERY_GRACE_DEFAULT_MS,
    );
    expect(parseRecoveryGraceMs({ [EXAMPLE_BRIEF_RECOVERY_GRACE_ENV]: "10" })).toBe(
      EXAMPLE_BRIEF_RECOVERY_GRACE_MIN_MS,
    );
    expect(parseRecoveryGraceMs({ [EXAMPLE_BRIEF_RECOVERY_GRACE_ENV]: "999999" })).toBe(
      EXAMPLE_BRIEF_RECOVERY_GRACE_MAX_MS,
    );
    // Never anywhere near the old 25 s ceiling.
    expect(EXAMPLE_BRIEF_RECOVERY_GRACE_MAX_MS).toBeLessThan(25_000);
  });

  test("link budget parsing", () => {
    expect(parseLinkBudgetMs({})).toBe(EXAMPLE_BRIEF_LINK_BUDGET_DEFAULT_MS);
    expect(parseLinkBudgetMs({ [EXAMPLE_BRIEF_LINK_BUDGET_ENV]: "1000" })).toBe(1_000);
    expect(parseLinkBudgetMs({ [EXAMPLE_BRIEF_LINK_BUDGET_ENV]: "oops" })).toBe(
      EXAMPLE_BRIEF_LINK_BUDGET_DEFAULT_MS,
    );
  });
});
