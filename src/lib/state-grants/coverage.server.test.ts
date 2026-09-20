/**
 * Unit tests — STATE GRANT COVERAGE, SERVER HALF (part 2, re-cut for the
 * corrected model; owner R1 2026-09-19).
 *
 * The registry half of the coverage payload is DERIVED (registry.ts), so these
 * tests assert the real ladder as the code derives it — Virginia, the five P3
 * batch-1 states (AZ, DE, HI, PA, RI) and the three NATIONWIDE batch-1 states
 * (CA, KS, WA) and the five NATIONWIDE batch-2 states (AR, CO, MN, ND, NM)
 * `limited`, and 19 states `unavailable` (every jurisdiction but D.C.) — while the store
 * half is injected, so the payload shape and the fail-closed 500 need no database:
 *   * VA must NEVER be described as connected or statewide;
 *   * the payload must never claim nationwide coverage;
 *   * the ladder values are exactly the owner's four, in order;
 *   * a store failure must produce a 500 with no partial payload.
 */
import { describe, expect, test } from "bun:test";
import {
  STATE_GRANTS_COVERAGE_URL,
  buildStateGrantCoverage,
  coverageHeadline,
  coverageLadder,
  type StateGrantCoverageDeps,
} from "~/lib/state-grants/coverage.server";
import {
  STATE_CODES,
  coverageCounts,
  coverageHeadlineFor,
  isDcValidated,
} from "~/lib/state-grants/registry";

const NOW = new Date("2026-09-19T12:00:00Z");

function emptyCounts() {
  return { open: 0, upcoming: 0, rolling: 0, closed: 0, unverified: 0, total: 0 };
}

/** Deps that serve fixed facts, so the payload can be asserted offline. */
function deps(
  overrides: Partial<StateGrantCoverageDeps> = {},
): StateGrantCoverageDeps {
  return {
    stateGrantEffectiveStatusCounts: (async () => ({
      ...emptyCounts(),
      open: 2,
      rolling: 2,
      closed: 3,
      unverified: 1,
      total: 8,
    })) as unknown as StateGrantCoverageDeps["stateGrantEffectiveStatusCounts"],
    latestSuccessfulStateSync: (async () => "2026-09-19T12:00:02.000Z") as unknown as StateGrantCoverageDeps["latestSuccessfulStateSync"],
    listStateSyncRuns: (async () => [
      {
        id: "run-1",
        stateCode: "VA",
        startedAt: "2026-09-19T12:00:00.000Z",
        finishedAt: "2026-09-19T12:00:02.000Z",
        status: "ok" as const,
        fetchedCount: 8,
        insertedCount: 8,
        updatedCount: 0,
        error: null,
      },
    ]) as unknown as StateGrantCoverageDeps["listStateSyncRuns"],
    ...overrides,
  };
}

function payloadOf(outcome: Awaited<ReturnType<typeof buildStateGrantCoverage>>) {
  if (outcome.status !== 200) throw new Error(`expected 200, got ${outcome.status}`);
  return outcome.body;
}

describe("the ladder", () => {
  test("is the owner's four tiers, strongest first", () => {
    expect(coverageLadder().map((r) => r.status)).toEqual([
      "connected",
      "curated",
      "limited",
      "unavailable",
    ]);
    for (const rung of coverageLadder()) {
      expect(rung.label.length).toBeGreaterThan(0);
    }
  });

  test("the headline counts 50 STATES plus D.C. and never says connected", () => {
    const counts = coverageCounts();
    const headline = coverageHeadline(counts);
    // D.C. is a jurisdiction, not a state (owner copy rule 2026-09-20): the
    // headline counts it out of the 50 and names it on its own. Today the
    // derived registry holds D.C. at a validated tier, so the suffix is present.
    expect(isDcValidated()).toBe(true);
    expect(headline).toContain(
      `${counts.validated - 1} of 50 states validated, plus Washington, D.C.`,
    );
    expect(headline).toContain(`${counts.validated} limited`);
    expect(headline).toContain("0 connected");
    // The owner's rule, stated as a copy guard: never "51 states".
    expect(headline).not.toContain("51 states");
    expect(headline).not.toContain("of 51");
    expect(headline.toLowerCase()).not.toContain("nationwide");
  });
  test("with no validated D.C. the count is every validated state and no suffix prints", () => {
    // Deterministic branch check, independent of today's registry: the shared
    // generator is the single source of the wording for both callers.
    const counts = { ...coverageCounts(), total: 50, connected: 0, curated: 0, limited: 4, validated: 4, unavailable: 46 };
    expect(coverageHeadlineFor(counts, false)).toBe(
      "State grant coverage: 4 of 50 states validated (0 connected, 0 curated, 4 limited)",
    );
    expect(coverageHeadlineFor(counts, true)).toBe(
      "State grant coverage: 3 of 50 states validated, plus Washington, D.C. (0 connected, 0 curated, 4 limited)",
    );
    expect(coverageHeadlineFor(counts, true)).not.toContain("51 states");
  });
});

describe("the coverage payload", () => {
  test("lists all 51 states and details every validated state", async () => {
    const payload = payloadOf(await buildStateGrantCoverage(NOW, deps()));
    expect(payload.states.length).toBe(STATE_CODES.length);
    expect(payload.states.length).toBe(51);
    expect(payload.counts.validated).toBe(36);
    expect(payload.counts.unavailable).toBe(15);
    expect(payload.validated.map((v) => v.stateCode)).toEqual(["AL", "AZ", "AR", "CA", "CO", "DE", "DC", "FL", "HI", "IL", "IN", "IA", "KS", "KY", "ME", "MD", "MN", "MT", "NE", "NV", "NH", "NJ", "NM", "ND", "OK", "PA", "RI", "SC", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WY"]);
    for (const state of payload.validated) {
      // Each of these is ONE validated source — never statewide, never connected.
      expect(state.tier).toBe("limited");
      expect(state.tierLabel).toContain("not statewide");
      expect(state.sourceCount).toBe(1);
      expect(state.note).toContain("not statewide coverage");
    }
    expect(payload.searchUrl).toBe("/api/state-grants/search");
    expect(payload.coverageUrl).toBe(STATE_GRANTS_COVERAGE_URL);
  });

  test("Virginia is `limited` with its honesty note, its source and its counts", async () => {
    const payload = payloadOf(await buildStateGrantCoverage(NOW, deps()));
    const virginia = payload.validated.find((v) => v.stateCode === "VA")!;
    expect(virginia.tier).toBe("limited");
    expect(virginia.tierLabel).toContain("not statewide");
    expect(virginia.note).toContain("One validated source");
    expect(virginia.note).toContain("not statewide coverage");
    expect(virginia.sourceUrl).toBe("https://www.vatc.org/grants/");
    expect(virginia.connectorId).toBe("va-vtc-grants");
    expect(virginia.sourceValidationTest).toContain("source-validation.test.ts");
    expect(virginia.sourceCount).toBe(1);
    expect(virginia.recordCount).toBe(8);
    expect(virginia.statusCounts.open).toBe(2);
    expect(virginia.statusCounts.total).toBe(8);
    expect(virginia.lastSyncedAt).toBe("2026-09-19T12:00:02.000Z");
    expect(virginia.lastRun?.status).toBe("ok");
  });

  test("no state is presented as connected, curated, or nationwide", async () => {
    const payload = payloadOf(await buildStateGrantCoverage(NOW, deps()));
    expect(payload.counts.connected).toBe(0);
    expect(payload.counts.curated).toBe(0);
    expect(payload.noNationwideCoverage).toContain("not nationwide coverage");
    const json = JSON.stringify({ ...payload, noNationwideCoverage: undefined });
    // Only the ladder's own label may mention the connected tier.
    const claims = json.match(/statewide, multi-source coverage/g) ?? [];
    expect(claims.length).toBe(1);
    expect(payload.states.filter((s) => s.status === "connected")).toEqual([]);
  });

  test("every uncovered state carries a machine-readable reason", async () => {
    const payload = payloadOf(await buildStateGrantCoverage(NOW, deps()));
    const unavailable = payload.states.filter((s) => s.status === "unavailable");
    expect(unavailable.length).toBe(15);
    for (const state of unavailable) {
      expect(state.reason.length).toBeGreaterThan(0);
      expect(state.sourceValidationTest).toBeNull();
    }
  });

  test("the freshness stamp comes from the store, and null means none", async () => {
    const withNone = payloadOf(
      await buildStateGrantCoverage(
        NOW,
        deps({
          latestSuccessfulStateSync: (async () => null) as unknown as StateGrantCoverageDeps["latestSuccessfulStateSync"],
        }),
      ),
    );
    expect(withNone.asOf).toBeNull();
    expect(withNone.validated[0].lastSyncedAt).toBeNull();
    // A store that cannot answer is not a store that says "just now".
    expect(JSON.stringify(withNone)).not.toContain("1970");
  });
});

describe("fail closed", () => {
  test("a store failure is a 500 with no partial payload", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      const outcome = await buildStateGrantCoverage(
        NOW,
        deps({
          stateGrantEffectiveStatusCounts: (async () => {
            throw new Error("counts unavailable");
          }) as unknown as StateGrantCoverageDeps["stateGrantEffectiveStatusCounts"],
        }),
      );
      expect(outcome.status).toBe(500);
      expect(outcome.body).toEqual({
        ok: false,
        error: "The state grant store is unavailable right now. Please try again.",
      });
      expect(JSON.stringify(outcome.body)).not.toContain("states");
    } finally {
      console.error = originalError;
    }
  });
});
