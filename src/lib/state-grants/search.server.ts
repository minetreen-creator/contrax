/**
 * Contrax Grants — STATE GRANT SEARCH, SERVER HALF (owner ROLLOUT order
 * 2026-09-18, part 2: search/API integration; RE-CUT onto the corrected data
 * model, R1 / owner 2026-09-19).
 *
 * The route handler in src/routes/api/state-grants/search.ts is a thin wrapper
 * around runStateGrantSearch(): everything that matters — validation, the
 * registry gate, the query, the honesty mapping, the counts, the freshness stamp
 * and the fail-closed error shape — lives here so it is testable against the
 * real database without an HTTP hop (see state-grants-search.integration.test.ts).
 *
 * THE REGISTRY GATE (fail closed, the heart of this file)
 *   Only states whose registry tier is VALIDATED (limited | curated | connected
 *   — registry.ts) may be served, because only those have a source-validation
 *   manifest entry and an approved official host. A caller asking for a state
 *   that is not validated gets an EMPTY, EXPLAINED result — never rows from that
 *   state, and never a fabricated record. When the caller names no state, the
 *   query is narrowed to the validated set, so a stray row in an unvalidated
 *   state can never leak into a search result. Today that set is Virginia
 *   (`limited`, one tourism source).
 *
 * ACCESS MODEL: anonymous and free, exactly like the federal /grants experience
 * (owner order: parity). Nothing here reads a session, a subscription or a
 * cookie, there is no per-visitor cap, and the response carries no pricing or
 * upgrade prompt. No analytics event is emitted from this path.
 *
 * FAILURE MODEL (fail closed): a bad request is a 400 with a single `error`
 * field; anything that throws (a database error, a malformed row) is a 500 with
 * `{ ok: false, error }` and NO partial result set — a caller never receives
 * records from a response that failed to build. There is no cache: every
 * response is built from the store as it is right now (`Cache-Control: no-store`
 * is set by the route).
 */
import type { StateGrantStatus } from "~/lib/state-grants/connector";
import { STATE_NAMES, validatedStates } from "~/lib/state-grants/registry";
import {
  latestSuccessfulStateSync,
  queryStateGrants,
} from "~/lib/state-grants/store.server";
import {
  STATE_GRANTS_NOTICE,
  describeStateGrantCount,
  parseStateGrantSearchRequest,
  stateGrantToday,
  toStateGrantRecordView,
  type StateGrantRecordView,
  type StateGrantSearchParams,
} from "~/lib/state-grants/search";

/** The one source label a search response carries (per-record labels differ). */
export const STATE_GRANTS_SOURCE_LABEL = "Official state agency funding pages";

/** What the API echoes back about the filters it actually applied. */
export interface StateGrantAppliedFilters {
  stateCodes: string[];
  sourceKeys: string[];
  status: StateGrantStatus | null;
  term: string | null;
  eligibleApplicants: string | null;
  eligibleGeography: string | null;
  categories: string[];
  awardRange: string | null;
  totalFunding: string | null;
  matchingRequirement: string | null;
  awardMinAmount: number | null;
  awardMaxAmount: number | null;
}

export interface StateGrantSearchPayload {
  ok: true;
  source: string;
  /** Echoes the status filter that was applied (null = any status). */
  status: StateGrantStatus | null;
  /**
   * The VALIDATED states this search actually covered. Always a SUBSET of the
   * validated set (registry tiers `limited` | `curated` | `connected`) — never a
   * state the caller named that has no validated source. Such a state is reported
   * in `uncoveredStates` / `uncoveredNotice` only, so the response can never
   * claim to have included a state it served nothing from.
   */
  statesIncluded: string[];
  /** The states the MATCHING records actually come from (empty when none match). */
  statesMatched: string[];
  /** Requested states that hold no validated source — nothing was served for them. */
  uncoveredStates: string[];
  /** Plain-language explanation of uncoveredStates, or null when there are none. */
  uncoveredNotice: string | null;
  /** Exact number of stored records matching the filters (not just this page). */
  totalCount: number;
  /**
   * True when totalCount is an exact count of the store. State records live in
   * our own database, so the count is a real SQL COUNT with no upstream row cap
   * — unlike the federal search, it is never a lower bound.
   */
  countExact: boolean;
  /** The last SUCCESSFUL sync of the covered states, or null when none. */
  asOf: string | null;
  limit: number;
  offset: number;
  returned: number;
  hasMore: boolean;
  /** True when the caller asked for more rows than the cap allows (clamped). */
  limitCapped: boolean;
  /** Ready-to-print honest count sentence for the active filter. */
  countLabel: string;
  /** Exactly which filters the API applied (never a filter it silently dropped). */
  filters: StateGrantAppliedFilters;
  notice: string;
  records: StateGrantRecordView[];
}

export interface StateGrantSearchErrorBody {
  ok: false;
  error: string;
}

export type StateGrantSearchOutcome =
  | { status: 200; body: StateGrantSearchPayload }
  | { status: 400; body: StateGrantSearchErrorBody }
  | { status: 500; body: StateGrantSearchErrorBody };

/**
 * The surface this builder needs. Injectable — the same pattern the sync runner
 * uses — so the response shape (including the fail-closed 500 and the registry
 * gate) is unit-testable without a database in the process.
 */
export interface StateGrantSearchDeps {
  queryStateGrants: typeof queryStateGrants;
  latestSuccessfulStateSync: typeof latestSuccessfulStateSync;
  /** The states whose registry tier is validated. */
  validatedStateCodes: () => readonly string[];
}

const REAL_DEPS: StateGrantSearchDeps = {
  queryStateGrants,
  latestSuccessfulStateSync,
  validatedStateCodes: validatedStates,
};

/**
 * Parses a POST body for the search route. An EMPTY body is a valid search (the
 * defaults); malformed JSON is a 400 and nothing else. Shared with the route
 * handler and unit-tested directly, so the HTTP contract's first step is covered
 * without importing a route module.
 */
export function parseStateGrantSearchBody(
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (text.trim().length === 0) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: "Request body must be valid JSON." };
  }
}

function stateNameOf(stateCode: string): string {
  return STATE_NAMES[stateCode as keyof typeof STATE_NAMES] ?? stateCode;
}

/** The honest sentence for a request that named a state we do not cover. */
export function uncoveredStatesNotice(codes: readonly string[]): string | null {
  if (codes.length === 0) return null;
  const names = codes.map((c) => `${stateNameOf(c)} (${c})`).join(", ");
  return codes.length === 1
    ? `${names} has no validated source yet, so there is nothing to show for it — no records are invented to fill the gap.`
    : `${names} have no validated source yet, so there is nothing to show for them — no records are invented to fill the gap.`;
}

/** The applied-filter echo, built from the parsed params (one definition). */
function appliedFilters(params: StateGrantSearchParams, stateScope: string[]): StateGrantAppliedFilters {
  return {
    stateCodes: stateScope,
    sourceKeys: params.sourceKeys,
    status: params.status,
    term: params.term,
    eligibleApplicants: params.eligibleApplicants,
    eligibleGeography: params.eligibleGeography,
    categories: params.categories,
    awardRange: params.awardRange,
    totalFunding: params.totalFunding,
    matchingRequirement: params.matchingRequirement,
    awardMinAmount: params.awardMinAmount,
    awardMaxAmount: params.awardMaxAmount,
  };
}

/**
 * Builds one search response. Never throws: a store failure becomes a 500 body
 * with no records at all.
 */
export async function runStateGrantSearch(
  body: unknown,
  now: Date = new Date(),
  deps: StateGrantSearchDeps = REAL_DEPS,
): Promise<StateGrantSearchOutcome> {
  const parsed = parseStateGrantSearchRequest(body);
  if (!parsed.ok) {
    return { status: 400, body: { ok: false, error: parsed.error } };
  }
  const params = parsed.params;
  const covered = new Set(deps.validatedStateCodes().map((c) => c.trim().toUpperCase()));
  const coveredList = [...covered].sort();

  const requested = params.stateCodes;
  // The served scope is the INTERSECTION of what the caller asked for with the
  // validated set — never the raw request. A state the caller named that has no
  // validated source is therefore not "included" in any sense: it is reported
  // only in `uncoveredStates` / `uncoveredNotice`, and the echoed
  // `filters.stateCodes` shows exactly the narrowed scope that was applied.
  // Deduped, so the scope, the query, the echo and `statesIncluded` are one
  // array and a repeated code cannot inflate the response.
  const requestedScope = requested.length > 0 ? requested : coveredList;
  const servedScope = [...new Set(requestedScope.filter((c) => covered.has(c)))];
  const uncovered = [...new Set(requested.filter((c) => !covered.has(c)))];

  try {
    const today = stateGrantToday(now);
    // An EMPTY scope (nothing requested is covered) is answered without touching
    // the store at all: the honest answer is "nothing here yet", not a query.
    const query =
      servedScope.length === 0
        ? { results: [], totalCount: 0, limit: params.limit, offset: params.offset }
        : await deps.queryStateGrants({
            stateCodes: servedScope,
            sourceKeys: params.sourceKeys.length > 0 ? params.sourceKeys : null,
            status: params.status,
            term: params.term,
            eligibleApplicants: params.eligibleApplicants,
            eligibleGeography: params.eligibleGeography,
            categories: params.categories.length > 0 ? params.categories : null,
            awardRange: params.awardRange,
            totalFunding: params.totalFunding,
            matchingRequirement: params.matchingRequirement,
            awardMinAmount: params.awardMinAmount,
            awardMaxAmount: params.awardMaxAmount,
            now,
            limit: params.limit,
            offset: params.offset,
          });
    // Freshness is reported for the scope the search covered, so an empty result
    // still states when that data was last refreshed (never a hopeful timestamp:
    // latestSuccessfulStateSync only counts successful runs).
    const asOf =
      servedScope.length === 0 ? null : await deps.latestSuccessfulStateSync(servedScope);
    const records = query.results.map((row) =>
      toStateGrantRecordView({ ...row, stateName: stateNameOf(row.stateCode) }, today),
    );
    const statesMatched = [...new Set(records.map((r) => r.stateCode))].sort();
    return {
      status: 200,
      body: {
        ok: true,
        source: STATE_GRANTS_SOURCE_LABEL,
        status: params.status,
        statesIncluded: servedScope,
        statesMatched,
        uncoveredStates: uncovered,
        uncoveredNotice: uncoveredStatesNotice(uncovered),
        totalCount: query.totalCount,
        countExact: true,
        asOf,
        limit: query.limit,
        offset: query.offset,
        returned: records.length,
        hasMore: query.offset + records.length < query.totalCount,
        limitCapped: params.limitCapped,
        countLabel: describeStateGrantCount(params.status, query.totalCount, true),
        filters: appliedFilters(params, servedScope),
        notice: STATE_GRANTS_NOTICE,
        records,
      },
    };
  } catch (e) {
    // Fail closed: a database failure is a 500 with no records in the body, so
    // nothing downstream can render a half-built, silently-partial result set.
    console.error("[state-grants] search failed:", e instanceof Error ? e.message : e);
    return {
      status: 500,
      body: {
        ok: false,
        error: "The state grant store is unavailable right now. Please try again.",
      },
    };
  }
}
