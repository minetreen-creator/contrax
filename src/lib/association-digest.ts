/**
 * Association weekly bid list (owner 2026-11-05: "Look for organizations" →
 * contractor and small-business associations that already hand-curate bid
 * alerts for members → "Do that"). Contrax prepares a ready-to-send weekly
 * list of open public bids for an association's region, grouped by trade,
 * with due dates and links, under the association's name.
 *
 * PURE: the association configs, region and trade filters, de-duplication and
 * the email rendering. src/jobs/association-digest.ts reads the bids and sends
 * SAMPLES to the owner only.
 */

export interface AssociationConfig {
  key: string;
  name: string;
  /** "Central Texas", "Maryland, DC and Virginia" — shown in the heading. */
  regionLabel: string;
  states: string[];
  /** When set, a bid must name one of these places (location, agency or title). */
  places?: RegExp;
  /** Bid categories (bids.category) to include, in section order. */
  categories: string[];
  /** Only bids with a veteran set-aside or veteran program wording. */
  veteranOnly?: boolean;
}

const CONTRACTOR_TRADES = ["Construction", "HVAC", "Plumbing & Electrical", "Landscaping", "Janitorial"];
const ALL_TRADES = ["Construction", "HVAC", "Plumbing & Electrical", "Landscaping", "Janitorial", "Security", "Transportation", "IT Services"];

export const ASSOCIATIONS: readonly AssociationConfig[] = [
  {
    key: "namc-central-texas",
    name: "NAMC Central Texas",
    regionLabel: "Central Texas",
    states: ["TX"],
    places: /\b(austin|travis|williamson|hays|bastrop|caldwell|burnet|round rock|georgetown|cedar park|leander|pflugerville|san marcos|kyle|buda|lockhart|taylor|hutto|manor|lakeway|bee cave|dripping springs|marble falls|waco|mclennan|temple|killeen|bell county|belton|harker heights|copperas cove|texas state university|ut austin|capital metro|central texas)\b/i,
    categories: CONTRACTOR_TRADES,
  },
  {
    key: "hca-san-antonio",
    name: "Hispanic Contractors Association de San Antonio",
    regionLabel: "South Texas",
    states: ["TX"],
    places: /\b(san antonio|bexar|new braunfels|comal|guadalupe|seguin|schertz|universal city|boerne|kendall|medina|atascosa|wilson county|laredo|webb county|corpus christi|nueces|kingsville|hidalgo|mcallen|edinburg|mission|pharr|weslaco|brownsville|cameron county|harlingen|victoria|del rio|eagle pass|uvalde|utsa|ut health san antonio|saws|cps energy|via metropolitan|port of corpus christi|rgv|rio grande valley|south texas)\b/i,
    categories: CONTRACTOR_TRADES,
  },
  {
    key: "mmca",
    name: "Maryland Minority Contractors Association",
    regionLabel: "Maryland",
    states: ["MD"],
    categories: CONTRACTOR_TRADES,
  },
  {
    key: "mwmca",
    name: "MWMCA",
    regionLabel: "Maryland, DC and Virginia",
    states: ["MD", "DC", "VA"],
    categories: ALL_TRADES,
  },
  {
    key: "namc-national",
    name: "NAMC",
    regionLabel: "Texas (sample chapter region)",
    states: ["TX"],
    categories: CONTRACTOR_TRADES,
  },
  {
    key: "navoba",
    name: "NaVOBA",
    regionLabel: "Nationwide, veteran set-asides",
    states: [],
    categories: ALL_TRADES,
    veteranOnly: true,
  },
  {
    key: "gbca",
    name: "Georgia Black Constructors Association",
    regionLabel: "Georgia",
    states: ["GA"],
    categories: CONTRACTOR_TRADES,
  },
];

export function associationFor(key: string): AssociationConfig | null {
  return ASSOCIATIONS.find((a) => a.key === key) ?? null;
}

export interface DigestBid {
  id: number;
  title: string;
  agency: string | null;
  location: string | null;
  state: string | null;
  category: string | null;
  due_date: string;
  estimated_value: string | null;
  set_aside: string | null;
}

const VETERAN = /\b(sdvosb|vosb|service[- ]disabled veteran|veteran[- ]owned|veterans? (business|set[- ]aside|small business)|dvbe|sdvbe|vbe)\b/i;

/** Does this bid belong in this association's list? PURE. */
export function bidFits(cfg: AssociationConfig, b: DigestBid): boolean {
  if (!b.category || !cfg.categories.includes(b.category)) return false;
  if (cfg.states.length && !(b.state && cfg.states.includes(b.state))) return false;
  if (cfg.places && !cfg.places.test(`${b.location ?? ""} ${b.agency ?? ""} ${b.title}`)) return false;
  if (cfg.veteranOnly && !VETERAN.test(`${b.set_aside ?? ""} ${b.title}`)) return false;
  return true;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** One row per solicitation: the same bid often arrives from two boards. PURE. */
export function dedupeBids(bids: readonly DigestBid[]): DigestBid[] {
  const seen = new Set<string>();
  const out: DigestBid[] = [];
  for (const b of bids) {
    const key = `${norm(b.title)}|${b.due_date.slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

export interface DigestSection {
  category: string;
  bids: DigestBid[];
}

/** Bids grouped by trade in the association's order, soonest due first, capped per section. PURE. */
export function buildSections(cfg: AssociationConfig, bids: readonly DigestBid[], perSection = 25): DigestSection[] {
  const fit = dedupeBids(bids.filter((b) => bidFits(cfg, b)));
  return cfg.categories
    .map((category) => ({
      category,
      bids: fit
        .filter((b) => b.category === category)
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
        .slice(0, perSection),
    }))
    .filter((s) => s.bids.length > 0);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const value = (v: string | null) => (v && !/not specified/i.test(v) ? v : "");
export const BID_URL = (id: number) => `https://www.contrax.company/bid/${id}`;

/** The ready-to-send email for one association. PURE. */
export function renderDigest(cfg: AssociationConfig, sections: readonly DigestSection[], weekOf: Date): { subject: string; html: string; text: string; count: number } {
  const count = sections.reduce((n, s) => n + s.bids.length, 0);
  const week = weekOf.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  const subject = `${cfg.name}: ${count} open bids in ${cfg.regionLabel}, week of ${week}`;
  const text = [
    `${cfg.name} — Weekly Bid Opportunities`,
    `${cfg.regionLabel} · week of ${week} · ${count} open bids`,
    "",
    ...sections.flatMap((s) => [
      `${s.category.toUpperCase()} (${s.bids.length})`,
      ...s.bids.map((b) => `- ${b.title} — ${b.agency ?? "Agency"}${b.location ? `, ${b.location}` : ""} — due ${day(b.due_date)}${value(b.estimated_value) ? ` — ${value(b.estimated_value)}` : ""}\n  ${BID_URL(b.id)}`),
      "",
    ]),
    `Prepared for ${cfg.name} by Contrax (https://www.contrax.company). Confirm deadlines and requirements in each agency's documents before bidding.`,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f1f38">
<div style="max-width:680px;margin:0 auto;padding:24px 16px">
<h1 style="margin:0 0 4px;font-size:22px">${esc(cfg.name)} — Weekly Bid Opportunities</h1>
<p style="margin:0 0 20px;color:#56647a;font-size:14px">${esc(cfg.regionLabel)} · week of ${esc(week)} · <b>${count}</b> open bids</p>
${sections
  .map(
    (s) => `<h2 style="margin:24px 0 8px;font-size:16px;border-bottom:2px solid #1677ff;padding-bottom:4px">${esc(s.category)} <span style="color:#56647a;font-weight:normal">(${s.bids.length})</span></h2>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px">
${s.bids
  .map(
    (b) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e3e8f0"><a href="${BID_URL(b.id)}" style="color:#0f1f38;font-weight:bold;text-decoration:none">${esc(b.title)}</a><br><span style="color:#56647a">${esc(b.agency ?? "Agency")}${b.location ? ` · ${esc(b.location)}` : ""}${value(b.estimated_value) ? ` · ${esc(value(b.estimated_value))}` : ""}</span></td><td style="padding:8px 0 8px 12px;border-bottom:1px solid #e3e8f0;white-space:nowrap;text-align:right;color:#b42318;font-weight:bold">Due ${esc(day(b.due_date))}</td></tr>`,
  )
  .join("\n")}
</table>`,
  )
  .join("\n")}
<p style="margin:28px 0 0;color:#56647a;font-size:12px">Prepared for ${esc(cfg.name)} by <a href="https://www.contrax.company" style="color:#1677ff">Contrax</a>. Confirm deadlines and requirements in each agency's documents before bidding.</p>
</div></body></html>`;
  return { subject, html, text, count };
}
