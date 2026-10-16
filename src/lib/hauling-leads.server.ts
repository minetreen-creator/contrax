/**
 * Hauling leads — database + USAspending sync (trucking queue item #4, 2026-10-16).
 *
 * The table is created lazily (additive) like award_leads; db/migrations/063_hauling_leads.sql
 * is the reviewed DDL that the operator applies to production FIRST (run-063.ts proves it).
 *
 * The read surface is /subcontracts (the section below the SUBNet board) through
 * GET /api/hauling-leads. The write path is src/jobs/hauling-leads-sync.ts, run by
 * .github/workflows/sync-hauling-leads.yml (Monday 13:30 UTC).
 */
import { sql } from "~/db";
import {
  HAULING_LEAD_MAX_PAGES,
  HAULING_LEAD_MIN_AMOUNT,
  HAULING_LEAD_WINDOW_DAYS,
  buildHaulingSearchBody,
  isStorableHaulingLead,
  toHaulingLead,
  windowStartFor,
  type HaulingLead,
} from "~/lib/hauling-leads";

/** The reviewed DDL, mirrored for the lazy path (kept in step with migration 063). */
export async function ensureHaulingLeadsTable(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS hauling_leads (
    id SERIAL PRIMARY KEY,
    award_key TEXT NOT NULL UNIQUE,
    award_id TEXT NOT NULL,
    award_date DATE,
    pop_state TEXT,
    pop_city TEXT,
    prime_name TEXT NOT NULL,
    prime_uei TEXT,
    amount BIGINT NOT NULL,
    naics_code TEXT,
    naics_description TEXT,
    agency TEXT,
    usa_spending_url TEXT NOT NULL,
    description_snippet TEXT NOT NULL,
    hauling_scope BOOLEAN NOT NULL DEFAULT TRUE,
    scope_kind TEXT NOT NULL,
    prime_kind TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql()`CREATE INDEX IF NOT EXISTS hauling_leads_award_date_idx ON hauling_leads (award_date DESC, id DESC)`;
  await sql()`CREATE INDEX IF NOT EXISTS hauling_leads_pop_state_idx ON hauling_leads (pop_state)`;
}

/** Insert new leads; an award already stored is left as first seen. Returns rows inserted. */
export async function insertHaulingLeads(rows: readonly HaulingLead[]): Promise<number> {
  let inserted = 0;
  for (const r of rows) {
    // Defence in depth: the sync already withholds placeholder-named rows before it
    // calls this, but the store boundary refuses one too, so no future call site can
    // put a non-approachable recipient name in front of a customer.
    if (!isStorableHaulingLead(r)) continue;
    const res = (await sql()`
      INSERT INTO hauling_leads (award_key, award_id, award_date, pop_state, pop_city, prime_name, prime_uei, amount,
                                 naics_code, naics_description, agency, usa_spending_url, description_snippet,
                                 hauling_scope, scope_kind, prime_kind)
      VALUES (${r.award_key}, ${r.award_id}, ${r.award_date}, ${r.pop_state}, ${r.pop_city}, ${r.prime_name}, ${r.prime_uei}, ${r.amount},
              ${r.naics_code}, ${r.naics_description}, ${r.agency}, ${r.usa_spending_url}, ${r.description_snippet},
              ${r.hauling_scope}, ${r.scope_kind}, ${r.prime_kind})
      ON CONFLICT (award_key) DO NOTHING
      RETURNING id`) as unknown[];
    inserted += res.length;
  }
  return inserted;
}

function rowToLead(r: Record<string, unknown>): HaulingLead & { id: number } {
  const asDate = (v: unknown) =>
    v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
  return {
    id: Number(r.id),
    award_key: String(r.award_key),
    award_id: String(r.award_id),
    award_date: asDate(r.award_date),
    pop_state: (r.pop_state as string) ?? null,
    pop_city: (r.pop_city as string) ?? null,
    prime_name: String(r.prime_name),
    prime_uei: (r.prime_uei as string) ?? null,
    amount: Number(r.amount),
    naics_code: (r.naics_code as string) ?? null,
    naics_description: (r.naics_description as string) ?? null,
    agency: (r.agency as string) ?? null,
    usa_spending_url: String(r.usa_spending_url),
    description_snippet: String(r.description_snippet),
    hauling_scope: r.hauling_scope === true,
    scope_kind: r.scope_kind as HaulingLead["scope_kind"],
    prime_kind: r.prime_kind as HaulingLead["prime_kind"],
  };
}

export interface HaulingLeadsView {
  rows: (HaulingLead & { id: number })[];
  /** Rows stored for the whole country (the fallback set, and the honest denominator). */
  stored: number;
  /** Rows stored whose place of performance is the requested state. */
  inState: number;
  /** The state asked for, when one was asked for. */
  state: string | null;
  /** True when a state was asked for and NOTHING was found for it, so all states are shown. */
  nationalFallback: boolean;
  /** Newest award date among the rows stored, or null when the table is empty. */
  newestAwardDate: string | null;
}

/**
 * The section's read: newest-first, capped. With a state selected it shows that
 * state's leads; when that state has none in the stored window it falls back to the
 * national list and SAYS SO (nationalFallback), rather than showing an empty box.
 */
export async function queryHaulingLeads(opts: {
  state?: string | null;
  limit: number;
}): Promise<HaulingLeadsView> {
  await ensureHaulingLeadsTable();
  const s = sql();
  const state = opts.state && /^[A-Za-z]{2}$/.test(opts.state) ? opts.state.toUpperCase() : null;
  const totals = (await s`
    SELECT COUNT(*)::int AS stored,
           COUNT(*) FILTER (WHERE pop_state = ${state})::int AS in_state
    FROM hauling_leads`) as { stored: number; in_state: number }[];
  const stored = Number(totals[0]?.stored ?? 0);
  const inState = state ? Number(totals[0]?.in_state ?? 0) : stored;
  const nationalFallback = !!state && inState === 0;
  const useState = state && !nationalFallback ? state : null;
  const rows = (await s`
    SELECT * FROM hauling_leads
    WHERE (${useState}::text IS NULL OR pop_state = ${useState})
    ORDER BY award_date DESC NULLS LAST, id DESC
    LIMIT ${opts.limit}`) as Record<string, unknown>[];
  const newest = (await s`SELECT MAX(award_date)::text AS d FROM hauling_leads`) as { d: string | null }[];
  return {
    rows: rows.map(rowToLead),
    stored,
    inState,
    state,
    nationalFallback,
    newestAwardDate: newest[0]?.d ?? null,
  };
}

const API = "https://api.usaspending.gov/api/v2/search/spending_by_award/";

export interface HaulingSyncResult {
  windowStart: string;
  windowEnd: string;
  pages: number;
  seen: number;
  /** Rows the ladder kept (definition R — the measured set, placeholders included). */
  kept: number;
  /** R-kept rows the sync withheld because the recipient name is a placeholder. */
  placeholderSkipped: number;
  inserted: number;
  /** The leads this run stores and reports: definition R minus placeholder-named rows. */
  leads: HaulingLead[];
  /** Per-run scope breakdown, so a run's mix is visible in the log. */
  byScopeKind: Record<string, number>;
  byPrimeKind: Record<string, number>;
}

/**
 * Pull the 30-day rolling window of newly made contract awards from USAspending and
 * keep the ones that pass definition R. Idempotent: an award already stored is not
 * rewritten (ON CONFLICT (award_key) DO NOTHING).
 *
 * DEFINITION R IS NOT CHANGED HERE. The ladder's own output is reported as `kept`; the
 * rows it produces whose recipient name is a USAspending PLACEHOLDER (see
 * HAULING_PLACEHOLDER_RECIPIENT_NAMES — "MISCELLANEOUS FOREIGN AWARDEES" & co, whose
 * row QA found rendered as a prime contractor) are counted as `placeholderSkipped` and
 * never stored or shown. That is an approachability guard on the WRITE path only, so the
 * census reference number (99 awards/yr) is unaffected — see the note in the list's
 * comment before "re-reconciling" anything against the stored row count.
 */
export async function syncHaulingLeads(
  opts: {
    days?: number;
    maxPages?: number;
    dryRun?: boolean;
    now?: Date;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<HaulingSyncResult> {
  const days = opts.days ?? HAULING_LEAD_WINDOW_DAYS;
  const maxPages = opts.maxPages ?? HAULING_LEAD_MAX_PAGES;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? new Date();
  const windowStart = windowStartFor(now, days);
  const windowEnd = now.toISOString().slice(0, 10);
  if (!opts.dryRun) await ensureHaulingLeadsTable();

  const leads: HaulingLead[] = [];
  let pages = 0;
  let seen = 0;
  let inserted = 0;
  let placeholderSkipped = 0;
  for (let page = 1; page <= maxPages; page++) {
    const res = await doFetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Contrax/1.0 (+https://www.contrax.company)",
      },
      body: JSON.stringify(buildHaulingSearchBody({ startDate: windowStart, endDate: windowEnd, page })),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`USAspending HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      results?: Record<string, unknown>[];
      page_metadata?: { hasNext?: boolean };
    };
    const results = data.results ?? [];
    pages++;
    seen += results.length;
    const pageLeads: HaulingLead[] = [];
    for (const row of results) {
      const lead = toHaulingLead(row, { windowStart, minAmount: HAULING_LEAD_MIN_AMOUNT });
      if (lead) pageLeads.push(lead);
    }
    // Definition R chooses the leads; the write gate then withholds placeholder names.
    const storableLeads = pageLeads.filter(isStorableHaulingLead);
    placeholderSkipped += pageLeads.length - storableLeads.length;
    leads.push(...storableLeads);
    if (!opts.dryRun && storableLeads.length) inserted += await insertHaulingLeads(storableLeads);
    if (!data.page_metadata?.hasNext || results.length === 0) break;
    await new Promise((r) => setTimeout(r, 750));
  }

  const byScopeKind: Record<string, number> = {};
  const byPrimeKind: Record<string, number> = {};
  for (const lead of leads) {
    byScopeKind[lead.scope_kind] = (byScopeKind[lead.scope_kind] ?? 0) + 1;
    byPrimeKind[lead.prime_kind] = (byPrimeKind[lead.prime_kind] ?? 0) + 1;
  }
  return {
    windowStart,
    windowEnd,
    pages,
    seen,
    kept: leads.length + placeholderSkipped,
    placeholderSkipped,
    inserted,
    leads,
    byScopeKind,
    byPrimeKind,
  };
}
