/**
 * The supplier report (owner 2026-11-18: "lets make the website change"). A month of traffic showed
 * small contractors search and do not pay; the businesses that sell to contractors (material
 * suppliers, equipment rental, staffing, bonding and insurance, licensing) spend money to reach
 * them. For those firms the same data is a list of who to call: which public jobs are opening in
 * their state, which federal jobs were just awarded and to whom, and which federal contracts end
 * soon. /suppliers shows a live sample and takes a request for a free report; each request is
 * emailed to the owner. Nothing here is charged online yet.
 *
 * Data honesty: winners are known for FEDERAL awards only. State, county and school award
 * winners are not collected, so the page says so and never promises them.
 */
import { STATE_NAMES } from "./contract-map";

/** The Agency plan's price (owner 2026-11-12: "$199 it is"). The paid step after the free report. */
export const SUPPLIER_PRICE = "$199";
/**
 * What suppliers are told the paid plan is called (owner 2026-11-18, review: "Agency plan" reads as
 * a plan for government or marketing agencies). It is the existing Agency plan, and the checkout
 * and receipt still say Agency, so the page says so once.
 */
export const SUPPLIER_PLAN_NAME = "Territory plan";
export const SUPPLIER_PLAN_BILLED_AS = "Billed as the Contrax Agency plan.";
/** The one-line pitch. It names only what the report holds: jobs opening, and federal winners. */
export const SUPPLIER_SUBHEAD =
  "Suppliers, equipment rental, staffing and bonding agents: a weekly list of the public jobs opening in your territory, and the contractors who just won federal work there.";
export const SUPPLIER_SAMPLE_STATE = "SC";
/** States shown in the live sample (owner 2026-11-18: "lets add NC too", then "might as well add VA, FL and GA"). The first is the form's default. */
export const SUPPLIER_SAMPLE_STATES: readonly string[] = ["SC", "NC", "VA", "GA", "FL"];
/** The homepage lists every state's counts but real rows for only this many, so it stays short; /suppliers shows them all. */
export const SUPPLIER_HOME_ROW_STATES = 2;
/** Federal awards below this are left out of the sample: a $25,030 job is real but tells a supplier little. */
export const SUPPLIER_AWARD_MIN = 100_000;

export const SUPPLIER_TYPES: readonly { id: string; label: string; why: string }[] = [
  { id: "materials", label: "Building materials or supply", why: "Your report leads with the jobs that need materials priced before bid day: roofing, paving, concrete and building work." },
  { id: "equipment", label: "Equipment rental or sales", why: "Your report leads with site work, paving, demolition and utility jobs, where contractors rent or buy equipment." },
  { id: "staffing", label: "Staffing or labor", why: "Your report leads with the largest jobs and the companies that just won federal work, the ones most likely to need crews." },
  { id: "bonding", label: "Bonding or insurance", why: "Your report leads with who just won federal work and what closes soon. Public jobs commonly require bid and performance bonds." },
  { id: "licensing", label: "Licensing, training or consulting", why: "Your report leads with companies from other states winning work in yours, and with new jobs by trade." },
  { id: "other", label: "Something else", why: "You get all four sections. Tell us what you sell when the report arrives and we will point out the jobs that fit." },
];

/** Under the counts table: what "closing in 7 days" means to someone who sells to the bidders. */
export const SUPPLIER_CLOSING_NOTE = "Closing in 7 days means contractors are pricing those jobs now. Get your quote to them before bid day.";
/** Under the five-state table: the sample is five states, the report is any state. */
export const SUPPLIER_ANY_STATE_NOTE = "The sample shows five Southeast states. The report covers any state: pick yours in the form.";
/** Beside the send button: who the report is written for. */
export const SUPPLIER_AUDIENCE = "Written for outside sales reps, estimators and branch managers.";
/** The report is sent as an ordinary email by the owner, so it can be forwarded as it is. */
export const SUPPLIER_FORWARD_NOTE = "Need a manager's sign-off? The report arrives as a plain email you can forward.";

export const SUPPLIER_INCLUDES: readonly string[] = [
  "New public construction jobs in your state, sorted by trade",
  "Jobs closing in the next 7 days",
  "Federal jobs just awarded in your state, with the winning company and the amount",
  "Federal contracts in your state that end soon, with the company that holds them",
];

/**
 * How a sales rep uses each part (owner 2026-11-18, review). Each line promises only what the
 * report holds: it names jobs and federal winners, not who is bidding and not anyone's phone.
 */
export const SUPPLIER_USES: readonly { part: string; use: string }[] = [
  { part: "Jobs opening and closing soon", use: "Contractors are pricing these right now. Get your material or rental quote to the ones you know before they submit." },
  { part: "Just awarded", use: "Call the winner while they are mobilizing and choosing their vendors." },
  { part: "Contracts ending soon", use: "The work will be bid again. Reach the company that holds it before the new bid is posted." },
];
/** What a row contains, said plainly so nobody expects a phone list. */
export const SUPPLIER_CONTACT_NOTE =
  "Federal winners are listed with the award record and, from the company's public SAM.gov registration where it has one, its website, business address and named contact. The report does not include phone numbers or email addresses, which SAM.gov does not publish.";
/** The free report is built by hand for the request, so it can be led with what fits the requester. */
export const SUPPLIER_TAILOR_NOTE = "Tell us what you sell and your report leads with the jobs most likely to need it.";
/** True of the Agency plan (PLAN_COPY.agency: up to 10 workspaces, each with its own states and trades). */
export const SUPPLIER_MULTI_STATE = "Cover more than one state? The plan includes up to 10 territories, each with its own states and trades, at the same price.";

/** The one line of fine print the homepage shows; /suppliers carries the full wording. */
// Owner's review 2026-11-18: lead with what the rep can do with it; the limit stays, said plainly, second.
export const SUPPLIER_FINE_PRINT_SHORT = "Federal winners come with the company's website, office address and named contact where public: enough to look them up and add them to your CRM. Phone numbers and emails are not included.";

/**
 * Titles that are a purchase of goods, not work on a site (owner 2026-11-18: "District 6 Deicer for
 * Bridges" led the construction sample because its title says "bridge"). Postgres ~* and JS.
 */
export const SUPPLIER_SUPPLY_PATTERN = "de-?icer|supplies|purchase of|furnish and deliver|aggregate|road salt|rock salt|\\mparts\\M|\\mfuel\\M|request for qualifications|statement of qualifications|engineering services|consulting services|architectural services|design services";

const HONORIFIC = /^(mr|mrs|ms|miss|mx|dr|sir|madam|n\/?a|none)\.?$/i;

/** "Name, Title" for a SAM contact; a title that is only an honorific ("Mr.") or a blank filler is left off. */
export function contactLine(name: string | null | undefined, title: string | null | undefined): string | null {
  // SAM stores some names already in mixed case ("Mcalhaney"), which tidyCaps leaves alone.
  const n = (name ?? "").trim().replace(/\bMc([a-z])(?=[a-z]{2})/g, (_m, ch: string) => `Mc${ch.toUpperCase()}`);
  if (!n) return null;
  const t = (title ?? "").trim();
  return t && !HONORIFIC.test(t) ? `${n}, ${t}` : n;
}

const CAPS_KEEP = new Set([
  "LLC", "LLP", "LP", "PC", "PLLC", "JV", "II", "III", "IV", "USA", "US", "DBA", "HQ",
  "HVAC", "AHU", "AHUS", "MEP", "TPO", "ADA", "CIPP", "IAW", "EO", "RFP", "RFQ", "IFB",
  "DOT", "VDOT", "NCDOT", "SCDOT", "GDOT", "FDOT", "USCG", "USACE", "NPS", "GSA", "FAA", "FEMA", "USDA", "NASA", "DOD", "DHS",
  "VA", "NC", "SC", "GA", "FL", "AL", "TN", "KY", "MD", "DC", "TX", "OH", "PA", "NY", "NJ",
  // Federal programs and offices that show up in award descriptions.
  "GAOA", "EHRM", "LSCI", "FCI", "USP", "VAMC", "VHA", "IDIQ", "MATOC", "SATOC", "BPA", "FY", "USMC", "USAF", "NAVFAC", "AFB", "MCAS", "NAS", "JBSA", "NOAA", "USFS", "BLM", "EPA", "ATC", "UPS", "LED", "CCTV", "ADAL", "FRP", "RTU", "AC",
]);
const CAPS_FIXED: Record<string, string> = { INC: "Inc", CORP: "Corp", CO: "Co", LTD: "Ltd" };
const CAPS_SMALL = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

/**
 * Government records arrive in capitals ("BRANTLEY CONSTRUCTION SERVICES, LLC"). Text with no
 * lowercase letter is put in title case; known acronyms and anything with a digit or a period
 * (HC-130J, U.S., B1786) are left alone. Text that already has lowercase is returned unchanged. PURE.
 */
export function tidyCaps(raw: string): string {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!text || /[a-z]/.test(text)) return text;
  return text
    .split(" ")
    .map((word, i) => {
      const bare = word.replace(/[^A-Za-z]/g, "");
      if (!bare || /[0-9]/.test(word) || /\.[A-Za-z]/.test(word) || CAPS_KEEP.has(bare)) return word;
      if (CAPS_FIXED[bare]) return word.replace(bare, CAPS_FIXED[bare]);
      // A short word with no vowel is an abbreviation we do not know (SDC, BLDG): leave it in capitals.
      if (bare.length <= 4 && !/[AEIOUY]/.test(bare)) return word;
      const lower = word.toLowerCase();
      if (i > 0 && CAPS_SMALL.has(lower)) return lower;
      return lower
        .replace(/(^|[-/(&])([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase())
        // Surnames and places such as McAlhaney, McDonald, McClellanville.
        .replace(/\bMc([a-z])(?=[a-z]{2})/g, (_m, ch: string) => `Mc${ch.toUpperCase()}`);
    })
    .join(" ");
}

/** Cut at a word boundary and end with an ellipsis, so nothing stops mid-word. PURE. */
export function clip(raw: string, max: number): string {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:(-]+$/, "")}…`;
}

export const SUPPLIER_NOT_YET = "Winners of state, county and school jobs are not in the report yet. Federal winners are.";

/** Titles that read as construction or building-trade work (Postgres ~* and JS). */
export const SUPPLIER_TITLE_PATTERN =
  "roof|paving|resurfac|sidewalk|renovation|construction|building|hvac|chiller|boiler|electrical|generator|plumbing|painting|demolition|concrete|fenc|bridge|water line|sewer";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface SupplierRequest {
  email: string;
  company: string;
  type: string;
  state: string;
}

/** A clean request, or the message to show. PURE. */
export function cleanSupplierRequest(body: unknown): { ok: true; request: SupplierRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const email = str(b.email, 200).toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: "Enter the email address the report should go to." };
  const state = str(b.state, 2).toUpperCase();
  if (!STATE_NAMES[state]) return { ok: false, error: "Pick the state you sell in." };
  const type = SUPPLIER_TYPES.some((t) => t.id === b.type) ? String(b.type) : "other";
  return { ok: true, request: { email, company: str(b.company, 120), type, state } };
}

/** The email the owner gets for one request. PURE. */
export function supplierNotice(r: SupplierRequest): { subject: string; text: string } {
  const type = SUPPLIER_TYPES.find((t) => t.id === r.type)?.label ?? r.type;
  const state = STATE_NAMES[r.state] ?? r.state;
  return {
    subject: `Supplier report request: ${r.company || r.email}, ${state}`,
    text: [
      "Someone asked for the free supplier report on /suppliers.",
      "",
      `Company: ${r.company || "(not given)"}`,
      `Business: ${type}`,
      `State: ${state}`,
      `Email: ${r.email}`,
      "",
      `Reply to this email to answer them. The page told them the report is free this once and ${SUPPLIER_PRICE} a month after that.`,
    ].join("\n"),
  };
}

export interface SupplierSample {
  state: string;
  stateName: string;
  open: number;
  newThisWeek: number;
  closingSoon: number;
  newJobs: { id: number; title: string; agency: string; due: string }[];
  /** `url` is the award's public record on USAspending.gov . */
  /** `site` is the company's own website from its public SAM.gov registration, when it lists one. */
  /** `address` and `contact` come from the company's public SAM.gov registration, when it is on file. */
  awards: { company: string; where: string; amount: number; date: string; what: string; url: string; site: string | null; address: string | null; contact: string | null }[];
  ending: { company: string; amount: number; end: string; agency: string }[];
}

/** "$7.9 million", "$890,535". PURE. */
export function supplierMoney(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)} billion`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)} million`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** "Dec 18". PURE. */
export function supplierDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
