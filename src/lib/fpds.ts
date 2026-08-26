import { sql } from "~/db";

export interface FPDSIncumbent {
  incumbent_name: string;
  incumbent_uei: string | null;
  total_obligated: number;
  pop_start_date: string | null;
  pop_end_date: string | null;
}
export interface HistoricalPrice { fiscal_year: number; total_obligated: number; award_count: number }
export interface FPDSIntel extends FPDSIncumbent { historical_pricing: HistoricalPrice[]; re_compete?: boolean }

const API = "https://api.usaspending.gov/api/v2";
// spending_by_award requires an explicit `fields` array — omitting it 422s with
// "Missing value: 'fields' is a required field" (verified live 2026-08-15), and
// result rows are keyed by these display names ("Recipient Name", "Award Amount",
// ...), NOT by underscore names (recipient_name / total_obligation are absent
// from search rows). Keep in sync with the homepage feed's field set
// (src/routes/index.tsx getLiveAwards). "End Date" maps to the period-of-
// performance current end date; "Start Date" to the POP start date.
const USA_SPENDING_FIELDS = ["Award ID", "Recipient Name", "Recipient UEI", "Award Amount", "Start Date", "End Date", "Awarding Agency", "Description"];
let lastRequest = 0;
async function request(path: string, init?: RequestInit): Promise<any> {
  const wait = Math.max(0, 1000 - (Date.now() - lastRequest));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  let response = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", Accept: "application/json", ...(init?.headers || {}) } });
  if (response.status === 429) {
    await new Promise((r) => setTimeout(r, 1100));
    lastRequest = Date.now();
    response = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", Accept: "application/json", ...(init?.headers || {}) } });
  }
  if (!response.ok) {
    // Fail open (callers treat null as "no data"), but never silently — surface
    // the real USAspending status/detail so a regression (e.g. the 422 that
    // previously swallowed every incumbent lookup) is visible in server logs.
    const detail = await response.text().catch(() => "");
    console.error(`[fpds] USAspending ${path} returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    return null;
  }
  return response.json();
}
function key(...parts: string[]) { let h = 2166136261; for (const c of parts.join("|").toLowerCase()) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
function filters(naicsCode: string, agency: string, keywords: string, years?: boolean) {
  const now = new Date(); const end = now.toISOString().slice(0, 10); const start = new Date(now.getFullYear() - 5, 0, 1).toISOString().slice(0, 10);
  return { filters: { time_period: years ? [{ start_date: start, end_date: end }] : undefined, naics_codes: naicsCode ? [naicsCode] : undefined, keywords: [keywords, agency].filter(Boolean), award_type_codes: ["A", "B", "C", "D"] }, fields: USA_SPENDING_FIELDS, limit: 100, page: 1, subawards: false };
}
async function search(body: unknown) { return request("/search/spending_by_award/", { method: "POST", body: JSON.stringify(body) }); }

export async function searchFPDSIncumbent(naicsCode: string, agency: string, keywords: string): Promise<FPDSIncumbent | null> {
  try {
    // NAICS is ideal, but older synced bids may not have it. Agency + title still
    // gives USASpending a useful match instead of failing before the request.
    const data = await search(filters(naicsCode, agency, keywords));
    const rows: any[] = data?.results || []; if (!rows.length) return null;
    // Prefer a real, non-zero award amount over the default top-ranked row:
    // USAspending search can rank a $0 record first (e.g. a 0-obligation
    // modification line), which would render an honest-but-weak "$0" even when
    // that same winner holds real awards with actual amounts in the result set.
    // Walk the rows and use the first one with a finite non-zero obligated/award
    // amount (real data — never invented). If every row is $0/empty, fall back to
    // the top row so the caller still gets an honest zero / "not available"
    // placeholder rather than a fabricated figure. The winner name stays the
    // actual recipient of whichever real award we surface.
    let row: any = rows[0];
    for (const r of rows) {
      const amt = Number(r["Award Amount"] ?? r.total_obligation ?? 0);
      if (Number.isFinite(amt) && amt > 0) { row = r; break; }
    }
    // Search rows key the requested fields by display name ("Recipient Name"…);
    // the optional /awards/{id}/ detail call returns nested keys
    // (recipient.recipient_name, period_of_performance.start_date) with
    // total_obligation at top level. Read both so the lookup survives either.
    const detail = row.generated_unique_award_id ? await request(`/awards/${encodeURIComponent(row.generated_unique_award_id)}/`) : row;
    const d: any = detail || row;
    const name = d.recipient?.recipient_name || d.recipient_name || row["Recipient Name"]; if (!name) return null;
    return {
      incumbent_name: name,
      incumbent_uei: d.recipient?.recipient_uei || d.recipient_uei || row["Recipient UEI"] || null,
      total_obligated: Number(d.total_obligation ?? row["Award Amount"] ?? 0),
      pop_start_date: d.period_of_performance?.start_date || d.period_of_performance_start_date || row["Start Date"] || null,
      pop_end_date: d.period_of_performance?.end_date || d.period_of_performance_current_end_date || row["End Date"] || null,
    };
  } catch (err) {
    console.error("[fpds] incumbent lookup failed:", err);
    return null;
  }
}
export async function fetchHistoricalPricing(naicsCode: string, agency: string, keywords: string): Promise<HistoricalPrice[]> {
  if (!naicsCode) return [];
  try {
    const data = await search(filters(naicsCode, agency, keywords, true)); const totals = new Map<number, { total: number; count: number }>();
    for (const row of data?.results || []) { const date = row["Start Date"] || row.period_of_performance_start_date || row.award_date; const year = date ? (new Date(date).getMonth() >= 9 ? new Date(date).getFullYear() + 1 : new Date(date).getFullYear()) : 0; if (year >= new Date().getFullYear() - 4) { const v = totals.get(year) || { total: 0, count: 0 }; v.total += Number(row["Award Amount"] ?? row.total_obligation ?? 0); v.count++; totals.set(year, v); } }
    return [...totals.entries()].sort((a, b) => a[0] - b[0]).map(([fiscal_year, v]) => ({ fiscal_year, total_obligated: v.total, award_count: v.count }));
  } catch (err) {
    console.error("[fpds] historical pricing lookup failed:", err);
    return [];
  }
}
export async function searchFPDSContract(solicitationNumber: string): Promise<FPDSIncumbent | null> {
  if (!solicitationNumber) return null;
  try {
    // award_type_codes is also required by spending_by_award (422 without it,
    // verified live 2026-08-15) — contract award types A/B/C/D only.
    const data = await search({ filters: { keywords: [solicitationNumber], award_type_codes: ["A", "B", "C", "D"] }, fields: USA_SPENDING_FIELDS, limit: 10, page: 1 });
    const row = data?.results?.[0]; if (!row) return null;
    return { incumbent_name: row["Recipient Name"] || row.recipient_name || "", incumbent_uei: row["Recipient UEI"] || row.recipient_uei || null, total_obligated: Number(row["Award Amount"] ?? row.total_obligation ?? 0), pop_start_date: row["Start Date"] || row.period_of_performance_start_date || null, pop_end_date: row["End Date"] || row.period_of_performance_current_end_date || null };
  } catch (err) {
    console.error("[fpds] contract lookup failed:", err);
    return null;
  }
}
export async function getFPDSIntel(naicsCode: string, agency: string, keywords: string): Promise<FPDSIntel | null> {
  const lookupKey = key(naicsCode || "none", agency, keywords);
  try {
    await sql()`${sql().unsafe(`CREATE TABLE IF NOT EXISTS fpds_lookups (id SERIAL PRIMARY KEY, lookup_key TEXT NOT NULL UNIQUE, incumbent_name TEXT, incumbent_uei TEXT, total_obligated DECIMAL(14,2), pop_start_date TEXT, pop_end_date TEXT, historical_pricing JSONB DEFAULT '[]'::jsonb, fetched_at TIMESTAMPTZ DEFAULT NOW())`)}`;
    const cached = await sql()`SELECT * FROM fpds_lookups WHERE lookup_key=${lookupKey} AND fetched_at > NOW() - INTERVAL '30 days' LIMIT 1`;
    if (cached.length) { const c: any = cached[0]; return c.incumbent_name ? { incumbent_name: c.incumbent_name, incumbent_uei: c.incumbent_uei, total_obligated: Number(c.total_obligated || 0), pop_start_date: c.pop_start_date, pop_end_date: c.pop_end_date, historical_pricing: c.historical_pricing || [] } : null; }
    const incumbent = await searchFPDSIncumbent(naicsCode, agency, keywords); const historical = await fetchHistoricalPricing(naicsCode, agency, keywords);
    if (incumbent) await sql()`INSERT INTO fpds_lookups (lookup_key, incumbent_name, incumbent_uei, total_obligated, pop_start_date, pop_end_date, historical_pricing) VALUES (${lookupKey},${incumbent.incumbent_name},${incumbent.incumbent_uei},${incumbent.total_obligated},${incumbent.pop_start_date},${incumbent.pop_end_date},${JSON.stringify(historical)}) ON CONFLICT (lookup_key) DO UPDATE SET incumbent_name=EXCLUDED.incumbent_name, incumbent_uei=EXCLUDED.incumbent_uei, total_obligated=EXCLUDED.total_obligated, pop_start_date=EXCLUDED.pop_start_date, pop_end_date=EXCLUDED.pop_end_date, historical_pricing=EXCLUDED.historical_pricing, fetched_at=NOW()`;
    return incumbent ? { ...incumbent, historical_pricing: historical } : null;
  } catch (err) {
    console.error("[fpds] getFPDSIntel failed:", err);
    return null;
  }
}
