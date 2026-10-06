/**
 * Award leads — database + USAspending sync (owner 2026-10-06, idea #6).
 * The table is created lazily (additive) like the data feed's tables.
 */
import { sql } from "~/db";
import { AWARD_LEAD_FIELDS, toAwardLead, type AwardLead, type AwardLeadQuery } from "~/lib/award-leads";

export async function ensureAwardLeadsTable(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS award_leads (
    id SERIAL PRIMARY KEY,
    award_key TEXT NOT NULL UNIQUE,
    award_id TEXT NOT NULL,
    recipient_name TEXT NOT NULL,
    recipient_uei TEXT,
    recipient_city TEXT,
    recipient_state TEXT,
    amount BIGINT NOT NULL,
    awarded_on DATE,
    agency TEXT,
    sub_agency TEXT,
    description TEXT,
    pop_state TEXT,
    naics_code TEXT,
    naics_description TEXT,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql()`CREATE INDEX IF NOT EXISTS award_leads_awarded_on_idx ON award_leads (awarded_on DESC)`;
}

/** Insert new awards; an award already stored is left as first seen. Returns rows inserted. */
export async function insertAwardLeads(rows: AwardLead[]): Promise<number> {
  let inserted = 0;
  for (const r of rows) {
    const res = (await sql()`
      INSERT INTO award_leads (award_key, award_id, recipient_name, recipient_uei, recipient_city, recipient_state, amount,
                               awarded_on, agency, sub_agency, description, pop_state, naics_code, naics_description)
      VALUES (${r.award_key}, ${r.award_id}, ${r.recipient_name}, ${r.recipient_uei}, ${r.recipient_city}, ${r.recipient_state}, ${r.amount},
              ${r.awarded_on}, ${r.agency}, ${r.sub_agency}, ${r.description}, ${r.pop_state}, ${r.naics_code}, ${r.naics_description})
      ON CONFLICT (award_key) DO NOTHING
      RETURNING id`) as unknown[];
    inserted += res.length;
  }
  return inserted;
}

function rowToLead(r: Record<string, unknown>): AwardLead & { id: number } {
  const d = r.awarded_on;
  return {
    id: Number(r.id),
    award_key: String(r.award_key),
    award_id: String(r.award_id),
    recipient_name: String(r.recipient_name),
    recipient_uei: (r.recipient_uei as string) ?? null,
    recipient_city: (r.recipient_city as string) ?? null,
    recipient_state: (r.recipient_state as string) ?? null,
    amount: Number(r.amount),
    awarded_on: d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null,
    agency: (r.agency as string) ?? null,
    sub_agency: (r.sub_agency as string) ?? null,
    description: (r.description as string) ?? null,
    pop_state: (r.pop_state as string) ?? null,
    naics_code: (r.naics_code as string) ?? null,
    naics_description: (r.naics_description as string) ?? null,
  };
}

/** Leads matching the query, keyset-paged on id (ascending) so paging is stable. */
export async function queryAwardLeads(q: AwardLeadQuery): Promise<{ rows: (AwardLead & { id: number })[]; nextAfter: number | null }> {
  await ensureAwardLeadsTable();
  const s = sql();
  const statePred = q.states.length ? s`AND (pop_state = ANY(${q.states}) OR recipient_state = ANY(${q.states}))` : s``;
  const naicsPred = q.naics.length ? s`AND naics_code ~ ${`^(${q.naics.join("|")})`}` : s``;
  const sincePred = q.since ? s`AND awarded_on >= ${q.since}` : s``;
  const minPred = q.minAmount > 0 ? s`AND amount >= ${q.minAmount}` : s``;
  const rows = (await s`
    SELECT * FROM award_leads
    WHERE id > ${q.after} ${statePred} ${naicsPred} ${sincePred} ${minPred}
    ORDER BY id ASC
    LIMIT ${q.limit + 1}`) as Record<string, unknown>[];
  const more = rows.length > q.limit;
  const page = rows.slice(0, q.limit).map(rowToLead);
  return { rows: page, nextAfter: more && page.length ? page[page.length - 1].id : null };
}

/** Public page: a handful of the latest winners plus headline counts. */
export async function awardLeadsSummary(): Promise<{ sample: AwardLead[]; last30: number; total30: number }> {
  await ensureAwardLeadsTable();
  const [sample, counts] = await Promise.all([
    sql()`SELECT * FROM award_leads WHERE awarded_on IS NOT NULL ORDER BY awarded_on DESC, amount DESC LIMIT 8`,
    sql()`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS total FROM award_leads WHERE awarded_on >= CURRENT_DATE - 30`,
  ]);
  const c = (counts as { n: number; total: number }[])[0] ?? { n: 0, total: 0 };
  return { sample: (sample as Record<string, unknown>[]).map(rowToLead), last30: c.n, total30: c.total };
}

const API = "https://api.usaspending.gov/api/v2/search/spending_by_award/";

/**
 * Pull contract awards with activity in the last `days` days and keep the ones
 * whose base award date falls inside the window (new awards, not modifications
 * of old ones). Stops at `maxPages` × 100 rows.
 */
export async function syncAwardLeads(opts: { days?: number; maxPages?: number; dryRun?: boolean } = {}): Promise<{
  pages: number;
  seen: number;
  kept: number;
  inserted: number;
}> {
  const days = opts.days ?? 10;
  const maxPages = opts.maxPages ?? 60;
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  if (!opts.dryRun) await ensureAwardLeadsTable();

  let pages = 0;
  let seen = 0;
  let kept = 0;
  let inserted = 0;
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Contrax/1.0 (+https://www.contrax.company)" },
      body: JSON.stringify({
        filters: { award_type_codes: ["A", "B", "C", "D"], time_period: [{ start_date: startStr, end_date: endStr }] },
        fields: AWARD_LEAD_FIELDS,
        sort: "Award Amount",
        order: "desc",
        limit: 100,
        page,
        subawards: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`USAspending HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { results?: Record<string, unknown>[]; page_metadata?: { hasNext?: boolean } };
    const results = data.results ?? [];
    pages++;
    seen += results.length;
    const leads = results
      .map(toAwardLead)
      .filter((l): l is AwardLead => !!l && !!l.awarded_on && l.awarded_on >= startStr);
    kept += leads.length;
    if (!opts.dryRun && leads.length) inserted += await insertAwardLeads(leads);
    // Sorted by amount: once a whole page is under the minimum, the rest is too.
    if (!data.page_metadata?.hasNext || results.length === 0 || results.every((r) => Number(r["Award Amount"]) < 25_000)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return { pages, seen, kept, inserted };
}
