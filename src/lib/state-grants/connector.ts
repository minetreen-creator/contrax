/**
 * Contrax Grants — State Grants connector contract (owner ROLLOUT order
 * 2026-09-18, part 1: data infrastructure + the Virginia reference connector).
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
 *   classify(record) → open | forecast | closed, plus which date is which.
 *   dedupe()         → one record per (state, external_id). A re-published
 *                      (amended) record is the SAME external_id, so the store
 *                      updates that row — it never inserts a second one.
 *
 * HONESTY CONTRACT (carried over verbatim from the federal grants freshness fix,
 * #399 — the state classifier must not be more permissive than the federal one):
 *   1. `open` requires a published closing date that has not passed (US Eastern
 *      day boundary, the deadline day itself is inclusive) OR an explicit
 *      source-declared ongoing/rolling program. A record whose deadline cannot
 *      be confirmed is NEVER open — no exceptions for looking plausible.
 *   2. `forecast` covers a cycle the source announces but has not opened yet,
 *      and a record the source published without a usable deadline. A forecast's
 *      announced date is written to `estimatedCloseDate` and is NEVER promoted
 *      into `closeDate`, so an estimate can never masquerade as a deadline.
 *   3. `closed` means the source's own published closing date has passed.
 *   4. Every displayed string is the source's own words, else NOT_SPECIFIED.
 *      Nothing is averaged, inferred, generated or back-filled.
 *
 * ISOLATION: nothing in this module (and none of the state tables) is part of
 * the federal /grants experience, the Radar funnel, or any grants_* event.
 */
import { easternDayStart } from "~/lib/grants";

/** Shown wherever the source published no value (federal grants wording). */
export const NOT_SPECIFIED = "Not specified";

/** Two-letter USPS state codes, plus DC. */
export type StateCode = string;

/** The three states the store records. Derived — never chosen by a connector. */
export type StateGrantStatus = "open" | "forecast" | "closed";

export const STATE_GRANT_STATUSES: readonly StateGrantStatus[] = [
  "open",
  "forecast",
  "closed",
] as const;

/** Human labels (mirrors the federal labels so the copy cannot drift). */
export const STATE_GRANT_STATUS_LABELS: Record<StateGrantStatus, string> = {
  open: "Open — accepting applications",
  forecast: "Forecast — not yet open for applications",
  closed: "Closed",
};

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
 * client bundle to trip over). The row IDENTITY is (state_code, external_id) —
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
 */
export interface SourceGrantRecord {
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
  /** True ONLY when the source itself declares the program ongoing/rolling. */
  ongoing: boolean;
  /** True when the source itself marks this cycle closed (past-tense label). */
  sourceClosed: boolean;
  /** The source's own per-record updated stamp, when it publishes one. */
  sourceUpdatedAt: string | null;
  /** The parsed source fields verbatim (no HTML, no invented keys). */
  raw: Record<string, unknown>;
}

/** The classification decision for one record, with the reason it was made. */
export interface GrantClassification {
  status: StateGrantStatus;
  postedDate: string | null;
  /** Set ONLY for open/closed — never for a forecast. */
  closeDate: string | null;
  /** Set ONLY for a forecast whose source announced dates. */
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
 */
export function classifyStateGrant(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  const today = easternDayStart(now);
  const openDay = stateDayEpoch(record.postedDate);
  const closeDay = stateDayEpoch(record.closeDate);

  // 1. The source's own words first, conservatively: an explicit ongoing
  //    declaration is an open program with no deadline to expire, and an
  //    explicit "closed" marker is closed even if a stray date looks future.
  if (record.ongoing) {
    return {
      status: "open",
      postedDate: record.postedDate,
      closeDate: null,
      estimatedCloseDate: null,
      reason: "source declares the program ongoing (year-round / rolling), so there is no deadline to expire",
    };
  }
  if (record.sourceClosed) {
    return {
      status: "closed",
      postedDate: record.postedDate,
      closeDate: record.closeDate,
      estimatedCloseDate: null,
      reason: "source marks this cycle closed",
    };
  }

  // 2. No usable closing date → never open. A forecast is the honest home for
  //    "the source published this, but not when it closes".
  if (closeDay === null) {
    return {
      status: "forecast",
      postedDate: record.postedDate,
      closeDate: null,
      estimatedCloseDate: null,
      reason: "source published no usable closing date — not confirmed open",
    };
  }

  // 3. A cycle the source announces but has not opened yet: the announced close
  //    date is an ESTIMATE, not a deadline.
  if (openDay !== null && !Number.isNaN(today) && openDay > today) {
    return {
      status: "forecast",
      postedDate: record.postedDate,
      closeDate: null,
      estimatedCloseDate: record.closeDate,
      reason: "source announces a cycle that has not opened yet — the announced closing date is an estimate, not a deadline",
    };
  }

  // 4. Confirmable: a published closing date that has not passed (inclusive).
  if (!Number.isNaN(today) && closeDay >= today) {
    return {
      status: "open",
      postedDate: record.postedDate,
      closeDate: record.closeDate,
      estimatedCloseDate: null,
      reason: "source confirms a published closing date that has not passed (deadline day inclusive)",
    };
  }

  // 5. Past deadline.
  return {
    status: "closed",
    postedDate: record.postedDate,
    closeDate: record.closeDate,
    estimatedCloseDate: null,
    reason: "source's published closing date has passed",
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
      stateCode: record.stateCode,
      externalId: record.externalId,
      title: record.title,
      agency: record.agency,
      summary: record.summary,
      url: record.url,
      postedDate: record.postedDate,
      closeDate: record.closeDate,
      ongoing: record.ongoing,
      sourceClosed: record.sourceClosed,
      sourceUpdatedAt: record.sourceUpdatedAt,
      raw: record.raw,
    }),
  };
}

export interface DedupeResult {
  records: SourceGrantRecord[];
  /** `<state>:<external_id>` for every duplicate a payload contained. */
  collisions: string[];
}

/**
 * One record per (state, external_id) — the first occurrence wins, and every
 * collision is reported rather than silently dropped. An amendment arrives as
 * the SAME external_id with different content, so it is not a collision: it is
 * one record here and one updated row in the store.
 */
export function dedupeByExternalId(records: readonly SourceGrantRecord[]): DedupeResult {
  const seen = new Map<string, SourceGrantRecord>();
  const order: string[] = [];
  const collisions: string[] = [];
  for (const record of records) {
    const key = `${record.stateCode}:${record.externalId}`;
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
 * registry.ts before a state may report `connected`.
 */
export interface StateGrantConnector<TRaw = unknown> {
  /** Stable id, e.g. "va-vtc-grants". Stored on the registry row. */
  readonly id: string;
  readonly stateCode: StateCode;
  /** Human name of the state, for the coverage UI. */
  readonly stateName: string;
  /** The one official source this connector reads. */
  readonly sourceUrl: string;
  /** Host that must be on the approved allowlist (fail-closed gate). */
  readonly officialHost: string;
  /** The body-name of the source-validation test that gates `connected`. */
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

/** The full pipeline a connector run uses: parse → classify → dedupe. */
export function parseGrantOpportunities<TRaw>(
  connector: StateGrantConnector<TRaw>,
  raw: TRaw,
  now: Date | number = new Date(),
): { opportunities: GrantOpportunity[]; collisions: string[] } {
  const parsed = connector.parse(raw);
  const { records, collisions } = dedupeByExternalId(parsed);
  return { opportunities: records.map((r) => toOpportunity(r, now)), collisions };
}
