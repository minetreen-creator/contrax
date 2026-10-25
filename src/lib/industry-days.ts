/**
 * Industry day calendar (owner 2026-10-25, after the USACE Charleston / SAME
 * Federal Contractor Summit flyer): upcoming industry days, contractor
 * summits, matchmaking and small-business outreach events, from notices
 * Contrax already syncs (mostly SAM.gov special notices). /industry-days.
 *
 * PURE: what counts as an event notice, and grouping by state.
 */

/** Title phrases that mark an event notice (case-insensitive; same source for SQL and tests). */
export const INDUSTRY_DAY_PATTERN =
  "industry (day|days|engagement|forum|briefing|outreach|exchange)|reverse industry|matchmaking|match-making|contractor (summit|outreach|forum)|small business (outreach|summit|forum|conference|matchmaking|event|symposium)|vendor (day|outreach|fair|forum)|meet the (primes|buyers|prime)|outreach event|networking event";

const RE = new RegExp(INDUSTRY_DAY_PATTERN, "i");

export function isIndustryDayTitle(title: string | null | undefined): boolean {
  return RE.test(String(title ?? ""));
}

export interface IndustryDayRow {
  id: number;
  title: string;
  agency: string;
  location: string | null;
  state: string | null;
  /** The date on the notice: usually the event or the RSVP deadline. */
  date: string | null;
  url: string | null;
}

/** One row per event: the same notice often arrives twice (federal + regional passes). */
export function dedupeEvents(rows: IndustryDayRow[]): IndustryDayRow[] {
  const seen = new Set<string>();
  const out: IndustryDayRow[] = [];
  for (const r of rows) {
    const key = `${r.title.trim().toLowerCase()}|${r.agency.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** States that have events, busiest first (then by code), for the filter. */
export function stateCounts(rows: IndustryDayRow[]): { code: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) if (r.state) m.set(r.state, (m.get(r.state) ?? 0) + 1);
  return [...m.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}
