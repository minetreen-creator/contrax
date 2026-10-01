/**
 * SEO for the per-bid pages (/bid/:id) and the live bid sitemap.
 *
 * Contractors search for specific solicitations by title, number and buyer
 * ("Norfolk Airport unarmed security RFP"). Every open bid gets an indexable,
 * server-rendered page with its own title and description, and is listed in
 * /sitemap-bids.xml (built live from the database, because bids change every
 * few hours while the static sitemap only changes on deploy). Closed or
 * missing bids are noindex so search results never point at dead ones.
 *
 * PURE and client-safe: no DB, no server imports.
 */

export const SITE_URL = "https://www.contrax.company";
/** Google's per-file sitemap limit is 50,000 URLs; stay well under it. */
export const BID_SITEMAP_MAX_URLS = 45_000;

export interface BidSeoFields {
  id: number;
  title: string;
  agency: string | null;
  location: string | null;
  set_aside: string | null;
  due_date: string | null;
  description: string | null;
}

const collapse = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

/** "Oct 12, 2026" (UTC date of the stored deadline). */
export function dueLabel(dueDate: string | null | undefined): string | null {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** A bid page is indexable while it exists and its deadline has not passed. */
export function isBidIndexable(bid: Pick<BidSeoFields, "due_date"> | null | undefined, now: number = Date.now()): boolean {
  if (!bid) return false;
  if (!bid.due_date) return true; // open-ended ("until contracted") notices stay indexable
  const due = Date.parse(bid.due_date);
  return Number.isNaN(due) || due > now;
}

/** "<title> — <agency> (due Oct 12, 2026) | Contrax" */
export function bidSeoTitle(bid: BidSeoFields): string {
  const title = clip(collapse(bid.title) || "Government solicitation", 80);
  const agency = collapse(bid.agency);
  const due = dueLabel(bid.due_date);
  const parts = [title];
  if (agency && !title.toLowerCase().includes(agency.toLowerCase())) parts.push(`— ${clip(agency, 50)}`);
  if (due) parts.push(`(due ${due})`);
  return `${parts.join(" ")} | Contrax`;
}

/** One-line summary for the meta description (≤ 160 chars), key facts first. */
export function bidSeoDescription(bid: BidSeoFields): string {
  const agency = collapse(bid.agency);
  const location = collapse(bid.location);
  const due = dueLabel(bid.due_date);
  const facts = [
    due ? `Due ${due}` : null,
    agency || null,
    location && !(agency && location.toLowerCase().includes(agency.toLowerCase())) ? location : null,
    collapse(bid.set_aside) || null,
  ].filter(Boolean);
  const title = collapse(bid.title);
  const desc = collapse(bid.description);
  const text = [facts.join(" · "), title, desc].filter(Boolean).join(". ");
  return clip(text || "Open government solicitation on Contrax.", 160);
}

export function bidCanonicalUrl(id: number): string {
  return `${SITE_URL}/bid/${id}`;
}

/** "/contracts-in/virginia" for a state code, using the full-name slug. */
export function stateLandingPath(stateName: string | null | undefined): string | null {
  const name = collapse(stateName);
  if (!name) return null;
  return `/contracts-in/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The live bid sitemap: one <url> per open bid page. */
export function buildBidSitemapXml(rows: readonly { id: number; lastmod: string | null }[]): string {
  const urls = rows.slice(0, BID_SITEMAP_MAX_URLS).map((r) => {
    const lastmod = r.lastmod && !Number.isNaN(Date.parse(r.lastmod)) ? `<lastmod>${new Date(r.lastmod).toISOString().slice(0, 10)}</lastmod>` : "";
    return `  <url><loc>${escapeXml(bidCanonicalUrl(r.id))}</loc>${lastmod}<changefreq>daily</changefreq><priority>0.6</priority></url>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}
