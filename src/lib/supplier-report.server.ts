import { STATE_NAMES } from "./contract-map";
import { usaspendingUrl } from "./award-leads";
import { AWARD_PAGE_MIN, awardPath } from "./award-pages";
import { SUPPLIER_SAMPLE_STATES, SUPPLIER_AWARD_MIN, SUPPLIER_SUPPLY_PATTERN, SUPPLIER_TITLE_PATTERN, clip, contactLine, tidyCaps, tidyJobTitle, type SupplierSample } from "./supplier-report";

const okUrl = (v: unknown): string | null => (/^https?:\/\/[^\s"'<>]+$/i.test(String(v ?? "")) ? String(v) : null);

/** Website, one-line address and "Name, Title" for a winner, from whichever public SAM record we hold. */
function awardContact(
  site: string | null,
  c?: { street: string | null; city: string | null; state: string | null; zip: string | null; url: string | null; contact: string | null; contact_title: string | null },
): { site: string | null; address: string | null; contact: string | null } {
  if (!c) return { site: okUrl(site), address: null, contact: null };
  const cityLine = [c.city, [c.state, c.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const address = c.street ? [c.street, cityLine].filter(Boolean).join(", ") : null;
  const contact = contactLine(c.contact, c.contact_title);
  return { site: okUrl(c.url) ?? okUrl(site), address, contact };
}

/** The live sample shown on /suppliers: real rows only; null when the database cannot be read. */
export async function loadSupplierSample(state: string): Promise<SupplierSample | null> {
  try {
    const { sql } = await import("~/db");
    const s = sql();
    const P = SUPPLIER_TITLE_PATTERN;
    const X = SUPPLIER_SUPPLY_PATTERN;
    // The four reads do not depend on each other, so they run together (2026-11-20: nine states read
    // one after another made the homepage take 2.5 to 4.6 seconds when it was not cached).
    // The largest of the 20 most recent, so a $101,000 job never leads the list (Texas, 2026-11-20).
    const [countsRaw, jobsRaw, awardsRaw, endingRaw] = await Promise.all([
      s`
      SELECT count(*)::int AS open,
             count(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new_week,
             count(*) FILTER (WHERE due_date < NOW() + INTERVAL '7 days')::int AS closing
      FROM bids
      WHERE normalized_state = ${state} AND due_date > NOW() AND source NOT LIKE 'sam%' AND source NOT LIKE '%bidnet%'
        AND title ~* ${P} AND title !~* ${X}`,
      s`
      SELECT id, title, agency, due_date FROM bids
      WHERE normalized_state = ${state} AND due_date > NOW() + INTERVAL '5 days' AND source NOT LIKE 'sam%' AND source NOT LIKE '%bidnet%'
        AND created_at > NOW() - INTERVAL '7 days' AND title ~* ${P} AND title !~* 'addendum|cancel' AND title !~* ${X}
      ORDER BY created_at DESC LIMIT 8`,
      s`
      SELECT * FROM (
        SELECT a.id, a.award_key, a.recipient_uei, a.recipient_name, a.recipient_city, a.recipient_state, a.amount, a.awarded_on, a.description, r.url AS site
        FROM award_leads a LEFT JOIN sam_registrants r ON r.uei = a.recipient_uei
        WHERE a.pop_state = ${state} AND a.naics_code LIKE '23%' AND a.awarded_on IS NOT NULL AND a.amount >= ${SUPPLIER_AWARD_MIN}
        ORDER BY a.awarded_on DESC LIMIT 20
      ) recent ORDER BY amount DESC LIMIT 5`.catch(() => []),
      s`
      SELECT DISTINCT ON (award_key) recipient_name, amount, end_date, agency FROM recompete_contracts
      WHERE pop_state = ${state} AND naics_code LIKE '23%' AND end_date BETWEEN NOW() AND NOW() + INTERVAL '6 months'
      ORDER BY award_key, amount DESC`.catch(() => []),
    ]);
    const counts = countsRaw as { open: number; new_week: number; closing: number }[];
    const jobs = jobsRaw as { id: number; title: string; agency: string | null; due_date: string }[];
    const awards = awardsRaw as { id: number; site: string | null; award_key: string; recipient_uei: string | null; recipient_name: string; recipient_city: string | null; recipient_state: string | null; amount: number | string; awarded_on: string; description: string | null }[];
    const ending = endingRaw as { recipient_name: string; amount: number | string; end_date: string; agency: string | null }[];
    // Public address and contact, kept in their own table so a missing table or row never hides an award.
    const ueis = awards.map((x) => x.recipient_uei).filter((u): u is string => Boolean(u));
    const contactRows = ueis.length
      ? ((await s`SELECT uei, street, city, state, zip, url, contact, contact_title FROM sam_contacts WHERE uei = ANY(${ueis})`.catch(() => [])) as {
          uei: string; street: string | null; city: string | null; state: string | null; zip: string | null; url: string | null; contact: string | null; contact_title: string | null;
        }[])
      : [];
    const contactByUei = new Map(contactRows.map((c) => [c.uei, c]));
    const iso = (v: unknown) => new Date(String(v)).toISOString();
    return {
      state,
      stateName: STATE_NAMES[state] ?? state,
      open: counts[0]?.open ?? 0,
      newThisWeek: counts[0]?.new_week ?? 0,
      closingSoon: counts[0]?.closing ?? 0,
      newJobs: jobs.map((j) => ({ id: j.id, title: clip(tidyCaps(tidyJobTitle(String(j.title))), 110), agency: tidyCaps(j.agency ?? ""), due: iso(j.due_date) })),
      awards: awards.map((a) => ({
        company: tidyCaps(a.recipient_name),
        where: [a.recipient_city ? tidyCaps(a.recipient_city) : null, a.recipient_state].filter(Boolean).join(", "),
        amount: Number(a.amount),
        date: iso(a.awarded_on),
        what: clip(tidyCaps(String(a.description ?? "")), 90),
        url: usaspendingUrl(a.award_key),
        // Its own page (src/lib/award-pages.ts) when the award is large enough to have one.
        page: Number(a.amount) >= AWARD_PAGE_MIN && SUPPLIER_SAMPLE_STATES.includes(state) ? awardPath(tidyCaps(a.recipient_name), state, Number(a.id)) : null,
        ...awardContact(a.site, a.recipient_uei ? contactByUei.get(a.recipient_uei) : undefined),
      })),
      ending: ending
        .map((e) => ({ company: tidyCaps(e.recipient_name), amount: Number(e.amount), end: iso(e.end_date), agency: e.agency ?? "" }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5),
    };
  } catch {
    return null;
  }
}

/** One sample per state, in the order given; a state that cannot be read or has nothing open is left out. */
export async function loadSupplierSamples(states: readonly string[]): Promise<SupplierSample[]> {
  const all = await Promise.all(states.map((st) => loadSupplierSample(st)));
  return all.filter((x): x is SupplierSample => x !== null && x.open > 0);
}
