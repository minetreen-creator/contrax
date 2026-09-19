/**
 * Contrax Grants — STATE GRANT COVERAGE, SERVER HALF (owner ROLLOUT order
 * 2026-09-18, part 2: coverage UI).
 *
 * WHAT THE COVERAGE DATA IS, AND WHAT IT IS NOT
 *   - The registry half comes from the DERIVED registry (`listStates()` in
 *     registry.ts), recomputed on every read. It is NEVER read from the
 *     `state_grant_registry` table: that table is a byproduct mirror, and a
 *     stale or hand-edited mirror must not be able to change what coverage
 *     Contrax claims (owner order, 2026-09-18).
 *   - The sync half (last sync time, record counts, per-status counts) comes
 *     from the live tables and only from rows that actually exist. No
 *     placeholder numbers, no "coming soon" counts.
 *   - `connected: 1` means exactly one state's source has passed the
 *     source-validation gate. The response says so in words
 *     (headline + noNationwideCoverage) so no client can render the registry as
 *     a coverage map of the United States.
 *
 * FAILURE MODEL (fail closed): anything that throws becomes a 500 with no
 * partial payload; the coverage page then shows the derived registry (which is
 * pure and always available) and states that the sync facts could not be read.
 */
import {
  STATE_GRANTS_COVERAGE_CLAIM,
  STATE_GRANTS_NOTICE,
} from "~/lib/state-grants/search";
import {
  coverageCounts,
  listStates,
  type CoverageCounts,
  type StateRegistryEntry,
} from "~/lib/state-grants/registry";
import type { StateGrantStatus } from "~/lib/state-grants/connector";
import {
  latestStateGrantSync,
  listStateSyncRuns,
  stateGrantEffectiveStatusCounts,
} from "~/lib/state-grants/store.server";

export const STATE_GRANTS_FEDERAL_URL = "/grants";
export const STATE_GRANTS_SEARCH_URL = "/api/state-grants/search";

export interface ConnectedStateCoverage {
  stateCode: string;
  name: string;
  /** The approved official source this state is read from. */
  sourceUrl: string;
  connectorId: string | null;
  /** The live source-validation test that gates the `connected` status. */
  sourceValidationTest: string | null;
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
  /** Every state + D.C., from the DERIVED registry (never the mirror table). */
  states: StateRegistryEntry[];
  /** Detail for each `connected` state (source, sync facts, record counts). */
  connected: ConnectedStateCoverage[];
  notice: string;
  federalGrantsUrl: string;
  searchUrl: string;
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
  latestStateGrantSync: typeof latestStateGrantSync;
  listStateSyncRuns: typeof listStateSyncRuns;
}

const REAL_DEPS: StateGrantCoverageDeps = {
  stateGrantEffectiveStatusCounts,
  latestStateGrantSync,
  listStateSyncRuns,
};

/** "State grant coverage: 1 of 51 states connected". */
export function coverageHeadline(counts: CoverageCounts): string {
  // The noun agrees with the TOTAL (51 states), not with the connected count:
  // "1 of 51 states connected", never "1 of 51 state connected".
  const noun = counts.total === 1 ? "state" : "states";
  return `State grant coverage: ${counts.connected} of ${counts.total} ${noun} connected`;
}

/** Builds the coverage payload. Never throws: a store failure is a 500 body. */
export async function buildStateGrantCoverage(
  now: Date = new Date(),
  deps: StateGrantCoverageDeps = REAL_DEPS,
): Promise<StateGrantCoverageOutcome> {
  const counts = coverageCounts();
  const states = listStates();
  try {
    const connected: ConnectedStateCoverage[] = [];
    for (const entry of states) {
      if (entry.status !== "connected") continue;
      const statusCounts = await deps.stateGrantEffectiveStatusCounts(entry.stateCode, now);
      const [lastSyncedAt, runs] = await Promise.all([
        deps.latestStateGrantSync([entry.stateCode]),
        deps.listStateSyncRuns(entry.stateCode, 1),
      ]);
      const run = runs[0] ?? null;
      connected.push({
        stateCode: entry.stateCode,
        name: entry.name,
        sourceUrl: entry.sourceUrl ?? "",
        connectorId: entry.connectorId,
        sourceValidationTest: entry.sourceValidationTest,
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
    return {
      status: 200,
      body: {
        ok: true,
        headline: coverageHeadline(counts),
        noNationwideCoverage: STATE_GRANTS_COVERAGE_CLAIM,
        counts,
        states,
        connected,
        notice: STATE_GRANTS_NOTICE,
        federalGrantsUrl: STATE_GRANTS_FEDERAL_URL,
        searchUrl: STATE_GRANTS_SEARCH_URL,
      },
    };
  } catch (e) {
    console.error(
      "[state-grants] coverage failed:",
      e instanceof Error ? e.message : e,
    );
    return {
      status: 500,
      body: {
        ok: false,
        error: "The state grant store is unavailable right now. Please try again.",
      },
    };
  }
}
