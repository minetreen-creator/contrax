/**
 * What a bid shows to someone who has not paid (owner 2026-11-18: "we need to make it for all
 * visitors, no more freebies"). In the last 7 days 148 people opened a bid page and about 9 tapped
 * the price: the free page named the agency, and with the agency and the title anyone can find the
 * official notice without us. So for everyone without paid access the buyer is described, not
 * named ("A South Carolina school district"), and the agency's own numbers are taken out of the
 * title. Paying members see the real name, number and title.
 *
 * This runs on the server: the page data a browser receives is readable. PURE.
 */
import { agencyDisplay, stripAgencyNumbers } from "./bid-job-summary";
import { STATE_NAMES } from "./contract-map";

export type AgencyKind = "college" | "school" | "county" | "city" | "federal" | "state" | "public";

const KIND_LABEL: Record<AgencyKind, string> = {
  college: "college or university",
  school: "school district",
  county: "county government",
  city: "city or town",
  federal: "federal agency",
  state: "state agency",
  public: "public agency",
};

export function agencyKind(agency: string | null | undefined, source?: string | null): AgencyKind {
  const a = String(agency ?? "");
  if (/\b(university|college|institute of technology)\b/i.test(a)) return "college";
  if (/\b(schools?|board of education|isd|unified|academy)\b/i.test(a)) return "school";
  if (/\b(county|parish|borough)\b/i.test(a)) return "county";
  if (/\b(city|town|township|village|municipal(?:ity)?)\b/i.test(a)) return "city";
  if (/^sam/i.test(String(source ?? "")) || agencyDisplay(a) === "Federal agency" || /\b(dept of (the )?(army|navy|air force|veterans|interior|defense)|department of (the )?(army|navy|air force|veterans affairs|the interior|defense)|usace|navfac|navfacsyscom|gsa|federal)\b/i.test(a)) return "federal";
  if (/\b(department|dept|state|commonwealth|authority|commission|division)\b/i.test(a)) return "state";
  return "public";
}

/** "A South Carolina school district", "An Ohio county government", "A federal agency". Null when there is no buyer. */
export function publicAgency(agency: string | null | undefined, stateName: string | null | undefined, source?: string | null): string | null {
  const a = String(agency ?? "").trim();
  if (!a) return null;
  const shown = agencyDisplay(a);
  // Already a description, not a name (BidNet purchasing groups, federal office codes).
  if (shown && (/ public agency \(posted on BidNet Direct\)$/.test(shown) || shown === "Federal agency")) return shown === "Federal agency" ? "A federal agency" : shown;
  const kind = agencyKind(a, source);
  if (kind === "federal") return "A federal agency";
  const st = String(stateName ?? "").trim();
  if (!st) return `A ${KIND_LABEL[kind]}`;
  return `${/^[AEIO]/.test(st) ? "An" : "A"} ${st} ${KIND_LABEL[kind]}`;
}

const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEYWORD = /^(ifb|rfb|rfp|rfq|rfi|itb|itn|bid|solicitation|no\.?|number|#)$/i;

function isCode(token: string, afterKeyword: boolean): boolean {
  const t = token.replace(/[,:;]+$/, "");
  if (!t) return true;
  if (/^[-–—:|]+$/.test(t)) return true;
  if (KEYWORD.test(t)) return true;
  if (!/\d/.test(t) || !/^[#A-Za-z0-9][A-Za-z0-9#./_-]*$/.test(t)) return false;
  // A fiscal year or a plain year is part of the job's name ("FY2027 Local Roads Resurfacing").
  if (/^fy\d{2,4}$/i.test(t) || /^(19|20)\d{2}$/.test(t)) return false;
  return afterKeyword || t.length >= 5 || /^#/.test(t) || /^\d+-\d+$/.test(t);
}

/** The buyer's name taken out of a piece of text. */
export function scrubAgencyName(text: string, agency: string | null | undefined): string {
  const a = String(agency ?? "").trim();
  if (a.length < 5) return text;
  const states = Object.values(STATE_NAMES).map(escapeRe).join("|");
  const out = text.replace(new RegExp(`(?:the\\s+)?${escapeRe(a)}(?:,\\s*(?:${states}))?`, "gi"), "the agency");
  return out.replace(/^the agency\b/, "The agency").replace(/\s{2,}/g, " ").trim();
}

/**
 * The buyer's name taken out of a title. In a title the name is dropped, not replaced ("City of
 * Corona Parks Janitorial Services" reads "Parks Janitorial Services"); only a title that is a
 * sentence about the buyer keeps a subject ("The agency is seeking…").
 */
function dropAgencyFromTitle(title: string, agency: string | null | undefined): string {
  const marked = scrubAgencyName(title, agency);
  if (marked === title) return title;
  const rest = marked.replace(/\bthe agency\b,?\s*/gi, "").replace(/\s{2,}/g, " ").trim();
  return /^(is|are|seeks|seeking|requests|invites|will|has|needs)\b/i.test(rest) ? `The agency ${rest}` : rest;
}

/** A title without the agency's own numbers or name: "IFB-26-27-020 Street Resurfacing" → "Street Resurfacing". */
export function publicTitle(title: string | null | undefined, agency?: string | null, ids?: string | null): string {
  const original = String(title ?? "").replace(/\s+/g, " ").trim();
  let t = stripAgencyNumbers(original, ids);
  // Codes at the end: ", Project No. 2027-01", "(IFB 2027-005)", ", RFQ 704022".
  for (let i = 0; i < 3; i++) {
    t = t.replace(/[\s,(–-]*\(?\b(?:project|ifb|rfb|rfp|rfq|itb|bid|solicitation)\b\s*(?:no\.?|number|#)?\s*[:#]?\s*[A-Za-z0-9][\w./-]*\d[\w./-]*\)?\s*$/i, "").trim();
  }
  // Codes at the start: "RFB 27-54218", "Bid 4001-091626", "#2026-30", "BL162-26,", "ITB No. 26-3026-11JL -".
  const tokens = t.split(" ");
  let i = 0;
  let afterKeyword = false;
  while (i < tokens.length - 1 && isCode(tokens[i]!, afterKeyword)) {
    afterKeyword = KEYWORD.test(tokens[i]!.replace(/[,:;]+$/, ""));
    i++;
  }
  t = dropAgencyFromTitle(tokens.slice(i).join(" "), agency).replace(/^[\s,:;–-]+/, "").replace(/[\s,:;(–-]+$/, "").trim();
  // A named school identifies the buyer as surely as the district's name does.
  t = t.replace(/\b(?:[A-Z][\w.'’-]*\s+){1,3}(Elementary|Middle|High|Primary|Intermediate|Junior High) School\b/g, "$1 School");
  if (t.length < 8) return original.length >= 8 && !/\d{3,}/.test(original) ? original : "Public bid";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const PLACE_LEAD = /^(?:the|board|of|school|schools|public|government|commissioners|commission|district|county|city|town)$/i;

/**
 * Where a job is, for someone who has not paid (owner 2026-11-23, "do 2": two in three Facebook
 * visitors left from the list they landed on, and a list that says only "South Carolina" cannot tell
 * a contractor whether a job is 10 minutes away or 4 hours). When the stored location is no more than
 * the state, the city or county is read from the buyer's name: "City of Rock Hill" gives "Rock Hill",
 * "Lancaster County School District" gives "Lancaster County". For a city or county government that
 * does point at the buyer; the owner chose that. State, federal and college buyers give nothing.
 * A location that already says more than the state is returned as it is. PURE.
 */
export function publicPlace(agency: string | null | undefined, location: string | null | undefined, stateName: string | null | undefined, source?: string | null): string | null {
  const loc = String(location ?? "").trim();
  const st = String(stateName ?? "").trim();
  const onlyState = !loc || (!!st && loc.toLowerCase() === st.toLowerCase()) || /^[A-Z]{2}$/.test(loc);
  if (!onlyState) return loc || null;
  const a = String(agency ?? "").trim();
  const kind = agencyKind(a, source);
  let place: string | null = null;
  if (kind === "county" || kind === "city" || kind === "school") {
    const cityOf = a.match(/\b(?:City|Town|Village|Borough|Township)\s+of\s+([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3})/);
    const countyOf = a.match(/\bCounty\s+of\s+([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2})/);
    const county = a.match(/((?:[A-Z][A-Za-z.'-]*\s+){1,4})County\b/);
    if (cityOf) place = cityOf[1].trim();
    else if (countyOf) place = `${countyOf[1].trim()} County`;
    else if (county) {
      const words = county[1].trim().split(/\s+/);
      while (words.length && PLACE_LEAD.test(words[0])) words.shift();
      if (words.length && words.length <= 3) place = `${words.join(" ")} County`;
    }
  }
  if (!place) return loc || null;
  return st ? `${place}, ${st}` : place;
}
