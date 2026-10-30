/**
 * Daily bid outreach (owner 2026-10-23: "I need something that brings in leads
 * and traffic"). Each weekday morning a job finds fresh open bids, looks up
 * local businesses in that trade (prospect-finder), and queues one "Open bid
 * near you" email per business. Nothing is sent until the owner approves the
 * day's list on /admin/outreach. Four days after a first email, a single
 * follow-up with the Bid Scout founder offer is queued the same way.
 *
 * Rules the engine keeps (CAN-SPAM and plain courtesy):
 *  - every email carries the sender's postal address and a one-click
 *    unsubscribe link (List-Unsubscribe header too);
 *  - an address gets at most one first email and one follow-up, ever;
 *  - unsubscribed or "stop" addresses are suppressed for good;
 *  - only addresses a business publishes on its own website are used
 *    (prospect-finder never guesses one).
 *
 * PURE and client-safe: templates, trade list, timing. DB, Resend and token
 * signing live in outreach.server.ts.
 */

export interface OutreachTrade {
  /** Word matched in bid titles/descriptions. */
  match: string;
  /** Google Places search word ("janitorial company near …"). */
  places: string;
  /** Word used in the email ("other open janitorial bids"). */
  label: string;
}

export const OUTREACH_TRADES: readonly OutreachTrade[] = [
  { match: "janitorial", places: "janitorial", label: "janitorial" },
  { match: "custodial", places: "commercial cleaning", label: "cleaning" },
  { match: "landscap", places: "landscaping", label: "landscaping" },
  { match: "grounds maintenance", places: "landscaping", label: "grounds maintenance" },
  { match: "mowing", places: "lawn care", label: "mowing" },
  { match: "hvac", places: "HVAC contractor", label: "HVAC" },
  { match: "painting", places: "commercial painting", label: "painting" },
  { match: "roof", places: "roofing contractor", label: "roofing" },
  { match: "pest control", places: "pest control", label: "pest control" },
  { match: "plumbing", places: "plumbing contractor", label: "plumbing" },
  { match: "snow removal", places: "snow removal", label: "snow removal" },
  { match: "moving services", places: "moving", label: "moving" },
  // Owner 2026-10-30 ("yes" to more trades after the day's 12 ran dry).
  { match: "electrical", places: "electrical contractor", label: "electrical" },
  { match: "security guard", places: "security guard services", label: "security guard" },
  { match: "guard service", places: "security guard services", label: "security guard" },
  { match: "fenc", places: "fence contractor", label: "fencing" },
  { match: "concrete", places: "concrete contractor", label: "concrete" },
  { match: "tree removal", places: "tree service", label: "tree service" },
  { match: "tree trimming", places: "tree service", label: "tree service" },
];

/** Drafts the daily job may queue (first emails), across all trades. */
export const DAILY_FIRST_EMAILS = 30;
/** Businesses emailed per bid. */
export const BUSINESSES_PER_BID = 2;
/** A bid must be due at least this far out to be worth a cold email... */
export const MIN_DAYS_TO_DUE = 10;
/** ...and no further out than this (standing lists and multi-year
 * prequalifications are not "an open bid near you"). */
export const MAX_DAYS_TO_DUE = 120;
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|aol|icloud|me|mac|comcast|verizon|att|sbcglobal|bellsouth|cox|charter|earthlink|protonmail|proton)\.(com|net|me)$/;

const HIRING_BOX = /^(jobs?|careers?|hr|hiring|resumes?|employment|recruiting)$/;

/** Word stems a mailbox name may share with the business: name words and the site's name. */
function nameWords(business: string, siteHost: string | null): string[] {
  const words = business.toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/);
  const site = (siteHost ?? "").toLowerCase().replace(/^www\./, "").split(".")[0] ?? "";
  return [...words, site].filter((w) => w.length >= 4 && !/^(company|services?|inc|llc|corp)$/.test(w));
}

/**
 * True when an address plausibly belongs to the business: on its own website's
 * domain (or a subdomain of it), or a personal mailbox provider small
 * businesses commonly use whose name shares a word with the business (so a
 * font designer's gmail credited on the site is not used). Rejects addresses
 * scraped from a site that belong to someone else (a font vendor, a web
 * designer…) and hiring mailboxes (jobs@).
 */
/** Template addresses some sites leave in their pages ("example@yoursite.com"). */
const PLACEHOLDER_BOX = /^(example|sample|test|your\.?name|your\.?email|email|name|user)$/;

export function emailFitsSite(email: string, siteHost: string | null, business?: string): boolean {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  if (!domain || !local || HIRING_BOX.test(local) || /%/.test(local) || PLACEHOLDER_BOX.test(local)) return false;
  // "admin@www.example.biz" is a web address glued to a mailbox; it bounces.
  if (domain.startsWith("www.")) return false;
  if (FREE_MAIL.test(domain)) {
    if (business === undefined) return true;
    const box = local.replace(/[^a-z0-9]/g, "");
    return nameWords(business, siteHost).some((w) => box.includes(w));
  }
  const host = (siteHost ?? "").toLowerCase().replace(/^www\./, "");
  return !!host && (domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`));
}

/**
 * True when a bid hires someone to do the work. Supply, materials and parts
 * purchases and prequalified-pool-only calls are not "an open bid" a local
 * contractor can win from a cold email.
 */
export function bidIsServiceJob(title: string): boolean {
  // Owner 2026-10-29: also not invitational bids (only invited firms may bid),
  // requests for information or sources-sought notices (nothing to win yet),
  // and filter purchases.
  // Owner 2026-10-30: nor design, consultant or project-management work (an MTA
  // "Design Services for ... Roof and HVAC Replacements" went to HVAC installers
  // and a "Project Management Consultant Services for Roof Replacement" to
  // roofers; neither can bid it). Nor part orders (NSN), "furnishing" supply
  // buys, ready-mix concrete by PSI, machining systems or feasibility /
  // business-feedback market research (all queued for contractors that day).
  return !/\b(suppl(y|ies)|materials?|parts|products|equipment|filters?|pool only|pre-?qualif\w*|invitational|rfi|request for information|sources? sought|design services|consult(ant|ants|ing)|project management|engineering services|a\s?&\s?e services|nsn|furnish(ing)?|feasibility|business feedback|market research|machining|\d+\s?psi)\b/i.test(title);
}

/**
 * A bid's title matched a trade's word but names another trade's work (owner
 * 2026-10-30: an Oswego "Heat Pump and Roof Top Unit (RTU) Replacement" is HVAC
 * work, not roofing). PURE.
 */
export function bidFitsTrade(tradeLabel: string, title: string): boolean {
  if (tradeLabel === "roofing" && /\broof[\s-]?top units?\b|\brtus?\b/i.test(title)) return false;
  return true;
}

const STATE_WORDS = /^(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|district of columbia|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|[a-z]{2})$/;

/**
 * True when a Places search location names somewhere specific (a city,
 * county or agency), not just a state or a statewide purchasing group, so
 * the businesses found are actually near the work.
 */
export function placeIsLocal(place: string): boolean {
  const p = place.trim().toLowerCase().replace(/[.,]+$/g, "");
  if (!p || /purchasing group|bidnet/.test(p)) return false;
  // Internal district codes ("PRO_North_East") and statewide agencies
  // ("Texas Department of Transportation", "Office of Injured Employee
  // Counsel") don't say where the work is.
  if (/_/.test(p) || /\b(department|dept|office of|central management|state of|commonwealth of)\b/.test(p)) return false;
  // A buying office is not the job site (owner 2026-10-30: VA "Network Contract
  // Office 15" found roofers near the office, not the hospital).
  if (/\b(network contract office|contracting office|contract office|contracting activity|contracting squadron)\b/.test(p)) return false;
  if (STATE_WORDS.test(p)) return false;
  return true;
}

/**
 * The two-letter state in a Google Places address ("12 Main St, Nashville, TN
 * 37201, USA" → "TN"), or null when it has none. PURE.
 */
export function addressState(address: string | null | undefined): string | null {
  const m = /,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*(?:,|$)/.exec(address ?? "");
  return m ? m[1] : null;
}

/** Follow-up is queued this many days after the first email... */
export const FOLLOWUP_AFTER_DAYS = 4;
/** ...and only while the bid is still at least this far from due. */
export const FOLLOWUP_MIN_DAYS_TO_DUE = 2;
/** Most emails one "send" click may send. */
export const MAX_SEND_PER_BATCH = 50;

export type OutreachKind = "first" | "followup" | "prime" | "leads";

export interface OutreachEmailInput {
  kind: OutreachKind;
  business: string;
  bidId: number;
  bidTitle: string;
  buyer: string | null;
  /** YYYY-MM-DD */
  due: string;
  tradeLabel: string;
  postalAddress: string;
  unsubscribeUrl: string;
  /** Row id, carried on links for attribution. */
  contactId: number;
  /**
   * The buyer's official posting. Owner 2026-10-25 review: outreach bids are
   * new, so on Contrax their official link is still behind the paid head
   * start; a cold email has to hand over the posting itself, or the first
   * click lands on a lock.
   */
  sourceUrl?: string | null;
  /** Prime emails: the state where the awarded work is ("Texas"). */
  place?: string | null;
}

/** Only a plain http(s) link goes in an email. */
export function safePostingUrl(u: string | null | undefined): string | null {
  const s = (u ?? "").trim();
  return /^https?:\/\/[^\s"<>]+$/i.test(s) && s.length <= 500 ? s : null;
}

/** "Open landscaping bid from City of Huntsville, due Nov 12" (shared by the follow-up's "Re:"). */
export function outreachSubject(i: Pick<OutreachEmailInput, "tradeLabel" | "buyer" | "due">): string {
  const buyer = (i.buyer ?? "").trim();
  const from = buyer && buyer.length <= 45 ? ` from ${buyer}` : "";
  const due = formatDue(i.due).replace(/, \d{4}$/, "");
  return `Open ${i.tradeLabel} bid${from}, due ${due}`;
}

const SITE = "https://www.contrax.company";

export function formatDue(due: string): string {
  const d = new Date(`${due}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function link(path: string, kind: OutreachKind, contactId: number): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${SITE}${path}${sep}utm_source=email&utm_medium=outreach&utm_campaign=bid_outreach_${kind}&oc=${contactId}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Subject, plain text and HTML for one outreach email. */
export function outreachEmail(i: OutreachEmailInput): { subject: string; text: string; html: string } {
  const due = formatDue(i.due);
  const bidUrl = link(`/bid/${i.bidId}`, i.kind, i.contactId);
  const footer = [
    "",
    "Nathaniel Minetree",
    "Owner and CEO, Contrax LLC",
    "contrax.company",
    "",
    `Contrax LLC, ${i.postalAddress}`,
    `You're receiving this because ${i.business} lists this address on its website. Unsubscribe: ${i.unsubscribeUrl}`,
  ];

  const posting = safePostingUrl(i.sourceUrl);
  const postingLines = posting ? [`Official posting: ${posting}`, `Summary on Contrax: ${bidUrl}`] : [`Details: ${bidUrl}`];
  const firstSubject = outreachSubject(i);
  let subject: string;
  let body: string[];
  if (i.kind === "leads") {
    // Owner 2026-10-30 ("find me the revenue" → "2,3"): businesses that sell TO
    // contractors (bonds, insurance, equipment, staffing) get a free state list
    // of new federal contract winners; the paid product is /leads.
    const place = (i.place ?? "").trim() || "your state";
    const why = LEADS_BUYERS.find((b) => b.label === i.tradeLabel)?.why ?? "";
    subject = `New federal contract winners in ${place}`.slice(0, 140);
    body = [
      "Hi,",
      "",
      `${i.bidTitle}.`,
      "",
      `${why} Contrax tracks these winners every weekday: company, city, amount, agency and where the work is, each linked to the public federal record.`,
      "",
      `If you'd like the ${place} list, reply "yes" and I'll send it over. No charge, no catch.`,
      "",
      `More about it: ${link("/leads", i.kind, i.contactId)}`,
    ];
  } else if (i.kind === "prime") {
    // Owner 2026-10-30 ("We should do primes all over the US" → "first list
    // free, build it"): a company that just won a service contract in another
    // state usually needs a local subcontractor there. One ask, no price.
    const place = (i.place ?? "").trim() || "the work site";
    const agency = (i.buyer ?? "").trim();
    subject = `Local ${i.tradeLabel} subcontractor for your ${place} contract?`.slice(0, 140);
    body = [
      "Hi,",
      "",
      `Congratulations on your recent ${agency ? `${agency} ` : ""}${i.tradeLabel} contract in ${place}:`,
      primeDescription(i.bidTitle),
      "",
      `If you're lining up a local subcontractor for the work, I can put together a short list of ${i.tradeLabel} companies near the site, with their websites and contact info. The first list is free. Just reply with the city and I'll send it over.`,
      "",
      "I'm Nathaniel, and I run Contrax, a small company that tracks government contracts and the local contractors who do the work.",
      "",
      "Good luck with the contract.",
    ];
  } else if (i.kind === "first") {
    // Owner 2026-10-25 review: one ask (reply "yes"), no prices in a cold
    // first email, and the official posting itself.
    subject = firstSubject.slice(0, 140);
    body = [
      "Hi,",
      "",
      `${i.buyer ? i.buyer : "A local government buyer"} has an open bid that looks like a fit for ${i.business}:`,
      "",
      i.bidTitle,
      `Due: ${due}`,
      ...postingLines,
      "",
      // Owner 2026-10-30: "I'm not sending out bids for free" → "yes change it":
      // the ask is the $5 pass, not a free list by reply.
      `I'm Nathaniel, and I run Contrax, a small company that finds government bids for local contractors. If you'd like new ${i.tradeLabel} bids near you every morning, Contrax emails them at 6 AM. Your first 30 days are $5, with no automatic renewal: ${link("/pricing", i.kind, i.contactId)}`,
      "",
      "Good luck if you go for it.",
    ];
  } else {
    subject = `Re: ${firstSubject}`.slice(0, 140);
    body = [
      "Hi,",
      "",
      `Quick follow-up on the ${i.bidTitle} bid. It's due ${due}, so there's still time if you want to go for it.`,
      ...postingLines,
      "",
      `If you'd like new ${i.tradeLabel} bids near you every morning, Contrax Starter is $5 for your first 30 days with no automatic renewal: ${link("/pricing", i.kind, i.contactId)}`,
      "",
      `Or, if you don't have time to dig through bids at all, Bid Scout sends you 5 handpicked for ${i.business} every Friday, each with the requirements in plain English and what to do next. First month $49 for our founding customers: ${link("/bid-scout?source=outreach", i.kind, i.contactId)}`,
      "",
      "Either way, good luck on the bid.",
    ];
  }
  const text = [...body, ...footer].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1e293b">${text
    .split("\n")
    .map((l) => (l ? escapeHtml(l).replace(/(https:\/\/[^\s]+)/g, '<a href="$1">$1</a>') : "&nbsp;"))
    .map((l, idx, all) => (idx >= all.length - 2 ? `<div style="font-size:12px;color:#64748b">${l}</div>` : `<div>${l}</div>`))
    .join("")}</div>`;
  return { subject, text, html };
}

/** An award description as one readable line: whitespace collapsed, cut at 140. PURE. */
export function primeDescription(d: string): string {
  const one = d.replace(/\s+/g, " ").trim();
  return one.length > 140 ? `${one.slice(0, 137).replace(/\s+\S*$/, "")}...` : one;
}

/**
 * Service work a prime usually hands to a local subcontractor, by NAICS code
 * (owner 2026-10-30). `places` is the Google Places word for the trade.
 */
export const PRIME_TRADES: Readonly<Record<string, { label: string }>> = {
  "561720": { label: "janitorial" },
  "561730": { label: "landscaping" },
  "561612": { label: "security guard" },
  "561710": { label: "pest control" },
  "561790": { label: "building maintenance" },
  "561210": { label: "facilities maintenance" },
  "562111": { label: "waste hauling" },
  "238220": { label: "HVAC" },
};

/**
 * Businesses that sell to contractors, for the Award Leads outreach (owner
 * 2026-10-30). `places` is the Google Places search; `why` opens the email.
 */
export const LEADS_BUYERS: readonly { label: string; places: string; why: string }[] = [
  { label: "surety bond", places: "surety bond agency", why: "Contract winners often need performance and payment bonds." },
  { label: "contractor insurance", places: "contractor insurance agency", why: "Contract winners often need more liability and workers comp coverage." },
  { label: "equipment financing", places: "equipment financing company", why: "Contract winners often need trucks and equipment fast." },
  { label: "staffing", places: "construction staffing agency", why: "Contract winners often need extra crews to start the work." },
];

/** "41 companies based in Texas won $28.4 million in federal contracts in the last 30 days". PURE. */
export function leadsHeadline(count: number, total: number, stateName: string): string {
  const money = total >= 1e9 ? `$${(total / 1e9).toFixed(1).replace(/\.0$/, "")} billion` : `$${(total / 1e6).toFixed(1).replace(/\.0$/, "")} million`;
  return `${count} ${count === 1 ? "company" : "companies"} based in ${stateName} won ${money} in federal contracts in the last 30 days`;
}

/** Smallest award worth a prime email (the award-lead floor). */
export const PRIME_MIN_AMOUNT = 25_000;

/**
 * An award whose winner likely needs a local subcontractor: subcontractable
 * service work, big enough to matter, performed in a different state from
 * where the winner is based. PURE.
 */
export function primeAwardFits(a: { naics_code: string | null; recipient_state: string | null; pop_state: string | null; amount: number }): boolean {
  if (!a.naics_code || !PRIME_TRADES[a.naics_code]) return false;
  if (!a.recipient_state || !a.pop_state || a.recipient_state === a.pop_state) return false;
  return a.amount >= PRIME_MIN_AMOUNT;
}

/** Words of a company name that identify it ("Acme Facility Services LLC" → acme, facility). PURE. */
export function companyWords(name: string): string[] {
  const stop = new Set(["llc", "inc", "corp", "corporation", "co", "company", "ltd", "lp", "llp", "the", "and", "of", "group", "services", "service", "solutions", "enterprises", "incorporated"]);
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stop.has(w));
}

/** True when a Places result is plausibly the awarded company (shares its first identifying word). PURE. */
export function sameCompany(awardee: string, placeName: string): boolean {
  const a = companyWords(awardee);
  const p = new Set(companyWords(placeName));
  return a.length > 0 && p.has(a[0]!);
}

/** True when a first email sent at `sentAt` is due a follow-up at `now`. */
export function followupDue(sentAt: Date, now: Date): boolean {
  return now.getTime() - sentAt.getTime() >= FOLLOWUP_AFTER_DAYS * 86_400_000;
}

/** Whole days from `now` until a YYYY-MM-DD due date (UTC). */
export function daysUntil(due: string, now: Date): number {
  return Math.floor((Date.parse(`${due}T00:00:00Z`) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
}

/** A mailing address is required before anything can be sent (CAN-SPAM). */
export function validPostalAddress(a: string | null | undefined): boolean {
  const s = (a ?? "").trim();
  return s.length >= 10 && /\d/.test(s) && /[A-Za-z]/.test(s);
}

/**
 * Addresses Contrax emailed by hand from Gmail on 2026-10-22/23 (first email
 * and follow-up both sent). The engine never emails them again.
 */
export const CONTACTED_BY_HAND: readonly string[] = [
  "rglaze@dependablepestcontrol.com",
  "info@lambexterminating.com",
  "genewestpainting@gmail.com",
  "micah@micahrich.com",
  "estimating@gerloffpainting.com",
  "info@frenchpaintingcompany.com",
  "info@evergreencontractors.com",
  "kyle@douglasroofs.com",
  "john@dealsheatingandcooling.com",
  "bud9218@aol.com",
  "electrical@huttonpowerandlight.com",
  "info@coastalhc.com",
  "ezlawncare14@gmail.com",
  "reesolutions22@gmail.com",
  "contact@blisslawnandlandscape.com",
  "info@thecleaningcompanyva.com",
  "blue.ridge@comcast.net",
  "galvanhousekeeper@gmail.com",
  "jamesljordanjr@aol.com",
];
