/**
 * Contrax Grants — STATE GRANT SEARCH, SERVER HALF (owner ROLLOUT order
 * 2026-09-18, part 2: search/API integration).
 *
 * The route handler in src/routes/api/state-grants/search.ts is a two-line
 * wrapper around runStateGrantSearch(): everything that matters — validation,
 * the query, the honesty mapping, the counts, the freshness stamp and the
 * fail-closed error shape — lives here so it is testable against the real
 * database without an HTTP hop (see state-grants-search.integration.test.ts).
 *
 * ACCESS MODEL: anonymous and free, exactly like the federal /grants experience
 * (owner order: parity). Nothing here reads a session, a subscription or a
 * cookie, there is no per-visitor cap, and the response carries no pricing or
 * upgrade prompt. The state search is a coverage page's search box, not a paid
 * product surface — no events are emitted from this path either.
 *
 * FAILURE MODEL (fail closed): a bad request is a 400 with a single `error`
 * field; anything that throws (a database error, a malformed row) is a 500 with
 * `{ ok: false, error }` and NO partial result set — a caller never receives
 * records from a response that failed to build. There is no cache: every
 * response is built from the store as it is right now (`Cache-Control: no-store`
 * is set by the route).
 */
import { type StateGrantStatus } from "~/lib/state-grants/connector";
import { connectedStates, STATE_NAMES } from "~/lib/state-grants/registry";
import {
  latestStateGrantSync,
  queryStateGrants,
} from "~/lib/state-grants/store.server";
import {
  STATE_GRANTS_NOTICE,
  describeStateGrantCount,
  easternDayString,
  parseStateGrantSearchRequest,
  toStateGrantRecordView,
  type StateGrantRecordView,
} from "~/lib/state-grants/search";

/** The one source label a search response carries (per-record labels differ). */
export const STATE_GRANTS_SOURCE_LABEL = "Official state agency funding pages";

export interface StateGrantSearchPayload {
  ok: true;
  source: string;
  /** Echoes the status filter that was applied (null = any status). */
  status: StateGrantStatus | null;
  /** The state scope this search covered (requested codes, else all connected). */
  statesIncluded: string[];
  /** The states the MATCHING records actually come from (empty when none match). */
  statesMatched: string[];
  /** Exact number of stored records matching the filters (not just this page). */
  totalCount: number;
  /**
   * True when totalCount is an exact count of the store. State records live in
   * our own database, so the count is a real SQL COUNT with no upstream row cap
   * — unlike the federal search, it is never a lower bound. It is stated
   * explicitly so the page can print "N" rather than "N+" without guessing.
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
 * The store surface this builder needs. Injectable — the same pattern the sync
 * runner uses — so the response shape (including the fail-closed 500) is
 * unit-testable without a database in the process.
 */
export interface StateGrantSearchDeps {
  queryStateGrants: typeof queryStateGrants;
  latestStateGrantSync: typeof latestStateGrantSync;
}

const REAL_DEPS: StateGrantSearchDeps = {
  queryStateGrants,
  latestStateGrantSync,
};

/**
 * Parses a POST body for the search route. An EMPTY body is a valid search (the
 * defaults); malformed JSON is a 400 and nothing else. Shared with the route
 * handler and unit-tested directly, so the HTTP contract's first step is
 * covered without importing a route module.
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
  const scope = params.stateCodes.length > 0 ? params.stateCodes : connectedStates();
  try {
    const today = easternDayString(now);
    const query = await deps.queryStateGrants({
      stateCodes: params.stateCodes.length > 0 ? params.stateCodes : null,
      status: params.status,
      term: params.term,
      limit: params.limit,
      offset: params.offset,
      now,
    });
    // Freshness is reported for the scope the search covered, so an empty
    // result still states when that data was last refreshed (never a hopeful
    // timestamp: latestStateGrantSync only counts successful runs).
    const asOf = await deps.latestStateGrantSync(
      query.statesIncluded.length > 0 ? query.statesIncluded : scope,
    );
    const records = query.results.map((row) =>
      toStateGrantRecordView(row, stateNameOf(row.stateCode), today),
    );
    return {
      status: 200,
      body: {
        ok: true,
        source: STATE_GRANTS_SOURCE_LABEL,
        status: params.status,
        statesIncluded: scope,
        statesMatched: query.statesIncluded,
        totalCount: query.totalCount,
        countExact: true,
        asOf,
        limit: query.limit,
        offset: query.offset,
        returned: records.length,
        hasMore: query.offset + records.length < query.totalCount,
        limitCapped: params.limitCapped,
        countLabel: describeStateGrantCount(params.status, query.totalCount, true),
        notice: STATE_GRANTS_NOTICE,
        records,
      },
    };
  } catch (e) {
    // Fail closed: a database failure is a 500 with no records in the body, so
    // nothing downstream can render a half-built, silently-partial result set.
    console.error(
      "[state-grants] search failed:",
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
