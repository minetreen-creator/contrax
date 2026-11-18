import { STATE_NAMES } from "./contract-map";
import { SUPPLIER_TITLE_PATTERN, type SupplierSample } from "./supplier-report";

/** The live sample shown on /suppliers: real rows only; null when the database cannot be read. */
export async function loadSupplierSample(state: string): Promise<SupplierSample | null> {
  try {
    const { sql } = await import("~/db");
    const s = sql();
    const P = SUPPLIER_TITLE_PATTERN;
    const counts = (await s`
      SELECT count(*)::int AS open,
             count(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new_week,
             count(*) FILTER (WHERE due_date < NOW() + INTERVAL '7 days')::int AS closing
      FROM bids
      WHERE normalized_state = ${state} AND due_date > NOW() AND source NOT LIKE 'sam%' AND source NOT LIKE '%bidnet%'
        AND title ~* ${P}`) as { open: number; new_week: number; closing: number }[];
    const jobs = (await s`
      SELECT id, title, agency, due_date FROM bids
      WHERE normalized_state = ${state} AND due_date > NOW() + INTERVAL '5 days' AND source NOT LIKE 'sam%' AND source NOT LIKE '%bidnet%'
        AND created_at > NOW() - INTERVAL '7 days' AND title ~* ${P} AND title !~* 'addendum|cancel'
      ORDER BY created_at DESC LIMIT 8`) as { id: number; title: string; agency: string | null; due_date: string }[];
    const awards = (await s`
      SELECT recipient_name, recipient_city, recipient_state, amount, awarded_on, description FROM award_leads
      WHERE pop_state = ${state} AND naics_code LIKE '23%' AND awarded_on IS NOT NULL
      ORDER BY awarded_on DESC LIMIT 5`.catch(() => [])) as { recipient_name: string; recipient_city: string | null; recipient_state: string | null; amount: number | string; awarded_on: string; description: string | null }[];
    const ending = (await s`
      SELECT DISTINCT ON (award_key) recipient_name, amount, end_date, agency FROM recompete_contracts
      WHERE pop_state = ${state} AND naics_code LIKE '23%' AND end_date BETWEEN NOW() AND NOW() + INTERVAL '6 months'
      ORDER BY award_key, amount DESC`.catch(() => [])) as { recipient_name: string; amount: number | string; end_date: string; agency: string | null }[];
    const iso = (v: unknown) => new Date(String(v)).toISOString();
    return {
      state,
      stateName: STATE_NAMES[state] ?? state,
      open: counts[0]?.open ?? 0,
      newThisWeek: counts[0]?.new_week ?? 0,
      closingSoon: counts[0]?.closing ?? 0,
      newJobs: jobs.map((j) => ({ id: j.id, title: String(j.title).replace(/\s+/g, " ").trim().slice(0, 110), agency: j.agency ?? "", due: iso(j.due_date) })),
      awards: awards.map((a) => ({
        company: a.recipient_name,
        where: [a.recipient_city, a.recipient_state].filter(Boolean).join(", "),
        amount: Number(a.amount),
        date: iso(a.awarded_on),
        what: String(a.description ?? "").replace(/\s+/g, " ").trim().slice(0, 90),
      })),
      ending: ending
        .map((e) => ({ company: e.recipient_name, amount: Number(e.amount), end: iso(e.end_date), agency: e.agency ?? "" }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5),
    };
  } catch {
    return null;
  }
}
