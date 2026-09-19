/**
 * Contrax Grants — STATE GRANT SEARCH, PURE HALF (owner ROLLOUT order
 * 2026-09-18, part 2: search/API integration + coverage UI).
 *
 * PURE MODULE: no DB, no network, no node builtins, no env reads. It holds the
 * request contract (validation + bounds), the honest display rules and the
 * record shape the API returns and the coverage page renders, so the server
 * half (search.server.ts), the route handlers and the tests all share ONE
 * definition instead of three copies that drift.
 *
 * HONESTY CONTRACT (the state counterpart of the federal #399 rules; see
 * CONVENTIONS.md §2 and connector.ts):
 *   - `open` requires a published closing date that has not passed (US Eastern
 *     day boundary, deadline day inclusive) OR a source-declared ongoing
 *     program with no deadline. Never anything else.
 *   - A forecast's announced date is an ESTIMATE: it is returned as
 *     `estimatedCloseDate`, labelled "source estimate — not a posted closing
 *     date", and never placed in `closeDate`.
 *   - A field the source did not publish is NOT_SPECIFIED ("Not specified") —
 *     never a guess.
 *   - A stored row is re-checked against the current day on every read
 *     (effectiveStateGrantStatus): an `open` row whose published closing date
 *     has passed since the last sync is served as `closed`, never as an open
 *     deadline. Forecasts are never auto-promoted to open (their date is an
 *     estimate) and never auto-closed (the source's own words decide that, on
 *     the next sync) — the conservative direction in both cases.
 */
import {
  NOT_SPECIFIED,
  STATE_GRANT_STATUSES,
  STATE_GRANT_STATUS_LABELS,
  type StateGrantStatus,
} from "~/lib/state-grants/connector";
import { STATE_CODES } from "~/lib/state-grants/registry";
import { easternDayStart } from "~/lib/grants";

/** The one place the state source labelling rule lives. */
export const STATE_GRANTS_NOTICE =
  "State grants come straight from each participating state agency's own published funding page. " +
  "Contrax shows the agency's own dates, eligibility and titles — a field the agency did not publish " +
  "reads \u201cNot specified\u201d, and nothing is estimated, inferred or back-filled. " +
  "States not listed as connected are not covered yet: this is a growing program, not nationwide coverage.";

/** Shown on every card whose status came from a forecast (never a deadline). */
export const FORECAST_ESTIMATE_NOTE = "source estimate — not a posted closing date";

/** The state-coverage headline rule, in one place (pure function below). */
export const STATE_GRANTS_COVERAGE_CLAIM =
  "This is a growing program covering the states listed as connected — it is not nationwide coverage.";

export const STATE_GRANT_SEARCH_MAX_TERM = 120;
export const STATE_GRANT_DEFAULT_LIMIT = 25;
export const STATE_GRANT_MAX_LIMIT = 100;

/** Where the federal Grants.gov finder lives (the coverage page links to it). */
export const FEDERAL_GRANTS_PATH = "/grants";

export function isStateGrantStatus(value: unknown): value is StateGrantStatus {
  return (
    typeof value === "string" && (STATE_GRANT_STATUSES as readonly string[]).includes(value)
  );
}

export function isSupportedStateCode(value: unknown): boolean {
  return typeof value === "string" && (STATE_CODES as readonly string[]).includes(value);
}

// ── Request contract ────────────────────────────────────────────────────────

export interface StateGrantSearchParams {
  /** Validated state codes (empty = every state in the store). */
  stateCodes: string[];
  status: StateGrantStatus | null;
  /** Sanitised free text, or null. Wildcards are literal (see the store's likeTerm). */
  term: string | null;
  limit: number;
  offset: number;
  /** True when the caller asked for more rows than the cap allows. */
  limitCapped: boolean;
}

export type ParseStateGrantSearchResult =
  | { ok: true; params: StateGrantSearchParams }
  | { ok: false; error: string };

/** The single place a request body is validated. Present-but-invalid is a 400. */
export function parseStateGrantSearchRequest(body: unknown): ParseStateGrantSearchResult {
  const raw = body === undefined || body === null ? {} : body;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const input = raw as Record<string, unknown>;

  // stateCodes — an array of two-letter codes, each of which must be a real US
  // state or D.C. An unknown code is rejected rather than ignored: silently
  // dropping it would answer a question the caller did not ask.
  let stateCodes: string[] = [];
  if (input.stateCodes !== undefined && input.stateCodes !== null) {
    if (!Array.isArray(input.stateCodes)) {
      return { ok: false, error: "stateCodes must be an array of two-letter state codes." };
    }
    const codes: string[] = [];
    for (const entry of input.stateCodes) {
      if (typeof entry !== "string") {
        return { ok: false, error: "stateCodes must be an array of two-letter state codes." };
      }
      const code = entry.trim().toUpperCase();
      if (!isSupportedStateCode(code)) {
        return {
          ok: false,
          error: `Unknown state code ${JSON.stringify(code)} — only US states and the District of Columbia are supported.`,
        };
      }
      if (!codes.includes(code)) codes.push(code);
    }
    stateCodes = codes;
  }

  // status
  let status: StateGrantStatus | null = null;
  if (input.status !== undefined && input.status !== null && input.status !== "") {
    if (!isStateGrantStatus(input.status)) {
      return { ok: false, error: "status must be one of open, forecast, closed." };
    }
    status = input.status;
  }

  // term — control characters stripped, bounded, wildcards left literal (the
  // store escapes them, so "%" can never widen its own match).
  let term: string | null = null;
  if (input.term !== undefined && input.term !== null) {
    if (typeof input.term !== "string") {
      return { ok: false, error: "term must be a string." };
    }
    // eslint-disable-next-line no-control-regex
    const cleaned = input.term.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (cleaned.length > STATE_GRANT_SEARCH_MAX_TERM) {
      return {
        ok: false,
        error: `term must be at most ${STATE_GRANT_SEARCH_MAX_TERM} characters.`,
      };
    }
    term = cleaned.length > 0 ? cleaned : null;
  }

  // limit / offset — integers, bounded. A limit above the cap is CLAMPED (and
  // reported), never rejected: the cap is ours, not the caller's mistake.
  let limit = STATE_GRANT_DEFAULT_LIMIT;
  let limitCapped = false;
  if (input.limit !== undefined && input.limit !== null) {
    if (typeof input.limit !== "number" || !Number.isFinite(input.limit) || !Number.isInteger(input.limit) || input.limit < 1) {
      return {
        ok: false,
        error: `limit must be a positive integer (max ${STATE_GRANT_MAX_LIMIT}).`,
      };
    }
    if (input.limit > STATE_GRANT_MAX_LIMIT) {
      limit = STATE_GRANT_MAX_LIMIT;
      limitCapped = true;
    } else {
      limit = input.limit;
    }
  }
  let offset = 0;
  if (input.offset !== undefined && input.offset !== null) {
    if (
      typeof input.offset !== "number" ||
      !Number.isFinite(input.offset) ||
      !Number.isInteger(input.offset) ||
      input.offset < 0
    ) {
      return { ok: false, error: "offset must be zero or a positive integer." };
    }
    offset = input.offset;
  }

  return { ok: true, params: { stateCodes, status, term, limit, offset, limitCapped } };
}

// ── Read-time freshness (the SQL fragment's TS twin) ────────────────────────

/** The US Eastern calendar day (`YYYY-MM-DD`) a read is evaluated against. */
export function easternDayString(now: Date | number = new Date()): string {
  const epoch = easternDayStart(now);
  if (Number.isNaN(epoch)) {
    const d = typeof now === "number" ? new Date(now) : now;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
      .toISOString()
      .slice(0, 10);
  }
  return new Date(epoch).toISOString().slice(0, 10);
}

/**
 * The status a stored row is served with TODAY.
 *
 * One rule, and only one: an `open` row carrying a published closing date that
 * has passed since the row was written is served as `closed`. Everything else is
 * served exactly as the sync classified it, so a read can never inflate a
 * status — it can only expire a deadline the calendar has overtaken.
 *
 * The store applies the identical rule in SQL
 * (STATE_GRANT_EFFECTIVE_STATUS_SQL, used by queryStateGrants) so filtering,
 * counting and ordering all agree with what each row displays; this TS twin is
 * what the unit tests and the client-side card renderer use.
 */
export function effectiveStateGrantStatus(
  row: { status: StateGrantStatus; closeDate: string | null },
  today: string,
): StateGrantStatus {
  if (row.status === "open" && row.closeDate !== null && row.closeDate < today) return "closed";
  return row.status;
}

/** The SQL twin of effectiveStateGrantStatus. `o` = row alias, `t.today` = the day. */
export const STATE_GRANT_EFFECTIVE_STATUS_SQL =
  "CASE WHEN o.status = 'open' AND o.close_date IS NOT NULL AND o.close_date < t.today THEN 'closed' ELSE o.status END";

// ── Display rules ───────────────────────────────────────────────────────────

/**
 * The official-source label for a record: the publishing body as the source
 * names itself, plus the host it was read from — e.g.
 * "Virginia Tourism Corporation — vatc.org". Neither half is invented: the
 * publisher is the stored agency value (or the state's own name when the source
 * published no agency) and the host comes from the record's own source URL.
 */
export function stateGrantSourceLabel(record: {
  stateCode: string;
  stateName?: string;
  agency: string | null;
  sourceUrl: string;
}): string {
  const publisher =
    record.agency && record.agency !== NOT_SPECIFIED
      ? record.agency
      : (record.stateName ?? record.stateCode);
  return `${publisher} — ${hostOf(record.sourceUrl)}`;
}

/** Bare host of a URL (no scheme, no www), or NOT_SPECIFIED when unparseable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return NOT_SPECIFIED;
  }
}

/**
 * The ONE date line a card shows, chosen so an estimate can never be read as a
 * deadline. A forecast has no `closeDate` at all, so its row can only ever
 * surface the estimate — labelled.
 */
export function stateGrantDeadlineDisplay(record: {
  status: StateGrantStatus;
  closeDate: string | null;
  estimatedCloseDate: string | null;
}): { label: string; value: string } | null {
  if (record.status === "forecast") {
    if (!record.estimatedCloseDate) return null; // never invent one for a forecast
    return {
      label: "Estimated application deadline",
      value: `${record.estimatedCloseDate} (${FORECAST_ESTIMATE_NOTE})`,
    };
  }
  if (record.status === "open" && record.closeDate === null) {
    return { label: "Deadline", value: "Not specified — source lists no closing date" };
  }
  return { label: "Closing date", value: record.closeDate ?? NOT_SPECIFIED };
}

/** Honest count sentence for the results header. */
export function describeStateGrantCount(
  status: StateGrantStatus | null,
  count: number,
  exact: boolean,
): string {
  const n = `${count.toLocaleString("en-US")}${exact ? "" : "+"}`;
  const noun = count === 1 ? "record" : "records";
  if (status === "open") return `${n} ${noun} open for applications`;
  if (status === "forecast") return `${n} ${noun} forecast — not yet open`;
  if (status === "closed") return `${n} closed ${noun}`;
  return `${n} stored ${noun}`;
}

// ── The record the API returns / the page renders ───────────────────────────

export interface StateGrantRecordView {
  id: string;
  stateCode: string;
  stateName: string;
  externalId: string;
  title: string;
  agency: string;
  summary: string;
  status: StateGrantStatus;
  statusLabel: string;
  postedDate: string | null;
  /** Set only for open/closed rows; null for every forecast. */
  closeDate: string | null;
  /** A forecast's announced date — an estimate, never a deadline. */
  estimatedCloseDate: string | null;
  /** Exactly what the card may print, already honesty-labelled. */
  deadline: { label: string; value: string } | null;
  /** The record's own page on the official source. */
  url: string;
  /** The official listing page it was read from. */
  sourceUrl: string;
  /** e.g. "Virginia Tourism Corporation — vatc.org". */
  sourceLabel: string;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
}

/** Maps a stored row into the view, applying the read-time honesty rules. */
export function toStateGrantRecordView(
  row: {
    id: string;
    stateCode: string;
    externalId: string;
    title: string;
    agency: string | null;
    summary: string | null;
    status: StateGrantStatus;
    postedDate: string | null;
    closeDate: string | null;
    estimatedCloseDate: string | null;
    url: string;
    sourceUrl: string;
    sourceUpdatedAt: string | null;
    fetchedAt: string;
  },
  stateName: string,
  today: string,
): StateGrantRecordView {
  const status = effectiveStateGrantStatus(row, today);
  // The store already guarantees the shape (close_date only on open/closed,
  // estimated_close_date only on forecasts); this mapping keeps that guarantee
  // visible rather than passing a stale pair through.
  const closeDate = status === "forecast" ? null : row.closeDate;
  const estimatedCloseDate = status === "forecast" ? row.estimatedCloseDate : null;
  return {
    id: row.id,
    stateCode: row.stateCode,
    stateName,
    externalId: row.externalId,
    title: row.title,
    agency: row.agency && row.agency.trim() ? row.agency : NOT_SPECIFIED,
    summary: row.summary && row.summary.trim() ? row.summary : NOT_SPECIFIED,
    status,
    statusLabel: STATE_GRANT_STATUS_LABELS[status],
    postedDate: row.postedDate,
    closeDate,
    estimatedCloseDate,
    deadline: stateGrantDeadlineDisplay({ status, closeDate, estimatedCloseDate }),
    url: row.url,
    sourceUrl: row.sourceUrl,
    sourceLabel: stateGrantSourceLabel({
      stateCode: row.stateCode,
      stateName,
      agency: row.agency,
      sourceUrl: row.sourceUrl,
    }),
    sourceUpdatedAt: row.sourceUpdatedAt,
    fetchedAt: row.fetchedAt,
  };
}
