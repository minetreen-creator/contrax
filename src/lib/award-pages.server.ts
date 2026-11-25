import { sql } from "~/db";
import { usaspendingUrl } from "~/lib/award-leads";
import {
  AWARD_PAGE_MIN,
  AWARD_PAGE_NEIGHBOURS,
  AWARD_SITEMAP_LIMIT,
  awardPageEligible,
  awardPath,
  awardWhat,
  stateNameOf,
  type AwardPageData,
} from "~/lib/award-pages";
import { SUPPLIER_SAMPLE_STATES, tidyCaps } from "~/lib/supplier-report";

const iso = (v: unknown) => new Date(String(v)).toISOString();
const okUrl = (v: unknown) => /^https?:\/\/[^\s"'<>]+$/i.test(String(v ?? ""));

/** One award page (src/lib/award-pages.ts); null when the award does not exist or may not have a page. */
export async function loadAwardPage(id: number): Promise<AwardPageData | null> {
  const s = sql();
  const [a] = (await s`
    SELECT id, award_key, recipient_name, recipient_uei, recipient_city, recipient_state, amount, awarded_on,
           agency, sub_agency, description, pop_state, naics_code
    FROM award_leads WHERE id = ${id}`) as Record<string, unknown>[];
  if (!a || !awardPageEligible({ amount: Number(a.amount), naics_code: a.naics_code as string, pop_state: a.pop_state as string, awarded_on: a.awarded_on })) return null;
  const state = String(a.pop_state);
  const uei = a.recipient_uei ? String(a.recipient_uei) : null;
  // The report's details for this winner. Only whether each exists leaves the server.
  const [othersRaw, contactRaw, siteRaw] = await Promise.all([
    s`
      SELECT id, recipient_name, amount, awarded_on FROM award_leads
      WHERE pop_state = ${state} AND naics_code LIKE '23%' AND awarded_on IS NOT NULL AND amount >= ${AWARD_PAGE_MIN} AND id <> ${id}
      ORDER BY awarded_on DESC, id DESC LIMIT ${AWARD_PAGE_NEIGHBOURS}`,
    uei ? s`SELECT street, url, contact FROM sam_contacts WHERE uei = ${uei} LIMIT 1`.catch(() => []) : [],
    uei ? s`SELECT url FROM sam_registrants WHERE uei = ${uei} LIMIT 1`.catch(() => []) : [],
  ]);
  const others = othersRaw as Record<string, unknown>[];
  const contactRows = contactRaw as Record<string, unknown>[];
  const siteRows = siteRaw as Record<string, unknown>[];
  const c = contactRows[0];
  const company = tidyCaps(String(a.recipient_name));
  const recipientState = a.recipient_state ? String(a.recipient_state) : null;
  return {
    id,
    path: awardPath(company, state, id),
    company,
    basedIn: [a.recipient_city ? tidyCaps(String(a.recipient_city)) : null, recipientState].filter(Boolean).join(", "),
    recipientState,
    state,
    stateName: stateNameOf(state),
    amount: Number(a.amount),
    awardedOn: iso(a.awarded_on),
    agency: String(a.agency ?? ""),
    subAgency: String(a.sub_agency ?? ""),
    what: awardWhat(a.description as string | null),
    recordUrl: usaspendingUrl(String(a.award_key)),
    onFile: {
      contact: Boolean(c?.contact && String(c.contact).trim()),
      address: Boolean(c?.street && String(c.street).trim()),
      website: okUrl(c?.url) || okUrl(siteRows[0]?.url),
    },
    others: others.map((o) => {
      const name = tidyCaps(String(o.recipient_name));
      return { path: awardPath(name, state, Number(o.id)), company: name, amount: Number(o.amount), awardedOn: iso(o.awarded_on) };
    }),
  };
}

/** The newest eligible awards, for the sitemap. */
export async function awardSitemapRows(): Promise<{ company: string; state: string; id: number }[]> {
  const rows = (await sql()`
    SELECT id, recipient_name, pop_state FROM award_leads
    WHERE pop_state = ANY(${[...SUPPLIER_SAMPLE_STATES]}) AND naics_code LIKE '23%' AND awarded_on IS NOT NULL AND amount >= ${AWARD_PAGE_MIN}
    ORDER BY awarded_on DESC, id DESC LIMIT ${AWARD_SITEMAP_LIMIT}`) as { id: number; recipient_name: string; pop_state: string }[];
  return rows.map((r) => ({ company: tidyCaps(r.recipient_name), state: r.pop_state, id: Number(r.id) }));
}
