/**
 * Mississippi procurement opportunities — `ms_dfa`, the State of Mississippi's
 * public bid search (ms.gov/dfa/contract_bid_search, "MS Procurement Search",
 * run by the Department of Finance and Administration).
 *
 * WHY: Contrax had no Mississippi feed (owner 2026-10-05: "do Mississippi").
 *
 * SOURCE (verified live 2026-10-05, no login, no CAPTCHA: 140 open records):
 * the public page https://www.ms.gov/dfa/contract_bid_search/Bid fills its
 * table from its own DataTables call
 *   POST /dfa/contract_bid_search/Bid/BidData?AppId=1  (legacy DataTables form)
 * which returns every open record when iDisplayLength is large. The connector
 * GETs the page first (session cookie) and then makes that same call.
 * Records come from state agencies and universities (MAGIC) and from local
 * public entities that post their legal bid notices through MPTAP (Mississippi
 * Procurement Technical Assistance Program): counties, cities, port
 * authorities, school districts, utility districts.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title`: the record has no title field, so it is read from the notice's
 *     own words — what the bid is for ("sealed bids for X will be received" →
 *     X), else the opening sentence, else the attached document's plain name,
 *     else "<agency> <procurement category> bid notice" when the notice opens
 *     with logistics only. The full text is always the description.
 *   - `agency` = Agency, cleaned ("MS DEPT OF HEALTH" → "Mississippi Dept of
 *     Health"); blank Agency = statewide, named from the buyer's email domain
 *     (dfa.ms.gov / its.ms.gov). MPTAP notices name the entity the notice text
 *     itself names ("Board of Supervisors of Pike County" → "Pike County"), or
 *     a code spelled out only where certain, else "Mississippi public entity
 *     (CODE)".
 *   - `due_date` = SubmissionDate (midnight Central, as /Date(ms)/) plus
 *     SubmissionTime.
 *   - `solicitation_number` = BidNumber; `notice_type` = BidType.
 *   - `source_url` = the record's public details page on ms.gov.
 *   - `location` = "Mississippi"; `naics_code` / `psc` / `set_aside` NULL.
 * Skipped: not "Open" (`not_open`), sole-source certifications and intents
 * to award (`not_competitive`), submission date passed (`closed`), unreadable
 * date (`bad_date`).
 *
 * IDENTITY: `external_id = msdfa-<BidID>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const MS_DFA_SOURCE = "ms_dfa";
export const MS_DFA_BASE = "https://www.ms.gov/dfa/contract_bid_search";
export const MS_DFA_PAGE_URL = `${MS_DFA_BASE}/Bid?autoloadGrid=False`;
export const MS_DFA_DATA_URL = `${MS_DFA_BASE}/Bid/BidData?AppId=1`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
/** The page's own table columns, in order. */
const COLUMNS = ["Agency", "BidNumber", "ObjectID", "VerNumber", "BidStatus", "AdvertiseDate", "SubmissionDate", "OpeningDate", "BidID"];
const TITLE_MAX = 140;

export interface MsBid {
  BidID: string | number;
  BidNumber: string | null;
  BidStatus: string | null;
  BidType: string | null;
  BidDescription: string | null;
  Agency: string | null;
  AdditionalInfo: string | null;
  BuyerName: string | null;
  BuyerEmail: string | null;
  SubmissionDate: string | null;
  SubmissionTime: string | null;
  ProcurementCategoryDescription?: string | null;
  Attachments?: { Description: string | null }[] | null;
}

export interface MsParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

/** The page's DataTables request body (legacy server-side protocol). */
export function msRequestBody(): string {
  const p = new URLSearchParams();
  p.set("sEcho", "1");
  p.set("iColumns", String(COLUMNS.length));
  p.set("sColumns", ",".repeat(COLUMNS.length - 1));
  p.set("iDisplayStart", "0");
  p.set("iDisplayLength", "9999");
  COLUMNS.forEach((c, i) => {
    p.set(`mDataProp_${i}`, c);
    p.set(`sSearch_${i}`, "");
    p.set(`bRegex_${i}`, "false");
    p.set(`bSearchable_${i}`, "true");
    p.set(`bSortable_${i}`, "true");
  });
  p.set("sSearch", "");
  p.set("bRegex", "false");
  p.set("iSortCol_0", "0");
  p.set("sSortDir_0", "asc");
  p.set("iSortingCols", "1");
  return p.toString();
}

/** "/Date(1794808800000)/" (midnight Central) + "15:00:00" → epoch ms, or NaN. */
export function msDueMs(date: string | null | undefined, time: string | null | undefined): number {
  const m = /\/Date\((\d+)/.exec(String(date ?? ""));
  if (!m) return NaN;
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(time ?? "").trim());
  const secs = t ? Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3] ?? 0) : 23 * 3600 + 59 * 60;
  return Number(m[1]) + secs * 1000;
}

const SMALL = new Set(["of", "and", "for", "the", "to", "on", "in", "at"]);
const KEEP_UPPER = new Set(["MS", "MDEQ", "MDMH", "UMMC", "MSU", "JSU", "ITS", "DFA"]);

function titleCaseUpper(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .split(" ")
    .map((w, i) => (KEEP_UPPER.has(w.toUpperCase()) ? w.toUpperCase() : i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** MPTAP entity codes spelled out only where certain. */
const MPTAP_CODES: Record<string, string> = {
  MSU: "Mississippi State University",
  JSU: "Jackson State University",
  UM: "University of Mississippi",
  UMMC: "University of Mississippi Medical Center",
  MDEQ: "Mississippi Dept of Environmental Quality",
  MDMH: "Mississippi Dept of Mental Health",
  MGCCC: "Mississippi Gulf Coast Community College",
};

/** Place codes MPTAP posters misspelled (the attached ads spell them right). */
const PLACE_FIXES: Record<string, string> = { Grenda: "Grenada", Tupleo: "Tupelo" };

function titleWords(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.replace(/(^|[-(])([a-z])/g, (_, a, c) => a + c.toUpperCase())))
    .join(" ");
}

const NAME = "[A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,3}";
/** Local entity patterns (case-sensitive, on case-normalized text), most specific first. */
const ENTITY_PATTERNS: [RegExp, (m: string[]) => string][] = [
  [new RegExp(`Board [Oo]f Supervisors [Oo]f (${NAME}) County`), (m) => `${m[1]} County`],
  [new RegExp(`(${NAME}) County Board [Oo]f Supervisors`), (m) => `${m[1]} County`],
  [new RegExp(`(${NAME} (?:Public |Consolidated |Municipal |Separate )?School District)`), (m) => m[1]],
  [new RegExp(`(${NAME} (?:Port|Utility|Redevelopment|Industrial Development) Authority)`), (m) => m[1]],
  [new RegExp(`(${NAME} (?:Water Association|Water and Sewer District|Municipal Utilities|Regional Medical Center|Health System))`), (m) => m[1]],
  [new RegExp(`Public Service Commission [Oo]f (${NAME})`), (m) => `${m[1]} Public Service Commission`],
  [new RegExp(`\\b(City|Town|Village) [Oo]f (${NAME})`), (m) => `${m[1]} of ${m[2]}`],
  [/\b([A-Z][a-z]+) County\b/, (m) => `${m[1]} County`],
];
/** Words a capitalized run can start with that are not part of a name ("Notice Given That the Lee County"). */
const NOT_ENTITY =
  /^(the|of|and|a|an|said|such|this|that|all|any|notice|sealed|separate|board|given|by|received|held|at|conference|concerning|electronic|bids|proposals|for|in|on|to|is|hereby|office|owner|description)$/i;
const LOWER_SMALL = new Set(["of", "and", "the", "for", "at", "by", "to", "in", "on"]);

/** "The NESHOBA COUNTY BOARD OF SUPERVISORS" → "The Neshoba County Board of Supervisors". */
function normalizeCaps(text: string): string {
  return text.replace(/\b[A-Z][A-Z'-]+\b/g, (w) =>
    LOWER_SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0) + w.slice(1).toLowerCase(),
  );
}

function fixPlaces(s: string): string {
  return s.replace(/\b(Grenda|Tupleo)\b/g, (w) => PLACE_FIXES[w]);
}

function stripFiller(s: string | undefined): string {
  const words = String(s ?? "").split(" ");
  while (words.length > 1 && NOT_ENTITY.test(words[0])) words.shift();
  return words.join(" ");
}

/** The local entity a legal notice names, read from its own text, or null. */
export function msLocalEntity(description: string): string | null {
  const text = normalizeCaps(description.replace(/\s+/g, " ").slice(0, 1500));
  for (const [re, name] of ENTITY_PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, "g"))) {
      const groups = [...m].map((g, i) => (i > 0 && !/^(City|Town|Village)$/.test(g ?? "") ? stripFiller(g) : g ?? ""));
      if (groups.slice(1).some((g) => !g || NOT_ENTITY.test(g))) continue;
      const label = name(groups).replace(/\s+/g, " ").trim();
      if (label.split(" ").length >= 2) return fixPlaces(label);
    }
  }
  return null;
}

/** Agency label for a record. */
export function msAgencyName(b: Pick<MsBid, "Agency" | "BidNumber" | "BuyerEmail"> & { BidDescription?: string | null }): string {
  const agency = String(b.Agency ?? "").replace(/\s+/g, " ").trim();
  if (/^(MPTAP|MS DEVELOPMENT AUTHORITY)$/i.test(agency)) {
    const code = /\s+(.+)$/.exec(String(b.BidNumber ?? "").trim())?.[1]?.trim() ?? "";
    if (MPTAP_CODES[code.toUpperCase()]) return MPTAP_CODES[code.toUpperCase()];
    const named = msLocalEntity(String(b.BidDescription ?? ""));
    if (named) return named;
    if (/[a-z]/.test(code)) return PLACE_FIXES[code] ?? code; // a place name as the poster wrote it ("Brookhaven")
    return code ? `Mississippi public entity (${code})` : "Mississippi public entity";
  }
  if (agency) {
    return titleCaseUpper(agency)
      .replace(/^MS\b/, "Mississippi")
      .replace(/^Univ\b/, "University")
      .replace(/\bMS\b/, "Mississippi")
      .replace(/\bDept (?!of\b)/, "Dept of ");
  }
  const domain = String(b.BuyerEmail ?? "").toLowerCase().split("@")[1] ?? "";
  if (domain === "dfa.ms.gov") return "Mississippi Dept of Finance and Administration";
  if (domain === "its.ms.gov") return "Mississippi Dept of Information Technology Services";
  return "State of Mississippi";
}

/** Notices that are not open competitions: sole-source certifications and intents to award. */
export function isNonCompetitiveMsNotice(description: string): boolean {
  const text = description.replace(/\s+/g, " ").trim();
  return (
    /\bsole source\b/i.test(text) ||
    /\bintent to award\b/i.test(text) ||
    /^notice of intent\b/i.test(text) ||
    /\bthe only [^.]{0,60} on the market\b/i.test(text)
  );
}

const ACRONYMS = new Set(["CDBG", "HVAC", "ADA", "FY", "LED", "IT", "HUD", "FEMA", "MDOT", "USDA", "POTW"]);
const GENERIC_SUBJECT = /^(?:construction of )?(?:the |this |said )?(?:project|work|following|items?)$|\bthe following$/i;

/** What a legal notice is for, in its own words ("bids for X will be received" → X), or null. */
export function msSubject(description: string): string | null {
  const text = description.replace(/\s+/g, " ").replace(/\b(No)\.\s/gi, "$1 ").trim();
  const STOP = "(?:electronic|sealed|bids|proposals|plans|specifications|contract documents|will|shall|until)";
  const patterns = [
    new RegExp(`\\b(?:for|of) the following(?: project)?\\s*:\\s*([^.]{8,140}?)(?:\\.|\\s+${STOP}\\b|$)`, "i"),
    /\b(?:bids|proposals|qualifications)\s+for\s+(?:the\s+)?(?!(?:the )?following)(.{8,140}?)\s+(?:will|shall)\s+be\s+received/i,
    /\b(?:bids|proposals)\s+(?:to|for)\s+(?:furnish(?: and deliver)?|provide|supply)\s+([^.;]{8,140}?)(?:[.;]|$)/i,
    /\bproposals for (?:the )?([^.]{8,140}?) until\b/i,
    /\bopened for (?:the )?((?:construction|purchase|installation) of (?:[^.]|\.(?=\d)){8,140}?)(?:\.(?!\d)|$)/i,
    /\bfor the (?:purchase|construction|installation|replacement|renovation) of\s+([^.;]{8,140}?)(?:[.;]|\s+(?:until|will|in accordance|at the)\b|$)/i,
    /\bsolicits?\s+(?:written bids|proposals|statements of qualifications|requests for qualifications(?: \(RFQs\))?)\s+(?:from [^.]*?\s+)?for\s+([^.]{8,140}?)[.;]/i,
    /\bsubmit[^.]{0,40}\bproposals? for\s+([^.]{8,140}?)[.;]/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    let subject = m[1]
      .replace(/^(?:that certain project|the project) (?:designated|known) as\s+/i, "")
      .replace(/[,:;\s]+$/, "")
      .trim();
    if (GENERIC_SUBJECT.test(subject) || subject.split(" ").length < 2) continue;
    if (subject === subject.toUpperCase()) {
      subject = subject
        .split(" ")
        .map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : ACRONYMS.has(w.replace(/[^A-Z]/g, "")) || /\d/.test(w) || !/[AEIOUY]/.test(w) ? w : titleWords(w)))
        .join(" ");
    }
    return subject.charAt(0).toUpperCase() + subject.slice(1);
  }
  return null;
}

/** A notice that opens with logistics rather than what is being bought. */
const BOILERPLATE_LEAD =
  /^(pre-?\s?bid conference|notice to bidders|the [^.]{0,80}\b(?:will|shall) (?:receive|accept)\b|notice is hereby given|notice:? sealed|sealed (?:or electronic )?(?:bids|proposals)|(?:pr)?oposals will be received|a bid schedule|bidders may|interested parties|the deadline|this addendum|a\. your firm|you are hereby invited|separate sealed|all responses should)/i;

/** Text as a title: first sentence if short, else cut at a word. */
export function msTitle(description: string): string {
  const text = description.replace(/\s+/g, " ").trim();
  const sentence = /^(.{20,}?(?<!\b(?:No|Dept|St|Inc|Co|[A-Z]))[.;])\s/.exec(text)?.[1];
  if (sentence && sentence.length <= TITLE_MAX) return sentence.replace(/[.;]$/, "");
  if (text.length <= TITLE_MAX) return text.replace(/[.;]$/, "");
  const cut = text.slice(0, TITLE_MAX);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 60 ? cut.lastIndexOf(" ") : TITLE_MAX).trim()}…`;
}

/** An attachment file name that names the work ("LCIDA - Part 2 Cinco Water System Extension.pdf"), or null. */
export function msAttachmentSubject(name: string | null | undefined): string | null {
  const cleaned = String(name ?? "")
    .replace(/\.(pdf|docx?|xlsx?)$/i, "")
    .replace(/\.(pdf|docx?)\b/gi, "")
    .replace(/\(\d+\)/g, "")
    .replace(/^(?:bid documents?|[A-Z]{2,6})\s*-\s*/i, "")
    .replace(/^(?:[A-Z]{2,6})\s*-\s*/, "")
    .replace(/^(?:bid|rfp|ifb|rfq)\s*[\d_-]+\s+/i, "")
    .replace(/\b(?:advertisement|ad for bid)\b.*$/i, "")
    .replace(/[\s_-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[a-z]{3}/i.test(cleaned) || cleaned.split(" ").length < 2) return null;
  // Only a plain name of the work: no file-name codes, no document-type words.
  if (/_|\d{3}|^\d|^for\b|^[A-Z]+ [A-Z]+$/.test(cleaned)) return null;
  if (/\b(ad|adv|legal|notice|cover|plans?|packet|documents?|form|section|amendment|addendum|attachment|appendix|rfx|rfp|ifb|rfq|rfi|bid|bids|specs?|specifications|url|scope|sheet|intent|reference|request|letter|justification|description|publication|application|proposal|advertisment|rev|sole source)\b/i.test(cleaned)) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Card title: the notice's subject, else its opening, else an attachment's name, else "<entity> <category> bid notice". */
export function msNoticeTitle(
  description: string,
  agency: string,
  category?: string | null,
  attachments?: { Description: string | null }[] | null,
): string {
  const subject = msSubject(description);
  if (subject) return msTitle(fixPlaces(subject));
  const text = description.replace(/\s+/g, " ").trim();
  if (!BOILERPLATE_LEAD.test(text)) return msTitle(fixPlaces(text));
  for (const a of attachments ?? []) {
    const fromFile = msAttachmentSubject(a?.Description);
    if (fromFile) return msTitle(fromFile);
  }
  const kind = String(category ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/ non-it$/, "");
  return `${agency} ${kind ? `${kind} ` : ""}bid notice`;
}

function recordSkip(result: MsParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseMsBids(items: MsBid[], now: number = Date.now()): MsParseResult {
  const result: MsParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const b of items) {
    const rowId = `msdfa-${b.BidID}`;
    if (seen.has(rowId)) {
      recordSkip(result, rowId, "duplicate");
      continue;
    }
    seen.add(rowId);
    const description = String(b.BidDescription ?? "").replace(/\s+/g, " ").trim();
    if (!b.BidID || !description) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    if (String(b.BidStatus ?? "").toLowerCase() !== "open") {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    if (isNonCompetitiveMsNotice(description)) {
      recordSkip(result, rowId, "not_competitive");
      continue;
    }
    const dueMs = msDueMs(b.SubmissionDate, b.SubmissionTime);
    if (!Number.isFinite(dueMs)) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (dueMs < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const agency = msAgencyName(b);
    const number = String(b.BidNumber ?? "").trim() || null;
    const type = String(b.BidType ?? "").trim() || null;
    const extra = String(b.AdditionalInfo ?? "").replace(/\s+/g, " ").trim();
    const fullDescription = [
      /[.!?]$/.test(description) ? description : `${description}.`,
      `Mississippi ${type ?? "procurement"}${number ? ` ${number}` : ""}.`,
      extra ? (/[.!?]$/.test(extra) ? extra : `${extra}.`) : b.BuyerName ? `Buyer: ${b.BuyerName}${b.BuyerEmail ? ` (${b.BuyerEmail.toLowerCase()})` : ""}.` : "",
      "Documents and instructions on the Mississippi procurement search (see source link).",
    ]
      .filter(Boolean)
      .join(" ");
    const title = msNoticeTitle(description, agency, b.ProcurementCategoryDescription, b.Attachments);
    result.rows.push({
      external_id: rowId,
      title,
      agency,
      description: fullDescription,
      location: "Mississippi",
      category: mapCategory("", title, fullDescription),
      due_date: new Date(dueMs).toISOString(),
      estimated_value: "Not specified",
      source_url: `${MS_DFA_BASE}/Bid/Details/${b.BidID}?AppId=1`,
      set_aside: null,
      notice_type: type,
      solicitation_number: number,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${MS_DFA_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(MS_DFA_SOURCE, [detail]);
}

/** GET the page (session cookie), then the page's own data call. */
export async function fetchMsDfaBids(now: number = Date.now()): Promise<FetchResult> {
  const cookies = new Map<string, string>();
  const keep = (resp: Response) => {
    const set: string[] = typeof (resp.headers as any).getSetCookie === "function" ? (resp.headers as any).getSetCookie() : [];
    for (const c of set) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  };
  const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  let body: any;
  try {
    const page = await fetch(MS_DFA_PAGE_URL, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: controller.signal });
    keep(page);
    if (page.status !== 200) fail(httpFailureDetail(page.status, MS_DFA_PAGE_URL));
    await page.text();
    const resp = await fetch(MS_DFA_DATA_URL, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: MS_DFA_PAGE_URL,
        ...(cookies.size ? { Cookie: cookieHeader() } : {}),
      },
      body: msRequestBody(),
      signal: controller.signal,
    });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, MS_DFA_DATA_URL));
    body = await resp.json();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  if (!body || !Array.isArray(body.aaData)) fail("response shape changed: no aaData array");
  const items = body.aaData as MsBid[];
  if (Number(body.iTotalRecords) > items.length) fail(`only ${items.length} of ${body.iTotalRecords} records returned`);
  const { rows, skipped, skippedRows } = parseMsBids(items, now);
  console.log(
    `  ${MS_DFA_SOURCE}: ${rows.length} open bids accepted (listed: ${items.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
