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

/**
 * One row per event: the same notice often arrives twice (federal + regional
 * passes), with the agency written differently ("USACE" vs "W07V ENDIST NEW
 * ORLEANS"), so the key is the title and the date, not the agency.
 */
export function dedupeEvents(rows: IndustryDayRow[]): IndustryDayRow[] {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const seen = new Set<string>();
  const out: IndustryDayRow[] = [];
  for (const r of rows) {
    const key = `${norm(r.title)}|${r.date ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  // Owner 2026-11-04: a re-posted notice can carry extra words in front of the
  // same title ("Ticket Release dates: 9/23 & 10/7; SAVE THE DATE: FY27 NSWCPD
  // Hybrid Industry Day"). On the same date, a title that contains another
  // event's whole title is the same event; keep the shorter, cleaner one.
  const MIN = 25;
  return out.filter((r) => {
    const t = norm(r.title);
    return !out.some((o) => o !== r && (o.date ?? "") === (r.date ?? "") && norm(o.title).length >= MIN && norm(o.title).length < t.length && t.includes(norm(o.title)));
  });
}

/** States that have events, busiest first (then by code), for the filter. */
export function stateCounts(rows: IndustryDayRow[]): { code: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) if (r.state) m.set(r.state, (m.get(r.state) ?? 0) + 1);
  return [...m.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}
