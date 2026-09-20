/**
 * Contrax Grants — STATE GRANT COVERAGE, SERVER HALF (owner ROLLOUT order
 * 2026-09-18, part 2: coverage UI; RE-CUT onto the corrected model, R1 / owner
 * 2026-09-19).
 *
 * WHAT THE COVERAGE DATA IS, AND WHAT IT IS NOT
 *   - The registry half comes from the DERIVED registry (`listStates()` in
 *     registry.ts), recomputed on every read. It is NEVER read from the
 *     `state_grant_registry` table: that table is a byproduct mirror, and a
 *     stale or hand-edited mirror must not be able to change what coverage
 *     Contrax claims.
 *   - The tiers are the owner's ladder: connected | curated | limited |
 *     unavailable. Virginia is `limited` — one validated tourism source, not a
 *     statewide view — and the response says exactly that in words, so no client
 *     can render the registry as a coverage map of the United States.
 *   - The sync half (last successful sync, record counts, per-status counts)
 *     comes from the live tables and only from rows that actually exist. Counts
 *     use the READ-TIME status, so they agree with what a search returns. No
 *     placeholder numbers, no "coming soon" counts.
 *
 * FAILURE MODEL (fail closed): anything that throws becomes a 500 with no
 * partial payload; the coverage page then shows the derived registry (which is
 * pure and always available) and states that the sync facts could not be read.
 */
import {
  STATE_GRANTS_COVERAGE_CLAIM,
  STATE_GRANTS_NOTICE,
  FEDERAL_GRANTS_PATH,
} from "~/lib/state-grants/search";
import {
  REGISTRY_STATUS_LABELS,
  VALIDATED_REGISTRY_STATUSES,
  coverageCounts,
  coverageHeadlineFor,
  isDcValidated,
  isValidatedStatus,
  listStates,
  type CoverageCounts,
  type StateGrantRegistryStatus,
  type StateRegistryEntry,
} from "~/lib/state-grants/registry";
import type { StateGrantStatus } from "~/lib/state-grants/connector";
import {
  latestSuccessfulStateSync,
  listStateSyncRuns,
  stateGrantEffectiveStatusCounts,
} from "~/lib/state-grants/store.server";

export const STATE_GRANTS_FEDERAL_URL = FEDERAL_GRANTS_PATH;
export const STATE_GRANTS_SEARCH_URL = "/api/state-grants/search";
export const STATE_GRANTS_COVERAGE_URL = "/api/state-grants/coverage";

/** One row of the coverage ladder, in the order the page should render it. */
export interface CoverageLadderRung {
  status: StateGrantRegistryStatus;
  label: string;
}

export function coverageLadder(): CoverageLadderRung[] {
  return [...VALIDATED_REGISTRY_STATUSES]
    .reverse()
    .concat("unavailable")
    .map((status) => ({ status, label: REGISTRY_STATUS_LABELS[status] }));
}

/** Detail for one state whose registry tier is validated (limited+). */
export interface ValidatedStateCoverage {
  stateCode: string;
  name: string;
  /** The owner's ladder tier: limited | curated | connected. */
  tier: StateGrantRegistryStatus;
  tierLabel: string;
  /** The registry's honesty note — what this coverage is NOT. */
  note: string | null;
  /** Why the tier holds (the source-validation gate that passed). */
  reason: string;
  connectorId: string | null;
  /** The approved official source this state is read from. */
  sourceUrl: string;
  /** The live source-validation test that gates the tier. */
  sourceValidationTest: string | null;
  /** How many distinct sources are registered for this state. */
  sourceCount: number;
  /** Records currently stored for this state (read-time statuses). */
  recordCount: number;
  statusCounts: Record<StateGrantStatus, number> & { total: number };
  /** Last SUCCESSFUL sync, or null when the state has never synced cleanly. */
  lastSyncedAt: string | null;
  lastRun: {
    status: "ok" | "error";
    startedAt: string;
    finishedAt: string | null;
    fetchedCount: number;
    insertedCount: number;
    updatedCount: number;
    error: Record<string, unknown> | null;
  } | null;
}

export interface StateGrantCoveragePayload {
  ok: true;
  /** The honest headline, computed from the derived registry. */
  headline: string;
  /** Explicit anti-claim, so no reader can take the registry for nationwide coverage. */
  noNationwideCoverage: string;
  counts: CoverageCounts;
  /** The ladder, so the API states the contract the page renders. */
  ladder: CoverageLadderRung[];
  /** Every state + D.C., from the DERIVED registry (never the mirror table). */
  states: StateRegistryEntry[];
  /** Detail for every state with a validated tier (limited | curated | connected). */
  validated: ValidatedStateCoverage[];
  /** Most recent successful sync across the validated states, or null. */
  asOf: string | null;
  notice: string;
  federalGrantsUrl: string;
  searchUrl: string;
  coverageUrl: string;
}

export interface StateGrantCoverageErrorBody {
  ok: false;
  error: string;
}

export type StateGrantCoverageOutcome =
  | { status: 200; body: StateGrantCoveragePayload }
  | { status: 500; body: StateGrantCoverageErrorBody };

/**
 * The store surface this builder needs, injectable so the fail-closed 500 is
 * unit-testable without a database in the process (the sync runner's pattern).
 * The DERIVED registry is deliberately NOT injectable: coverage counts must come
 * from registry.ts, never from a caller's substitute or the mirror table.
 */
export interface StateGrantCoverageDeps {
  stateGrantEffectiveStatusCounts: typeof stateGrantEffectiveStatusCounts;
  latestSuccessfulStateSync: typeof latestSuccessfulStateSync;
  listStateSyncRuns: typeof listStateSyncRuns;
}

const REAL_DEPS: StateGrantCoverageDeps = {
  stateGrantEffectiveStatusCounts,
  latestSuccessfulStateSync,
  listStateSyncRuns,
};

/**
 * "State grant coverage: 37 of 50 states validated, plus Washington, D.C.
 * (0 connected, 0 curated, 38 limited)."
 *
 * The wording is generated by the SHARED registry helper
 * (`coverageHeadlineFor`) so the /state-grants page and this API can never
 * drift: D.C. is a jurisdiction, not a state, so the headline counts 50 STATES
 * and names D.C. separately — it may never say "51 states". The sentence still
 * never claims coverage the ladder has not granted.
 */
export function coverageHeadline(counts: CoverageCounts): string {
  return coverageHeadlineFor(counts, isDcValidated());
}

/** Builds the coverage payload. Never throws: a store failure is a 500 body. */
export async function buildStateGrantCoverage(
  now: Date = new Date(),
  deps: StateGrantCoverageDeps = REAL_DEPS,
): Promise<StateGrantCoverageOutcome> {
  const counts = coverageCounts();
  const states = listStates();
  try {
    const validatedStates = states.filter((s) => isValidatedStatus(s.status));
    const validated: ValidatedStateCoverage[] = [];
    for (const entry of validatedStates) {
      const statusCounts = await deps.stateGrantEffectiveStatusCounts(entry.stateCode, now);
      const [lastSyncedAt, runs] = await Promise.all([
        deps.latestSuccessfulStateSync([entry.stateCode]),
        deps.listStateSyncRuns(entry.stateCode, 1),
      ]);
      const run = runs[0] ?? null;
      validated.push({
        stateCode: entry.stateCode,
        name: entry.name,
        tier: entry.status,
        tierLabel: REGISTRY_STATUS_LABELS[entry.status],
        note: entry.note,
        reason: entry.reason,
        connectorId: entry.connectorId,
        sourceUrl: entry.sourceUrl ?? "",
        sourceValidationTest: entry.sourceValidationTest,
        sourceCount: entry.sourceCount,
        recordCount: statusCounts.total,
        statusCounts,
        lastSyncedAt,
        lastRun: run
          ? {
              status: run.status,
              startedAt: run.startedAt,
              finishedAt: run.finishedAt,
              fetchedCount: run.fetchedCount,
              insertedCount: run.insertedCount,
              updatedCount: run.updatedCount,
              error: run.error,
            }
          : null,
      });
    }
    const asOf = await deps.latestSuccessfulStateSync(validatedStates.map((s) => s.stateCode));
    return {
      status: 200,
      body: {
        ok: true,
        headline: coverageHeadline(counts),
        noNationwideCoverage: STATE_GRANTS_COVERAGE_CLAIM,
        counts,
        ladder: coverageLadder(),
        states,
        validated,
        asOf,
        notice: STATE_GRANTS_NOTICE,
        federalGrantsUrl: STATE_GRANTS_FEDERAL_URL,
        searchUrl: STATE_GRANTS_SEARCH_URL,
        coverageUrl: STATE_GRANTS_COVERAGE_URL,
      },
    };
  } catch (e) {
    console.error("[state-grants] coverage failed:", e instanceof Error ? e.message : e);
    return {
      status: 500,
      body: {
        ok: false,
        error: "The state grant store is unavailable right now. Please try again.",
      },
    };
  }
}
