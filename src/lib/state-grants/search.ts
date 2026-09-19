/**
 * Contrax Grants — STATE GRANT SEARCH, PURE HALF (owner ROLLOUT order
 * 2026-09-18, part 2: search/API integration + coverage UI; RE-CUT onto the
 * corrected data model, R1 / owner 2026-09-19).
 *
 * PURE MODULE: no DB, no network, no node builtins, no env reads. It holds the
 * request contract (validation + bounds), the honest display rules and the
 * record shape the API returns and the coverage page renders, so the server
 * half (search.server.ts), the route handlers and the tests all share ONE
 * definition instead of three copies that drift.
 *
 * HONESTY CONTRACT (the state counterpart of the federal #399 rules; see
 * CONVENTIONS.md §2 and connector.ts):
 *   - The statuses are the owner's five: open | upcoming | rolling | closed |
 *     unverified. There is NO `forecast` — not in a filter, not in a label, not
 *     in a count sentence, not in a row. A record whose dates are missing or
 *     ambiguous is `unverified`; nothing is ever promoted to a live cycle.
 *   - `open` requires a published closing date that has not passed (US Eastern
 *     day boundary, deadline day inclusive). This is enforced twice: the sync
 *     classifies it, and every read re-checks it (effectiveStateGrantStatus),
 *     so an `open` row whose deadline passed since the last sync is served —
 *     and filtered, and counted — as `closed`. A read can only expire a
 *     deadline the calendar has overtaken; it can never promote a row.
 *   - An ESTIMATE the source published lives in `estimatedCloseDate`, is
 *     labelled "source estimate — not a posted closing date", and is never
 *     placed in `closeDate`.
 *   - A field the source did not publish is NOT_SPECIFIED ("Not specified") —
 *     never a guess, and a filter on that field can never match such a row.
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
  "State grant records come straight from each covered state agency's own published funding page. " +
  "Contrax shows the agency's own dates, eligibility, categories and titles — a field the agency did not publish " +
  "reads \u201cNot specified\u201d, and nothing is estimated, inferred or back-filled. " +
  "Uncovered states are not covered yet: this is a growing program, not nationwide coverage.";

/** The estimate label a card may print. Never a deadline. */
export const STATE_GRANT_ESTIMATE_NOTE = "source estimate — not a posted closing date";

/** The state-coverage headline rule, in one place. */
export const STATE_GRANTS_COVERAGE_CLAIM =
  "This is a growing program covering the states listed as limited, curated or connected — it is not nationwide coverage.";

/** Where the federal Grants.gov finder lives (the coverage page links to it). */
export const FEDERAL_GRANTS_PATH = "/grants";

export const STATE_GRANT_SEARCH_MAX_TERM = 120;
export const STATE_GRANT_MAX_FILTER_TERM = 80;
export const STATE_GRANT_MAX_CATEGORIES = 5;
export const STATE_GRANT_MAX_CATEGORY = 60;
export const STATE_GRANT_DEFAULT_LIMIT = 25;
export const STATE_GRANT_MAX_LIMIT = 100;

export function isStateGrantStatus(value: unknown): value is StateGrantStatus {
  return typeof value === "string" && (STATE_GRANT_STATUSES as readonly string[]).includes(value);
}

export function isSupportedStateCode(value: unknown): boolean {
  return typeof value === "string" && (STATE_CODES as readonly string[]).includes(value);
}

/** The five statuses, for a filter list, in the serving order. */
export const STATE_GRANT_STATUS_OPTIONS: readonly StateGrantStatus[] = STATE_GRANT_STATUSES;

// ── Read-time freshness (the SQL fragment's TS twin) ────────────────────────

/** The US Eastern calendar day (`YYYY-MM-DD`) a read is evaluated against. */
export function stateGrantToday(now: Date | number = new Date()): string {
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
 * queryStateGrants() applies the identical rule in SQL (the CASE expression on
 * `close_date`), so filtering, counting and ordering agree with what each row
 * displays; this TS twin is what the unit tests and the card renderer use.
 */
export function effectiveStateGrantStatus(
  row: { status: StateGrantStatus; closeDate: string | null },
  today: string,
): StateGrantStatus {
  if (row.status === "open" && row.closeDate !== null && row.closeDate < today) return "closed";
  return row.status;
}

// ── Request contract ────────────────────────────────────────────────────────

export interface StateGrantSearchParams {
  /** Validated state codes (empty = do not narrow by state). */
  stateCodes: string[];
  /** One or more SOURCE keys (a state with several sources), empty = all. */
  sourceKeys: string[];
  status: StateGrantStatus | null;
  /** Sanitised free text, or null. Wildcards are literal (see the store's likeTerm). */
  term: string | null;
  // Normalized-column filters (owner correction 4). Each is the caller's value
  // or null; a filter on a field the source did not publish matches NO row.
  eligibleApplicants: string | null;
  eligibleGeography: string | null;
  /** Category labels to match (any of), case-insensitive, deduped. */
  categories: string[];
  awardRange: string | null;
  totalFunding: string | null;
  matchingRequirement: string | null;
  /** Rows whose published award range reaches at least this much. */
  awardMinAmount: number | null;
  /** Rows whose published award range does not exceed this much. */
  awardMaxAmount: number | null;
  limit: number;
  offset: number;
  /** True when the caller asked for more rows than the cap allows. */
  limitCapped: boolean;
}

export type ParseStateGrantSearchResult =
  | { ok: true; params: StateGrantSearchParams }
  | { ok: false; error: string };

/** Strips control characters and trims; empty becomes null. */
function cleanText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

/** One optional free-text filter field. Present-but-wrong-type is a 400. */
function parseTextFilter(
  input: Record<string, unknown>,
  field: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = input[field];
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: `${field} must be a string.` };
  const cleaned = cleanText(raw);
  if (cleaned.length > STATE_GRANT_MAX_FILTER_TERM) {
    return {
      ok: false,
      error: `${field} must be at most ${STATE_GRANT_MAX_FILTER_TERM} characters.`,
    };
  }
  return { ok: true, value: cleaned.length > 0 ? cleaned : null };
}

/** One optional numeric bound. Present-but-invalid is a 400, never silently dropped. */
function parseAmountFilter(
  input: Record<string, unknown>,
  field: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const raw = input[field];
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    return { ok: false, error: `${field} must be zero or a positive number.` };
  }
  return { ok: true, value: raw };
}

/**
 * The single place a request body is validated. Present-but-invalid is a 400;
 * every field is optional (an empty body is the default search). An unknown
 * field is IGNORED rather than guessed at, so a caller can never widen a query
 * by sending a filter we do not implement (e.g. the removed `forecast` status
 * is rejected by name, not mapped onto something else).
 */
export function parseStateGrantSearchRequest(body: unknown): ParseStateGrantSearchResult {
  const raw = body === undefined || body === null ? {} : body;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const input = raw as Record<string, unknown>;

  // stateCodes — an array of two-letter codes, each of which must be a real US
  // state or D.C. An unknown code is rejected rather than ignored: silently
  // dropping it would answer a question the caller did not ask. Whether a real
  // state is COVERED is a separate question, answered by the registry gate in
  // search.server.ts (an uncovered state returns nothing, never fabricated rows).
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

  // sourceKeys — an optional narrowing to specific registered SOURCES (a state
  // can have several). Values are OUR registered keys, so a separator character
  // is refused for the same reason it is refused in `categories`.
  let sourceKeys: string[] = [];
  if (input.sourceKeys !== undefined && input.sourceKeys !== null) {
    if (!Array.isArray(input.sourceKeys)) {
      return { ok: false, error: "sourceKeys must be an array of source keys." };
    }
    for (const entry of input.sourceKeys) {
      if (typeof entry !== "string") {
        return { ok: false, error: "sourceKeys must be an array of source keys." };
      }
      const key = cleanText(entry);
      if (key.length === 0) continue;
      if (/[,\n\r{}]/.test(key)) {
        return { ok: false, error: "a source key must not contain a comma, brace or newline." };
      }
      if (!sourceKeys.includes(key)) sourceKeys.push(key);
    }
  }

  // status — the owner's five. `forecast` is not a status any more and is
  // rejected by name so a stale client cannot silently get unfiltered results.
  let status: StateGrantStatus | null = null;
  if (input.status !== undefined && input.status !== null && input.status !== "") {
    if (!isStateGrantStatus(input.status)) {
      return {
        ok: false,
        error: `status must be one of ${STATE_GRANT_STATUSES.join(", ")}.`,
      };
    }
    status = input.status;
  }

  // term — control characters stripped, bounded, wildcards left literal (the
  // store escapes them, so "%" can never widen its own match).
  let term: string | null = null;
  if (input.term !== undefined && input.term !== null) {
    if (typeof input.term !== "string") return { ok: false, error: "term must be a string." };
    const cleaned = cleanText(input.term);
    if (cleaned.length > STATE_GRANT_SEARCH_MAX_TERM) {
      return {
        ok: false,
        error: `term must be at most ${STATE_GRANT_SEARCH_MAX_TERM} characters.`,
      };
    }
    term = cleaned.length > 0 ? cleaned : null;
  }

  // The normalized-column filters, parsed the same way and for the same reason.
  const textFields = [
    "eligibleApplicants",
    "eligibleGeography",
    "awardRange",
    "totalFunding",
    "matchingRequirement",
  ] as const;
  const textValues: Record<string, string | null> = {};
  for (const field of textFields) {
    const parsed = parseTextFilter(input, field);
    if (!parsed.ok) return parsed;
    textValues[field] = parsed.value;
  }

  // categories — a short list of labels, matched case-insensitively against the
  // row's own stored labels. A label carrying a comma, brace or newline is
  // refused: it would be spliced into a list filter and silently widen the match.
  let categories: string[] = [];
  if (input.categories !== undefined && input.categories !== null) {
    if (!Array.isArray(input.categories)) {
      return { ok: false, error: "categories must be an array of strings." };
    }
    if (input.categories.length > STATE_GRANT_MAX_CATEGORIES) {
      return {
        ok: false,
        error: `categories must contain at most ${STATE_GRANT_MAX_CATEGORIES} labels.`,
      };
    }
    for (const entry of input.categories) {
      if (typeof entry !== "string") {
        return { ok: false, error: "categories must be an array of strings." };
      }
      const label = cleanText(entry);
      if (label.length === 0) continue;
      if (label.length > STATE_GRANT_MAX_CATEGORY) {
        return {
          ok: false,
          error: `each category must be at most ${STATE_GRANT_MAX_CATEGORY} characters.`,
        };
      }
      if (/[,\n\r{}]/.test(label)) {
        return {
          ok: false,
          error: "a category must not contain a comma, brace or newline.",
        };
      }
      const key = label.toLowerCase();
      if (!categories.some((c) => c.toLowerCase() === key)) categories.push(label);
    }
  }

  const amountFields = ["awardMinAmount", "awardMaxAmount"] as const;
  const amounts: Record<string, number | null> = {};
  for (const field of amountFields) {
    const parsed = parseAmountFilter(input, field);
    if (!parsed.ok) return parsed;
    amounts[field] = parsed.value;
  }
  if (
    amounts.awardMinAmount !== null &&
    amounts.awardMaxAmount !== null &&
    amounts.awardMinAmount > amounts.awardMaxAmount
  ) {
    return {
      ok: false,
      error: "awardMinAmount must not be greater than awardMaxAmount.",
    };
  }

  // limit / offset — integers, bounded. A limit above the cap is CLAMPED (and
  // reported), never rejected: the cap is ours, not the caller's mistake.
  let limit = STATE_GRANT_DEFAULT_LIMIT;
  let limitCapped = false;
  if (input.limit !== undefined && input.limit !== null) {
    if (
      typeof input.limit !== "number" ||
      !Number.isFinite(input.limit) ||
      !Number.isInteger(input.limit) ||
      input.limit < 1
    ) {
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

  return {
    ok: true,
    params: {
      stateCodes,
      sourceKeys,
      status,
      term,
      eligibleApplicants: textValues.eligibleApplicants,
      eligibleGeography: textValues.eligibleGeography,
      categories,
      awardRange: textValues.awardRange,
      totalFunding: textValues.totalFunding,
      matchingRequirement: textValues.matchingRequirement,
      awardMinAmount: amounts.awardMinAmount,
      awardMaxAmount: amounts.awardMaxAmount,
      limit,
      offset,
      limitCapped,
    },
  };
}

// ── Display rules ───────────────────────────────────────────────────────────

/** Bare host of a URL (no scheme, no www), or NOT_SPECIFIED when unparseable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return NOT_SPECIFIED;
  }
}

/**
 * The official-source label for a record: the publishing body as the source
 * names itself, plus the host it was read from — e.g.
 * "Virginia Tourism Corporation — vatc.org". Neither half is invented: the
 * publisher is the SOURCE's own agency (from state_grant_sources, falling back
 * to the record's agency, then the state's name) and the host comes from the
 * source's own official URL.
 */
export function stateGrantSourceLabel(record: {
  stateCode: string;
  stateName?: string;
  sourceAgency?: string | null;
  agency?: string | null;
  sourceOfficialUrl?: string | null;
  sourceUrl: string;
}): string {
  const candidates = [record.sourceAgency, record.agency];
  const publisher =
    candidates.find((v): v is string => !!v && v.trim().length > 0 && v !== NOT_SPECIFIED) ??
    record.stateName ??
    record.stateCode;
  const official = record.sourceOfficialUrl && record.sourceOfficialUrl.trim()
    ? record.sourceOfficialUrl
    : record.sourceUrl;
  return `${publisher} — ${hostOf(official)}`;
}

/**
 * The ONE date line a card may print, chosen so an estimate can never be read as
 * a deadline, and so a rolling program is never shown with a deadline it does
 * not have.
 */
export function stateGrantDeadlineDisplay(record: {
  status: StateGrantStatus;
  closeDate: string | null;
  estimatedCloseDate: string | null;
}): { label: string; value: string } {
  switch (record.status) {
    case "open":
    case "upcoming":
      return { label: "Closing date", value: record.closeDate ?? NOT_SPECIFIED };
    case "closed":
      return { label: "Closed", value: record.closeDate ?? NOT_SPECIFIED };
    case "rolling":
      return {
        label: "Deadline",
        value: "None — the source declares this program year-round",
      };
    default:
      // unverified: only an ESTIMATE can ever be shown here, and it says so.
      return record.estimatedCloseDate
        ? {
            label: "Estimated deadline",
            value: `${record.estimatedCloseDate} (${STATE_GRANT_ESTIMATE_NOTE})`,
          }
        : {
            label: "Deadline",
            value: "No confirmable dates published — see the official source",
          };
  }
}

/** Honest count sentence for the results header. Never says `forecast`. */
export function describeStateGrantCount(
  status: StateGrantStatus | null,
  count: number,
  exact: boolean,
): string {
  const n = `${count.toLocaleString("en-US")}${exact ? "" : "+"}`;
  const noun = count === 1 ? "record" : "records";
  switch (status) {
    case "open":
      return `${n} ${noun} open for applications`;
    case "upcoming":
      return `${n} upcoming ${count === 1 ? "cycle" : "cycles"} — announced, not open yet`;
    case "rolling":
      return `${n} rolling ${count === 1 ? "program" : "programs"} — the source declares them ongoing`;
    case "closed":
      return `${n} closed ${noun}`;
    case "unverified":
      return `${n} ${noun} with no confirmable dates (unverified)`;
    default:
      return `${n} stored ${noun}`;
  }
}

// ── The record the API returns / the page renders ───────────────────────────

export interface StateGrantRecordView {
  id: string;
  stateCode: string;
  stateName: string;
  /** The source this record belongs to (state_grant_sources.source_key). */
  sourceKey: string;
  /** The source's own human name, as registered — never invented. */
  sourceName: string;
  externalId: string;
  title: string;
  agency: string;
  summary: string;
  status: StateGrantStatus;
  statusLabel: string;
  postedDate: string | null;
  /** Set only for open/upcoming/closed rows; null for rolling and unverified. */
  closeDate: string | null;
  /** An estimate the source published — never a deadline. */
  estimatedCloseDate: string | null;
  /** Exactly what the card may print, already honesty-labelled. */
  deadline: { label: string; value: string };
  /** The record's own page on the official source. */
  url: string;
  /** The official listing page it was read from. */
  sourceUrl: string;
  /** e.g. "Virginia Tourism Corporation — vatc.org". */
  sourceLabel: string;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
  lastSeenAt: string | null;
  // Normalized fields (owner correction 4). NOT_SPECIFIED when the source
  // published nothing — and the store never matches a filter on such a row.
  eligibleApplicants: string;
  eligibleGeography: string;
  categories: string[];
  awardRange: string;
  awardMinAmount: number | null;
  awardMaxAmount: number | null;
  totalFunding: string;
  matchingRequirement: string;
}

/** `Not specified` for an absent/blank source value. */
function orNotSpecified(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : NOT_SPECIFIED;
}

/**
 * Maps a stored row into the view, applying the read-time honesty rules. The
 * status is re-derived against `today`, so a card rendered from a stale row can
 * never claim a deadline that has passed.
 */
export function toStateGrantRecordView(
  row: {
    id: string;
    stateCode: string;
    stateName?: string;
    sourceKey: string;
    sourceName?: string | null;
    sourceAgency?: string | null;
    sourceOfficialUrl?: string | null;
    externalId: string;
    title: string;
    agency: string | null;
    summary: string | null;
    status: StateGrantStatus;
    storedStatus?: StateGrantStatus;
    postedDate: string | null;
    closeDate: string | null;
    estimatedCloseDate: string | null;
    url: string;
    sourceUrl: string;
    sourceUpdatedAt: string | null;
    fetchedAt: string;
    lastSeenAt?: string | null;
    eligibleApplicants: string;
    eligibleGeography: string;
    categories: string[];
    awardRange: string;
    awardMinAmount: number | null;
    awardMaxAmount: number | null;
    totalFunding: string;
    matchingRequirement: string;
  },
  today: string,
): StateGrantRecordView {
  const stateName = row.stateName ?? row.stateCode;
  const status = effectiveStateGrantStatus(row, today);
  // The store guarantees the shape (close_date only for open/upcoming/closed,
  // estimated_close_date only for unverified); this mapping keeps that guarantee
  // visible rather than passing a stale pair through.
  const closeDate = status === "open" || status === "upcoming" || status === "closed" ? row.closeDate : null;
  const estimatedCloseDate = status === "unverified" ? row.estimatedCloseDate : null;
  return {
    id: row.id,
    stateCode: row.stateCode,
    stateName,
    sourceKey: row.sourceKey,
    sourceName: orNotSpecified(row.sourceName),
    externalId: row.externalId,
    title: row.title,
    agency: orNotSpecified(row.agency),
    summary: orNotSpecified(row.summary),
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
      sourceAgency: row.sourceAgency,
      agency: row.agency,
      sourceOfficialUrl: row.sourceOfficialUrl,
      sourceUrl: row.sourceUrl,
    }),
    sourceUpdatedAt: row.sourceUpdatedAt,
    fetchedAt: row.fetchedAt,
    lastSeenAt: row.lastSeenAt ?? null,
    eligibleApplicants: orNotSpecified(row.eligibleApplicants),
    eligibleGeography: orNotSpecified(row.eligibleGeography),
    categories: row.categories ?? [],
    awardRange: orNotSpecified(row.awardRange),
    awardMinAmount: row.awardMinAmount,
    awardMaxAmount: row.awardMaxAmount,
    totalFunding: orNotSpecified(row.totalFunding),
    matchingRequirement: orNotSpecified(row.matchingRequirement),
  };
}
