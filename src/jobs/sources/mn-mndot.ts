/**
 * MnDOT highway construction and maintenance lettings — `mn_mndot`, the
 * Minnesota Department of Transportation's list of projects currently
 * advertised for bidding.
 *
 * WHY: Contrax had no Minnesota feed (owner 2026-10-05: "Minnesota").
 *
 * SOURCE (verified live 2026-10-05, no login, no CAPTCHA: 13 projects across
 * five lettings, Oct 13 – Nov 10): the public page
 *   https://transport.dot.state.mn.us/PreLetting/advertisement.aspx
 * is an ASP.NET form: pick a letting date, press "Click To Search Advertised
 * Jobs", and the page posts back with the table. The connector GETs the page
 * and submits that same form once per letting date listed in its own
 * drop-down (district "Show All"). On 2026-10-04 MnDOT's firewall answered
 * that post with "Request Rejected"; if it does again, the run fails rather
 * than working around it.
 *
 * The description names the listing as the page does ("construction and
 * maintenance"), so the trade classifier files these as Construction.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = the Job Description from "In <County> County …" onward (the
 *     part before it is project and funding codes), cut at a word with "…";
 *     the whole Job Description and Job Location are the description.
 *   - `agency` = "Minnesota Department of Transportation (MnDOT)".
 *   - `due_date` = the letting date. The page gives no time, so it is stored
 *     at 11:59 PM Central, the convention for date-only deadlines; the
 *     description says bids are submitted through Bid Express.
 *   - `solicitation_number` = S.P. number; contract id is the identity.
 *   - `source_url` = the project's public item list on MnDOT's letting site.
 *   - `location` = "Minnesota"; the county goes in the description.
 * Skipped: letting date passed (`closed`), unreadable date (`bad_date`), no
 * contract id (`missing_fields`), the same contract on two lettings
 * (`duplicate`).
 *
 * IDENTITY: `external_id = mnmndot-<Contract Id>` (MnDOT's ProposalId).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const MN_MNDOT_SOURCE = "mn_mndot";
export const MN_MNDOT_BASE = "https://transport.dot.state.mn.us/PreLetting";
export const MN_MNDOT_PAGE_URL = `${MN_MNDOT_BASE}/advertisement.aspx`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const TITLE_MAX = 140;
const AGENCY = "Minnesota Department of Transportation (MnDOT)";

export interface MnDotProject {
  lettingDate: string; // MM/DD/YYYY
  published: string;
  proposalId: string;
  spNumber: string;
  district: string;
  county: string;
  dbeGoal: string;
  description: string;
  location: string;
}

export interface MnDotParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** The letting dates offered by the page's drop-down. */
export function mnDotLettingDates(html: string): string[] {
  const select = /<select[^>]*drpAdForCurLetting[\s\S]*?<\/select>/i.exec(html)?.[0] ?? "";
  return [...select.matchAll(/<option[^>]*value="(\d{2}\/\d{2}\/\d{4})"/g)].map((m) => m[1]);
}

/** The ASP.NET hidden fields the form posts back. */
export function mnDotHiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1];
    if (!name) continue;
    out[name] = (/value="([^"]*)"/.exec(m[0])?.[1] ?? "").replace(/&amp;/g, "&");
  }
  return out;
}

/** The form body that asks for one letting date, all districts. */
export function mnDotFormBody(html: string, lettingDate: string): string {
  const p = new URLSearchParams(mnDotHiddenFields(html));
  p.set("ctl00$MainContent$drpAdForCurLetting", lettingDate);
  p.set("ctl00$MainContent$drpDistrict", "ALL");
  p.set("ctl00$MainContent$btnAdvert", "Click To Search Advertised Jobs");
  return p.toString();
}

/** Rows of the advertisement grid for one letting. */
export function parseMnDotGrid(html: string, lettingDate: string): MnDotProject[] {
  const grid = /<table[^>]*id="MainContent_gvAd"[\s\S]*?<\/table>/i.exec(html)?.[0];
  if (!grid) return [];
  const out: MnDotProject[] = [];
  for (const tr of grid.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 14) continue;
    const proposalId = /ProposalId=(\d+)/.exec(cells[2])?.[1] ?? decode(cells[5]);
    out.push({
      lettingDate,
      published: decode(cells[0]),
      proposalId,
      spNumber: decode(cells[4]),
      district: decode(cells[6]),
      county: decode(cells[7]),
      dbeGoal: decode(cells[9]),
      description: decode(cells[12]),
      location: decode(cells[13]),
    });
  }
  return out;
}

/** "10/28/2026" → 11:59 PM Central that day (CDT/CST by US rules), or NaN. */
export function mnDotDueMs(lettingDate: string): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(lettingDate.trim());
  if (!m) return NaN;
  const [y, mo, d] = [+m[3], +m[1], +m[2]];
  // US DST: second Sunday of March through first Sunday of November.
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + 7 * (n - 1);
  };
  const dstStart = Date.UTC(y, 2, nthSunday(3, 2));
  const dstEnd = Date.UTC(y, 10, nthSunday(11, 1));
  const day = Date.UTC(y, mo - 1, d);
  const offsetHours = day >= dstStart && day < dstEnd ? 5 : 6;
  return Date.UTC(y, mo - 1, d, 23 + offsetHours, 59);
}

/** The job description from "In <County> County" onward, cut at a word. */
export function mnDotTitle(description: string): string {
  const text = description.replace(/\s+/g, " ").trim();
  const at = text.search(/\bIn [A-Z][A-Za-z.' ]+? (?:County|Counties|on T\.?H\.?)\b/);
  const body = at > 0 ? text.slice(at) : text;
  if (body.length <= TITLE_MAX) return body;
  const cut = body.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > 60 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, "")}…`;
}

function titleCaseCounty(county: string): string {
  return county
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bSt\b/, "St.");
}

function recordSkip(result: MnDotParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseMnDot(projects: MnDotProject[], now: number = Date.now()): MnDotParseResult {
  const result: MnDotParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const p of projects) {
    const rowId = `mnmndot-${p.proposalId}`;
    if (!/^\d+$/.test(p.proposalId) || !p.description) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    if (seen.has(rowId)) {
      recordSkip(result, rowId, "duplicate");
      continue;
    }
    seen.add(rowId);
    const dueMs = mnDotDueMs(p.lettingDate);
    if (!Number.isFinite(dueMs)) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (dueMs < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const county = p.county ? `${titleCaseCounty(p.county)} County` : "";
    const title = mnDotTitle(p.description);
    const dbe = /^\d+(\.\d+)?$/.test(p.dbeGoal) ? ` DBE goal ${p.dbeGoal}%.` : "";
    const description = [
      `${p.description}${/[.!?]$/.test(p.description) ? "" : "."}`,
      p.location ? `${p.location.charAt(0)}${p.location.slice(1).toLowerCase()}` : "",
      `MnDOT highway construction and maintenance letting ${p.lettingDate}${county ? `, ${county}` : ""}${p.district ? `, district ${p.district}` : ""}, S.P. ${p.spNumber}.${dbe}`,
      "Letting time not listed on the advertisement page; bids are submitted electronically through Bid Express (see source link for items).",
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title,
      agency: AGENCY,
      description,
      location: "Minnesota",
      category: mapCategory("", title, description),
      due_date: new Date(dueMs).toISOString(),
      estimated_value: "Not specified",
      source_url: `${MN_MNDOT_BASE}/propItem.aspx?ProposalId=${p.proposalId}`,
      set_aside: null,
      notice_type: "Highway letting",
      solicitation_number: p.spNumber || null,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${MN_MNDOT_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(MN_MNDOT_SOURCE, [detail]);
}

/** GET the page, then submit its own form once per listed letting date. */
export async function fetchMnDotBids(now: number = Date.now()): Promise<FetchResult> {
  const cookies = new Map<string, string>();
  const keep = (resp: Response) => {
    const set: string[] = typeof (resp.headers as any).getSetCookie === "function" ? (resp.headers as any).getSetCookie() : [];
    for (const c of set) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  };
  const headers = () => ({
    "User-Agent": UA,
    Accept: "text/html",
    Referer: MN_MNDOT_PAGE_URL,
    ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  const projects: MnDotProject[] = [];
  let dates: string[] = [];
  try {
    const first = await fetch(MN_MNDOT_PAGE_URL, { headers: headers(), signal: controller.signal });
    keep(first);
    if (first.status !== 200) fail(httpFailureDetail(first.status, MN_MNDOT_PAGE_URL));
    let html = await first.text();
    dates = mnDotLettingDates(html);
    if (!dates.length) fail("page shape changed: no letting dates in the drop-down");
    for (const date of dates) {
      const resp = await fetch(MN_MNDOT_PAGE_URL, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/x-www-form-urlencoded" },
        body: mnDotFormBody(html, date),
        signal: controller.signal,
      });
      keep(resp);
      if (resp.status !== 200) fail(httpFailureDetail(resp.status, MN_MNDOT_PAGE_URL));
      html = await resp.text();
      if (/Request Rejected/i.test(html)) fail(`MnDOT firewall rejected the letting ${date} search; not retried`);
      if (!/id="MainContent_gvAd"/.test(html) && !/lblNoLetting/.test(html)) fail(`page shape changed for letting ${date}`);
      projects.push(...parseMnDotGrid(html, date));
    }
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  const { rows, skipped, skippedRows } = parseMnDot(projects, now);
  console.log(
    `  ${MN_MNDOT_SOURCE}: ${rows.length} advertised projects accepted (lettings: ${dates.length}; listed: ${projects.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
