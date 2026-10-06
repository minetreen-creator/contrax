/**
 * Contrax bid data feed (owner 2026-10-06: "theres got to be another way to get
 * revenue" → sell the bid data to businesses). PURE helpers shared by the feed
 * endpoint, the public /data page and tests — no DB, no server-only imports.
 */

export const FEED_MAX_LIMIT = 500;
export const FEED_DEFAULT_LIMIT = 100;

const USPS = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA",
  "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR",
  "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR", "GU", "VI", "AS", "MP",
]);

export interface FeedQuery {
  /** USPS codes; empty = every state. */
  states: string[];
  /** Only rows created or updated at/after this instant (ISO). */
  updatedSince: string | null;
  /** NAICS prefixes (2–6 digits); empty = any. */
  naics: string[];
  /** Case-insensitive substring of the set-aside label, e.g. "SDVOSB". */
  setAside: string | null;
  limit: number;
  /** Return rows with id greater than this (keyset paging). */
  after: number;
}

export type FeedQueryResult = { ok: true; query: FeedQuery } | { ok: false; error: string };

function list(v: string | null): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Validate the feed's query string. Never throws; returns a 400-ready message. */
export function parseFeedQuery(params: URLSearchParams): FeedQueryResult {
  const states = list(params.get("state")).map((s) => s.toUpperCase());
  const badState = states.find((s) => !USPS.has(s));
  if (badState) return { ok: false, error: `Unknown state code "${badState}". Use two-letter USPS codes, e.g. state=VA,NC.` };

  let updatedSince: string | null = null;
  const us = params.get("updated_since");
  if (us) {
    const t = Date.parse(us);
    if (!Number.isFinite(t)) return { ok: false, error: "updated_since must be an ISO date or timestamp, e.g. 2026-10-01T00:00:00Z." };
    updatedSince = new Date(t).toISOString();
  }

  const naics = list(params.get("naics"));
  const badNaics = naics.find((n) => !/^\d{2,6}$/.test(n));
  if (badNaics) return { ok: false, error: `naics must be 2–6 digits ("${badNaics}" is not).` };

  const setAsideRaw = (params.get("set_aside") ?? "").trim();
  if (setAsideRaw.length > 40) return { ok: false, error: "set_aside is too long." };

  const limitRaw = params.get("limit");
  const limit = limitRaw == null ? FEED_DEFAULT_LIMIT : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > FEED_MAX_LIMIT) {
    return { ok: false, error: `limit must be a whole number from 1 to ${FEED_MAX_LIMIT}.` };
  }

  const afterRaw = params.get("after");
  const after = afterRaw == null ? 0 : Number(afterRaw);
  if (!Number.isInteger(after) || after < 0) return { ok: false, error: "after must be a bid id from a previous page (next_after)." };

  return { ok: true, query: { states, updatedSince, naics, setAside: setAsideRaw || null, limit, after } };
}

export interface FeedRow {
  id: number;
  title: string;
  agency: string;
  description: string | null;
  state: string | null;
  location: string | null;
  category: string | null;
  naics_code: string | null;
  psc: string | null;
  set_aside: string | null;
  notice_type: string | null;
  solicitation_number: string | null;
  due_date: string | null;
  estimated_value: string | null;
  source_url: string | null;
  source: string;
  first_seen_at: string | null;
  updated_at: string | null;
}

const iso = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

/** One DB row → the documented feed shape (field names are the public contract). */
export function toFeedRow(r: Record<string, unknown>): FeedRow {
  return {
    id: Number(r.id),
    title: String(r.title ?? ""),
    agency: String(r.agency ?? ""),
    description: str(r.description),
    state: str(r.normalized_state),
    location: str(r.location),
    category: str(r.category),
    naics_code: str(r.naics_code),
    psc: str(r.psc),
    set_aside: str(r.set_aside),
    notice_type: str(r.notice_type),
    solicitation_number: str(r.solicitation_number),
    due_date: iso(r.due_date),
    estimated_value: str(r.estimated_value),
    source_url: str(r.source_url),
    source: String(r.source ?? ""),
    first_seen_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

export const DATA_REQUEST_USE_CASES = [
  "Proposal writing or bid consulting",
  "Construction estimating or plan room",
  "Software product or platform",
  "Research or analytics",
  "Other",
] as const;
