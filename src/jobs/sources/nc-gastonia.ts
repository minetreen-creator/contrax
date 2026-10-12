/**
 * City of Gastonia, NC bids, RFPs and RFQs — `nc_gastonia`.
 *
 * WHY: Gastonia does not post on North Carolina's eVP (0 of 260 open eVP rows
 * named the Gaston area on 2026-10-12); the City lists its solicitations on its
 * own page (owner 2026-10-12: "lets do gastonia, nc").
 *
 * SOURCE (verified live 2026-10-12, no login, no CAPTCHA):
 *   GET https://gastonianc.gov/doing-business/bids-rfps.html
 * The page lists each solicitation as a link to its PDF, titled "Request for
 * Proposals: …", "Invitation to Bid: …" or "Request for Qualifications: …".
 * The page shows NO deadline, and closed solicitations stay on it (still marked
 * "NEW!"), so the reader opens each solicitation PDF and reads the deadline the
 * City wrote there.
 *
 * DEADLINE RULE (data honesty — never guess): the deadline is the first date
 * ("October 16, 2026", "MARCH 25th, 2026") that follows a submission phrase
 * ("Proposal Due by", "Submission Deadline", "no later than", "Closing:", …)
 * within 180 characters, skipping phrases about questions. A time in that span
 * ("2:00 PM", "3:00PM") is used, read as Eastern time; a date without a time is
 * stored at 11:59 PM Eastern (the date-only convention) and the description
 * says so. A PDF with no readable deadline is skipped (`no_deadline`), never
 * listed with an invented one. The phrase the deadline came from is quoted in
 * the description so a reader can check it.
 *
 * WHAT A ROW BECOMES:
 *   - `title` = the link text after its "Request for Proposals: " / "Invitation
 *     to Bid: " / "Request for Qualifications: " label; `notice_type` = RFP /
 *     ITB / RFQ from that label.
 *   - `agency` = "City of Gastonia"; `location` = "Gastonia, NC".
 *   - `category` = mapCategory over the title.
 *   - `source_url` = the solicitation PDF.
 *   - `estimated_value` = "", `naics_code` / `psc` / `set_aside` NULL.
 * Addenda, recordings and other non-solicitation links are not rows.
 *
 * IDENTITY: `external_id = gastonia-<pdf file name>` (the City's own file).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const NC_GASTONIA_SOURCE = "nc_gastonia";
export const NC_GASTONIA_ORIGIN = "https://gastonianc.gov";
export const NC_GASTONIA_PAGE_URL = `${NC_GASTONIA_ORIGIN}/doing-business/bids-rfps.html`;
const AGENCY = "City of Gastonia";
const LOCATION = "Gastonia, NC";
const MAX_PDFS = 30;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface GastoniaListing {
  title: string;
  type: "RFP" | "ITB" | "RFQ";
  url: string;
}
export interface GastoniaDeadline {
  iso: string;
  /** The words the deadline was read from, for the description. */
  phrase: string;
  timeStated: boolean;
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, "–");
}

const LABELS: { re: RegExp; type: GastoniaListing["type"] }[] = [
  { re: /^requests? for proposals?\s*:\s*/i, type: "RFP" },
  { re: /^invitation to bid\s*:\s*/i, type: "ITB" },
  { re: /^requests? for qualifications?\s*:\s*/i, type: "RFQ" },
];

/** Solicitation links on the City's page, in page order, one per title. PURE. */
export function readGastoniaListings(html: string): GastoniaListing[] {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "");
  const out: GastoniaListing[] = [];
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  for (const m of body.matchAll(/<a\b[^>]*href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = clean(decode(m[2]!.replace(/<[^>]+>/g, " ")));
    const label = LABELS.find((l) => l.re.test(text));
    if (!label) continue;
    const title = clean(text.replace(label.re, ""));
    if (!title || /\baddend(um|a)\b|recording/i.test(title)) continue;
    const url = new URL(decode(m[1]!), NC_GASTONIA_ORIGIN).toString();
    const key = title.toLowerCase();
    if (seenUrl.has(url) || seenTitle.has(key)) continue;
    seenUrl.add(url);
    seenTitle.add(key);
    out.push({ title, type: label.type, url });
  }
  return out;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DATE_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i;
const DATE_AT_START_RE = new RegExp(`^${DATE_RE.source.replace(/^\\b/, "")}`, "i");
const MONTH_START_RE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/i;
const TIME_RE =/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?/i;
const PHRASE_RE =
  /(proposals?\s+(?:are\s+)?due|bids?\s+(?:are\s+)?due|responses?\s+(?:are\s+)?due|(?:rfp|rfq|soq)s?\s+due|due\s+by|due\s+no\s+later\s+than|submission\s+deadline|submittal\s+deadlines?|closing\s*:|no\s+later\s+than|received\s+(?:until|by|no\s+later)|deadline)/gi;

/** Eastern offset (hours): EDT −4 from the 2nd Sunday of March to the 1st Sunday of November, else EST −5. */
function easternOffset(year: number, month: number, day: number): number {
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  return day0 >= dstStart && day0 < dstEnd ? -4 : -5;
}

/** The submission deadline written in a solicitation's text, or null. PURE. */
export function readGastoniaDeadline(rawText: string): GastoniaDeadline | null {
  const text = clean(rawText);
  for (const m of text.matchAll(PHRASE_RE)) {
    const at = m.index!;
    // Look back only within the same sentence ("Questions … 4 pm. Submission Deadline …" is fine).
    const lookback = text.slice(Math.max(0, at - 40), at);
    const before = lookback.slice(lookback.lastIndexOf(".") + 1);
    const after = text.slice(at, at + 180);
    // "Deadline for Written Questions", "questions … no later than" are not the submission deadline.
    if (/question|inquir|clarification|pre-?(bid|proposal)|completed|completion/i.test(after.slice(0, 45) + " " + before)) continue;
    // The deadline is the FIRST date after the phrase: a year-less one ("March
    // 25th, at 3:00") means this phrase cannot be read, never a later date
    // (which is often the issue date).
    const first = after.search(MONTH_START_RE);
    if (first < 0) continue;
    const d = after.slice(first).match(DATE_AT_START_RE);
    if (!d) continue;
    d.index = first;
    const month = MONTHS.findIndex((name) => name.startsWith(d[1]!.toLowerCase().slice(0, 3))) + 1;
    const day = Number(d[2]);
    const year = Number(d[3]);
    if (!month || day < 1 || day > 31 || year < 2020) continue;
    const span = after.slice(0, d.index! + d[0].length + 30);
    const t = span.match(TIME_RE);
    let hour = 23;
    let minute = 59;
    if (t) {
      hour = Number(t[1]);
      minute = Number(t[2] ?? 0);
      if (hour < 1 || hour > 12 || minute > 59) continue;
      if (t[3]!.toLowerCase() === "p" && hour !== 12) hour += 12;
      if (t[3]!.toLowerCase() === "a" && hour === 12) hour = 0;
    }
    const iso = new Date(Date.UTC(year, month - 1, day, hour, minute) - easternOffset(year, month, day) * 3_600_000).toISOString();
    return { iso, phrase: clean(span), timeStated: !!t };
  }
  return null;
}

/** One listing + its PDF text → a row, or a skip reason. PURE. */
export function gastoniaRow(
  listing: GastoniaListing,
  pdfText: string | null,
  now: number,
): { row: RawBid } | { skip: string } {
  if (pdfText === null) return { skip: "pdf_unreadable" };
  const deadline = readGastoniaDeadline(pdfText);
  if (!deadline) return { skip: "no_deadline" };
  if (Date.parse(deadline.iso) <= now) return { skip: "closed" };
  const file = decodeURIComponent(new URL(listing.url).pathname.split("/").pop() ?? "").replace(/\.pdf$/i, "");
  const kind = { RFP: "Request for Proposals", ITB: "Invitation to Bid", RFQ: "Request for Qualifications" }[listing.type];
  const description = [
    `City of Gastonia ${kind}: ${listing.title}.`,
    `Deadline as stated in the solicitation: "${deadline.phrase.slice(0, 200)}".`,
    deadline.timeStated ? "" : "No time is stated with the deadline date.",
    "Full requirements and submission instructions are in the solicitation PDF.",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    row: {
      external_id: `gastonia-${file.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      title: listing.title,
      agency: AGENCY,
      description,
      location: LOCATION,
      category: mapCategory("", listing.title, ""),
      due_date: deadline.iso,
      estimated_value: "",
      source_url: listing.url,
      set_aside: null,
      notice_type: listing.type,
      solicitation_number: null,
      naics_code: null,
      psc: null,
    },
  };
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text as string;
}

function fail(detail: string): never {
  console.error(`  ${NC_GASTONIA_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(NC_GASTONIA_SOURCE, [detail]);
}

/** Fetch the City's bids page, read each solicitation PDF's deadline, return open rows. */
export async function fetchNcGastoniaBids(now: number = Date.now()): Promise<FetchResult> {
  let html = "";
  try {
    const resp = await fetch(NC_GASTONIA_PAGE_URL, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, NC_GASTONIA_PAGE_URL));
    html = await resp.text();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  }
  if (!/Bids\s*(&amp;|&)\s*RFPs/i.test(html)) fail("page shape changed: not the Bids & RFPs page");
  const listings = readGastoniaListings(html).slice(0, MAX_PDFS);
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  for (const listing of listings) {
    let text: string | null = null;
    try {
      const resp = await fetch(listing.url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
      if (resp.status === 200) text = await pdfText(new Uint8Array(await resp.arrayBuffer()));
    } catch {
      text = null;
    }
    const r = gastoniaRow(listing, text, now);
    if ("row" in r) rows.push(r.row);
    else {
      skipped[r.skip] = (skipped[r.skip] ?? 0) + 1;
      skippedRows.push({ id: listing.url, reason: r.skip });
    }
  }
  console.log(
    `  ${NC_GASTONIA_SOURCE}: ${rows.length} open solicitations accepted (listed ${listings.length}; skips: ${
      Object.entries(skipped)
        .map(([k, n]) => `${k}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
