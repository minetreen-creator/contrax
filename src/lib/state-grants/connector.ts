/**
 * Contrax Grants — State Grants connector contract (owner ROLLOUT order
 * 2026-09-18, part 1; corrections owner 2026-09-19 / R1).
 *
 * PURE MODULE: no DB, no network, no node builtins, no env reads, no import
 * side effects. Every decision below is unit-tested in
 * src/lib/state-grants/state-grants.test.ts. The server half of the rollout
 * (Postgres upserts, the transaction, the sync runner) lives in
 * src/lib/state-grants/store.server.ts and .../sync.server.ts.
 *
 * WHAT A CONNECTOR IS (see CONVENTIONS.md for the prose version)
 *   fetch()          → the RAW source payload (an HTML string for Virginia).
 *   parse(raw)       → SourceGrantRecord[] — normalised, still UNCLASSIFIED, and
 *                      faithful: a field the source does not publish becomes
 *                      NOT_SPECIFIED (or null for a date) and is NEVER inferred.
 *   classify(record) → open | upcoming | rolling | closed | unverified.
 *   dedupe()         → one record per (source, external_id). A re-published
 *                      (amended) record is the SAME external_id, so the store
 *                      updates that row — it never inserts a second one.
 *
 * HONESTY CONTRACT (carried over from the federal grants freshness fix, #399, and
 * corrected by the owner's 2026-09-19 P1 review — the state classifier must not
 * be more permissive than the federal one):
 *   1. `open` requires a PUBLISHED closing date that has not passed (US Eastern
 *      day boundary, the deadline day itself inclusive). A record whose deadline
 *      cannot be confirmed is NEVER open — no exceptions for looking plausible.
 *   2. `upcoming` is a cycle the source ANNOUNCED with published (non-estimated)
 *      dates whose opening date has not arrived yet.
 *   3. `rolling` is a program the SOURCE ITSELF declares ongoing / year-round /
 *      without a deadline: there is no deadline to expire.
 *   4. `closed` means the source's own published closing date has passed, or the
 *      source marks the cycle closed in its own words.
 *   5. `unverified` is the honest home for everything else: dates missing, dates
 *      ambiguous, or an ESTIMATE the source published instead of a date. An
 *      ambiguous record is NEVER auto-classified as a future cycle ("forecast" is
 *      deliberately not a status any more).
 *   6. An estimate (e.g. "est. 2026-10-29") lives ONLY in `estimatedCloseDate`,
 *      is stored in the `estimated_close_date` column, and is never promoted into
 *      `closeDate`: a row whose only date is an estimate is `unverified`.
 *   7. Every displayed string is the source's own words, else NOT_SPECIFIED.
 *      Nothing is averaged, inferred, generated or back-filled.
 *
 * IDENTITY is (source, external_id) — see `dedupeByExternalId`. The same
 * external id published by two different agencies in one state is TWO records;
 * `stateCode` alone can never merge them.
 *
 * ISOLATION: nothing in this module (and none of the state tables) is part of
 * the federal /grants experience, the Radar funnel, or any grants_* event.
 */
import { easternDayStart } from "~/lib/grants";

/** Shown wherever the source published no value (federal grants wording). */
export const NOT_SPECIFIED = "Not specified";

/** Two-letter USPS state codes, plus DC. */
export type StateCode = string;

/**
 * The owner's ordered status model (2026-09-19). Derived — never chosen by a
 * connector, and never hand-set in the database.
 */
export type StateGrantStatus = "open" | "upcoming" | "rolling" | "closed" | "unverified";

export const STATE_GRANT_STATUSES: readonly StateGrantStatus[] = [
  "open",
  "upcoming",
  "rolling",
  "closed",
  "unverified",
] as const;

/**
 * The canonical display order, best-first (mirrors the query surface's ORDER BY
 * so a UI and the API can never disagree about what "first" means).
 */
export const STATE_GRANT_STATUS_ORDER: readonly StateGrantStatus[] = STATE_GRANT_STATUSES;

/** Human labels. `unverified` says exactly what is unknown — never "forecast". */
export const STATE_GRANT_STATUS_LABELS: Record<StateGrantStatus, string> = {
  open: "Open — accepting applications",
  upcoming: "Upcoming — announced cycle, not open yet",
  rolling: "Rolling — the source declares the program ongoing",
  closed: "Closed",
  unverified: "Unverified — the source published no confirmable dates",
};

export function isStateGrantStatus(value: unknown): value is StateGrantStatus {
  return typeof value === "string" && (STATE_GRANT_STATUSES as readonly string[]).includes(value);
}

// ── Dates ────────────────────────────────────────────────────────────────────

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

/**
 * Parses a source-published date into a `YYYY-MM-DD` string.
 *
 * Accepted (all of these appear on the Virginia source, verified live
 * 2026-09-19): "February 10, 2026" (the long form the VTC grants page uses),
 * "2026-09-22" (ISO), "09/22/2026" (the federal MM/DD/YYYY form) and
 * "September 22, 2026." (trailing punctuation). Anything else returns null —
 * guessing a date is exactly the fabrication this feature forbids. Two-digit
 * years are deliberately NOT accepted (ambiguous, and the source never uses
 * them).
 */
export function parseStateDay(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/[.)]+$/, "");
  if (!text) return null;

  // ISO first: 2026-09-22
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return buildDay(Number(m[3]), Number(m[2]), Number(m[1]));

  // US numeric: 09/22/2026
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (m) return buildDay(Number(m[2]), Number(m[1]), Number(m[3]));

  // Long form: "February 10, 2026" / "Feb 10, 2026" / "10 February 2026"
  m = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (m) {
    const month = monthNumber(m[1]);
    if (month === null) return null;
    return buildDay(Number(m[2]), month, Number(m[3]));
  }
  m = /^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/.exec(text);
  if (m) {
    const month = monthNumber(m[2]);
    if (month === null) return null;
    return buildDay(Number(m[1]), month, Number(m[3]));
  }
  return null;
}

function monthNumber(name: string): number | null {
  const key = name.trim().toLowerCase();
  for (let i = 0; i < MONTHS.length; i++) {
    const full = MONTHS[i];
    if (key === full || (key.length >= 3 && full.startsWith(key))) return i + 1;
  }
  return null;
}

/** Calendar-day check: rejects 2026-02-30 and friends (never rolls over). */
function buildDay(day: number, month: number, year: number): string | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** `YYYY-MM-DD` → the UTC-midnight epoch of that day (null when unusable). */
export function stateDayEpoch(raw: string | null): number | null {
  const day = parseStateDay(raw);
  if (day === null) return null;
  return Date.parse(`${day}T00:00:00Z`);
}

// ── Estimates (the owner's 2026-09-19 rule: an estimate is never a deadline) ──

/**
 * Words a source uses to mark a date as an ESTIMATE rather than a published
 * date. Kept explicit (no bare "target"/"expected in" patterns) so the list can
 * be audited: a false positive here would send a real deadline to `unverified`.
 */
const ESTIMATE_WORDS = [
  "est\\.?",
  "estimated",
  "approx\\.?",
  "approximately",
  "tentative",
  "anticipated",
  "expected",
  "projected",
] as const;

const ESTIMATE_RE = new RegExp(`(?:^|[\\s(])(${ESTIMATE_WORDS.join("|")})(?=[\\s),.:]|$)`, "i");
const ESTIMATE_PAREN_RE = new RegExp(`\\(\\s*(${ESTIMATE_WORDS.join("|")})\\s*\\)`, "gi");
/**
 * The marker plus the punctuation glued to it, but NOT the date: "est. 2026-10-29"
 * → "2026-10-29", "Estimated: October 29, 2026" → "October 29, 2026". The
 * trailing `\b` of a naive word match would stop before the "." of "est." and
 * leave it behind, so this pattern matches the word AND its punctuation.
 */
const ESTIMATE_PREFIX_RE = new RegExp(
  `(?:^|[\\s(])(?:${ESTIMATE_WORDS.join("|")})\\s*[:,-]?\\s*`,
  "gi",
);

/** True when the source's own text marks this value as an estimate. */
export function isEstimatedText(raw: unknown): boolean {
  return typeof raw === "string" && ESTIMATE_RE.test(raw);
}

/**
 * Removes an estimate marker so the underlying date can be parsed exactly:
 * "est. 2026-10-29" → "2026-10-29", "October 29, 2026 (estimated)" →
 * "October 29, 2026". The marker is preserved on the record as a boolean, never
 * silently dropped (see isEstimatedText).
 */
export function stripEstimateMarkers(raw: string): string {
  return raw
    .replace(ESTIMATE_PAREN_RE, " ")
    .replace(ESTIMATE_PREFIX_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Content fingerprint (change detection, NOT a security primitive) ─────────

/**
 * Content hash of the parsed record. Its ONLY job is change detection: an
 * identical payload produces an identical value (so a re-run writes nothing at
 * all), a materially changed payload produces a different one (an amendment to
 * the same row).
 *
 * Implemented as four independent FNV-1a 32-bit lanes over the canonical JSON,
 * concatenated into 32 hex chars. It is deliberately dependency-free so the
 * pure module stays pure (no `node:crypto`, and therefore nothing for a future
 * client bundle to trip over). The row IDENTITY is (source_id, external_id) —
 * this value is never used for uniqueness, so a non-cryptographic hash is the
 * right tool here. Documented rather than assumed.
 */
export function contentFingerprint(value: unknown): string {
  const canonical = canonicalJson(value);
  const lanes = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  for (let i = 0; i < canonical.length; i++) {
    const code = canonical.charCodeAt(i);
    for (let lane = 0; lane < lanes.length; lane++) {
      const mixed = (code + lane) & 0xffff;
      lanes[lane] = Math.imul(lanes[lane] ^ mixed, 16777619) >>> 0;
    }
  }
  return lanes.map((h) => h.toString(16).padStart(8, "0")).join("");
}

/** Deterministic JSON: object keys sorted, so key order can never matter. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** URL or title → a stable slug used only to DERIVE an external id. */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&[a-z]+;/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

// ── Records ─────────────────────────────────────────────────────────────────

/**
 * A normalised-but-UNCLASSIFIED source record. Every field is either the
 * source's own value or NOT_SPECIFIED/null — a connector may never invent one.
 *
 * `sourceKey` is the id of the SOURCE this record came from (the connector's own
 * id, stamped by `parseGrantOpportunities` so it can never drift from the
 * connector that produced it). It is half of the row identity.
 */
export interface SourceGrantRecord {
  /** The source's stable key (the connector id), e.g. "va-vtc-grants". */
  sourceKey: string;
  stateCode: StateCode;
  /** The source's own id for this opportunity (stable across runs). */
  externalId: string;
  title: string;
  agency: string;
  summary: string;
  /** The opportunity's own page on the official source. */
  url: string;
  /** The official listing page it was parsed from. */
  sourceUrl: string;
  /** Source-published opening date ('YYYY-MM-DD'), null when none published. */
  postedDate: string | null;
  /** Source-published closing date ('YYYY-MM-DD'), null when none published. */
  closeDate: string | null;
  /**
   * A date the source published ONLY as an estimate ('YYYY-MM-DD'), or null.
   * Never a deadline — see the honesty contract.
   */
  estimatedCloseDate: string | null;
  /** True ONLY when the source itself declares the program ongoing/rolling. */
  ongoing: boolean;
  /** True when the source itself marks this cycle closed (past-tense label). */
  sourceClosed: boolean;
  /** The source's own per-record updated stamp, when it publishes one. */
  sourceUpdatedAt: string | null;
  // ── Normalized fields (owner 2026-09-19, correction 4) ────────────────────
  // Real columns so part 2 can filter. Each is the source's own words, or
  // NOT_SPECIFIED ("Not specified") when the source published nothing.
  eligibleApplicants: string;
  eligibleGeography: string;
  /** Source-published categories/focus labels; EMPTY when it published none. */
  categories: string[];
  awardRange: string;
  awardMinAmount: number | null;
  awardMaxAmount: number | null;
  totalFunding: string;
  matchingRequirement: string;
  /** The parsed source fields verbatim (no HTML, no invented keys). */
  raw: Record<string, unknown>;
}

/** The classification decision for one record, with the reason it was made. */
export interface GrantClassification {
  status: StateGrantStatus;
  postedDate: string | null;
  /** Set only when the source PUBLISHED a closing date (open/upcoming/closed). */
  closeDate: string | null;
  /**
   * Set ONLY when the source published an estimate and no usable published
   * closing date exists (an `unverified` row whose only date is an estimate).
   */
  estimatedCloseDate: string | null;
  /** Why — stored with the record so a reviewer can re-derive the decision. */
  reason: string;
}

/** A record plus its classification and content fingerprint. */
export interface GrantOpportunity extends SourceGrantRecord {
  status: StateGrantStatus;
  estimatedCloseDate: string | null;
  fingerprint: string;
  /** Why this status (see GrantClassification.reason). */
  statusReason: string;
}

/**
 * The freshness decision for one state record (the state counterpart of
 * classifyGrantStatus() in src/lib/grants.ts, with the same day boundary).
 *
 * `today` is the start of the current US Eastern day, so the deadline day itself
 * is still open — the federal rule, reused rather than re-invented.
 *
 * TRUTH TABLE (in evaluation order — the full table is in CONVENTIONS.md):
 *   1. source marks the cycle closed              → closed   (its words win)
 *   2. source declares ongoing/year-round         → rolling  (close_date NULL)
 *   3. published close date, opening date later   → upcoming (close_date set)
 *   4. published close date >= today              → open
 *   5. published close date < today               → closed
 *   6. no published close date, published estimate→ unverified (estimate kept in
 *                                                    estimated_close_date)
 *   7. anything else (no dates, or an opening date with no closing date) →
 *      unverified. Never "open", and never a forecast of a cycle we cannot see.
 */

/**
 * What an announced-but-not-yet-open cycle is reported as — the one judgement
 * call in the owner's status model, kept as ONE explicit constant.
 *
 * The owner defined `upcoming` as "announced not-yet-open cycle (published,
 * non-estimated dates)", so a cycle whose source publishes real dates and whose
 * opening date has not arrived yet is `upcoming`, and its published closing date
 * is a published close date — not an estimate. The same 2026-09-19 review note
 * called Virginia's Special Events cycle "est. only"; the live page publishes
 * that cycle's dates with NO estimate marker anywhere (verified 2026-09-19), so
 * it classifies as `upcoming` here. This constant is the whole decision: set it
 * to "unverified" to treat every announced-not-yet-open cycle as unverified
 * instead, in which case the announced date is kept (labelled as an estimate) in
 * estimated_close_date and close_date stays empty. Nothing else changes — a
 * record whose only date is already an estimate is ALWAYS unverified.
 */
export const ANNOUNCED_CYCLE_STATUS: "upcoming" | "unverified" = "upcoming";

/** The freshness decision for one state record's announced-cycle branch. */
function announcedCycleStatus(): StateGrantStatus {
  return ANNOUNCED_CYCLE_STATUS;
}

export function classifyStateGrant(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  const today = easternDayStart(now);
  const openDay = stateDayEpoch(record.postedDate);
  const closeDay = stateDayEpoch(record.closeDate);
  const estimateDay = stateDayEpoch(record.estimatedCloseDate);
  const usableToday = !Number.isNaN(today);

  // 1. The source's own past-tense words win over any date that looks future.
  if (record.sourceClosed) {
    return {
      status: "closed",
      postedDate: record.postedDate,
      closeDate: record.closeDate,
      estimatedCloseDate: null,
      reason: "source marks this cycle closed",
    };
  }

  // 2. An explicit ongoing / year-round declaration is a program with no
  //    deadline to expire (the source's own words, not an inference).
  if (record.ongoing) {
    return {
      status: "rolling",
      postedDate: record.postedDate,
      closeDate: null,
      estimatedCloseDate: null,
      reason:
        "source declares the program ongoing (year-round / rolling / no time limitations), so there is no deadline to expire",
    };
  }

  // 3-5. A published closing date is the only thing that can make a record open
  //      or upcoming, or (once it passes) closed.
  if (closeDay !== null) {
    if (openDay !== null && usableToday && openDay > today) {
      const announced = announcedCycleStatus();
      return {
        status: announced,
        postedDate: record.postedDate,
        // In `upcoming` mode the source's published close date IS a close date.
        // In the alternative mode the announced date is kept as an ESTIMATE, so
        // it can never be shown as a deadline.
        closeDate: announced === "upcoming" ? record.closeDate : null,
        estimatedCloseDate: announced === "upcoming" ? null : record.closeDate,
        reason:
          announced === "upcoming"
            ? "source published a cycle whose opening date has not arrived yet — upcoming, not open"
            : "source published a cycle whose opening date has not arrived yet — the announced date is an estimate, so the record is unverified rather than open",
      };
    }
    if (usableToday && closeDay >= today) {
      return {
        status: "open",
        postedDate: record.postedDate,
        closeDate: record.closeDate,
        estimatedCloseDate: null,
        reason: "source confirms a published closing date that has not passed (deadline day inclusive)",
      };
    }
    return {
      status: "closed",
      postedDate: record.postedDate,
      closeDate: record.closeDate,
      estimatedCloseDate: null,
      reason: "source's published closing date has passed",
    };
  }

  // 6. The source published an ESTIMATE instead of a date: keep it, label it as
  //    an estimate, and do not claim the cycle is open.
  if (estimateDay !== null) {
    return {
      status: "unverified",
      postedDate: record.postedDate,
      closeDate: null,
      estimatedCloseDate: record.estimatedCloseDate,
      reason:
        "the source published only an ESTIMATED date and no closing date — unverified, and the estimate is never treated as a deadline",
    };
  }

  // 7. No usable dates at all (or an opening date with no closing date): we
  //    cannot confirm the source is accepting applications.
  const reason =
    openDay !== null
      ? "the source published an opening date but no closing date — we cannot confirm the cycle is accepting applications (never open, never a forecast)"
      : "the source published no usable dates — unverified rather than guessed";
  return {
    status: "unverified",
    postedDate: record.postedDate,
    closeDate: null,
    estimatedCloseDate: null,
    reason,
  };
}

/** Builds the row-ready opportunity: record + classification + fingerprint. */
export function toOpportunity(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantOpportunity {
  const classification = classifyStateGrant(record, now);
  return {
    ...record,
    status: classification.status,
    closeDate: classification.closeDate,
    estimatedCloseDate: classification.estimatedCloseDate,
    statusReason: classification.reason,
    fingerprint: contentFingerprint({
      sourceKey: record.sourceKey,
      stateCode: record.stateCode,
      externalId: record.externalId,
      title: record.title,
      agency: record.agency,
      summary: record.summary,
      url: record.url,
      postedDate: record.postedDate,
      closeDate: record.closeDate,
      estimatedCloseDate: record.estimatedCloseDate,
      ongoing: record.ongoing,
      sourceClosed: record.sourceClosed,
      sourceUpdatedAt: record.sourceUpdatedAt,
      eligibleApplicants: record.eligibleApplicants,
      eligibleGeography: record.eligibleGeography,
      categories: record.categories,
      awardRange: record.awardRange,
      awardMinAmount: record.awardMinAmount,
      awardMaxAmount: record.awardMaxAmount,
      totalFunding: record.totalFunding,
      matchingRequirement: record.matchingRequirement,
      raw: record.raw,
    }),
  };
}

export interface DedupeResult {
  records: SourceGrantRecord[];
  /** `<source>:<external_id>` for every duplicate a payload contained. */
  collisions: string[];
}

/**
 * One record per (SOURCE, external_id) — the first occurrence wins, and every
 * collision is reported rather than silently dropped.
 *
 * The key is the source key, NOT the state code (owner correction 1,
 * 2026-09-19): two agencies in one state can and do publish the same short
 * program id, and under a state-keyed identity the second would look like a
 * duplicate of the first instead of a record of its own. A payload is one
 * source's page, so the state code is implied — the source key is what actually
 * distinguishes two publishers.
 *
 * An amendment arrives as the SAME (source, external_id) with different content,
 * so it is not a collision: it is one record here and one updated row in the
 * store.
 */
export function dedupeByExternalId(records: readonly SourceGrantRecord[]): DedupeResult {
  const seen = new Map<string, SourceGrantRecord>();
  const order: string[] = [];
  const collisions: string[] = [];
  for (const record of records) {
    const key = `${record.sourceKey}:${record.externalId}`;
    if (seen.has(key)) {
      collisions.push(key);
      continue;
    }
    seen.set(key, record);
    order.push(key);
  }
  return { records: order.map((k) => seen.get(k)!), collisions };
}

// ── The connector contract ──────────────────────────────────────────────────

/**
 * What every state connector must implement. `sourceUrl` is HARD-CODED in the
 * connector (there is no client-controllable URL anywhere in this flow) and
 * `officialHost` is cross-checked against the approved-host allowlist in
 * registry.ts before a state may report anything above `unavailable`.
 *
 * A connector IS a source: its `id` is the `state_grant_sources.source_key`, and
 * `sourceName` / `agency` populate that row. A state with several sources has
 * several connectors, and their records can never collide, because the row
 * identity is (source, external_id).
 */
export interface StateGrantConnector<TRaw = unknown> {
  /** Stable id, e.g. "va-vtc-grants". The source key, and the registry's id. */
  readonly id: string;
  readonly stateCode: StateCode;
  /** Human name of the state, for the coverage UI. */
  readonly stateName: string;
  /** Human name of the SOURCE (the listing), for the sources registry. */
  readonly sourceName: string;
  /** The publishing body, in the source's own words where it names itself. */
  readonly agency: string;
  /** The one official source this connector reads. */
  readonly sourceUrl: string;
  /** Host that must be on the approved allowlist (fail-closed gate). */
  readonly officialHost: string;
  /** The body-name of the source-validation test that gates the state's tier. */
  readonly sourceValidationTest: string;
  /**
   * Fetches the raw source payload. Must throw on any failure (fail-closed).
   * An optional `stage: "fetch" | "parse"` on the thrown error is honoured by
   * the sync runner; without it the runner attributes the failure to the phase
   * it escaped from (fetch() → "fetch", parse/classify → "parse").
   */
  fetch(now?: Date): Promise<TRaw>;
  /** Parses the raw payload into normalised, unclassified records. */
  parse(raw: TRaw): SourceGrantRecord[];
  /**
   * Classifies one record. Defaults to classifyStateGrant() — a connector may
   * override it only to be STRICTER, and any override must keep the honesty
   * contract in this file's header.
   */
  classify(record: SourceGrantRecord, now?: Date): GrantClassification;
}

/**
 * Applies a connector to a raw payload: parse → stamp the source key → dedupe →
 * classify. The source key is stamped from the CONNECTOR, not trusted from the
 * payload, so a record can never claim to come from a source it did not.
 */
export function parseGrantOpportunities<TRaw>(
  connector: StateGrantConnector<TRaw>,
  raw: TRaw,
  now: Date | number = new Date(),
): { opportunities: GrantOpportunity[]; collisions: string[] } {
  const parsed = connector.parse(raw).map((r) => ({ ...r, sourceKey: connector.id }));
  const { records, collisions } = dedupeByExternalId(parsed);
  return { opportunities: records.map((r) => toOpportunity(r, now)), collisions };
}
