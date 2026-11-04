/**
 * Louisiana DOTD highway construction lettings — `la_dotd_lettings`
 * (owner 2026-11-04: a New Llano, LA visitor searched construction in Louisiana
 * and found 25 bids → "yes" to more Louisiana sources).
 *
 * WHY: LA DOTD is Louisiana's largest construction buyer. Its road, bridge,
 * drainage and sidewalk contracts are not on LaPAC or BidNet; they are let at
 * DOTD's own lettings (Headquarters and district lettings).
 *
 * SOURCE (captured 2026-11-04 from a GitHub Actions job; public, no login, no
 * CAPTCHA): https://wwwapps.dotd.la.gov/engineering/lettings/
 *   The "Notice to Contractors" drop-down lists one page per letting
 *   (`bidsadvn/an<district><yyyymmdd>.aspx`). Each page lists its proposals:
 *   proposal number + title, description of work, parish(es), route and the
 *   estimated construction cost range. Bids are due at 10:00 a.m. Central on
 *   the letting date.
 *
 * Only lettings dated today or later are read. A notice page that fails or
 * lists no proposals fails the run (no partial coverage).
 */
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import { odotLettingToIso } from "./oh-odot";
import type { RawBid } from "./sam-gov";

export const LA_DOTD_SOURCE = "la_dotd_lettings";
export const LA_DOTD_BASE = "https://wwwapps.dotd.la.gov/engineering/lettings/";
export const LA_DOTD_AGENCY = "Louisiana Department of Transportation and Development";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const MAX_NOTICES = 20;

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

export interface LettingNotice {
  /** "an5820261110.aspx" */
  file: string;
  /** "11/10/2026" */
  date: string;
  /** "Chase", "Headquarters" */
  label: string;
}

/** The "Notice to Contractors" drop-down on the lettings page, unique, in page order. PURE. */
export function readLettingNotices(indexHtml: string): LettingNotice[] {
  // Only Notice to Contractors options point at `~/bidsadvn/an….aspx`; the
  // other drop-downs (bidder lists, results, tabulations) point elsewhere.
  const out: LettingNotice[] = [];
  const seen = new Set<string>();
  for (const m of indexHtml.matchAll(/<option value="~\/bidsadvn\/(an[a-z0-9]+\.aspx)">\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+([^<]+?)\s*<\/option>/gi)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ file: m[1], date: m[2], label: text(m[3]) });
  }
  return out;
}

/** Bids are due at 10:00 a.m. Central (11:00 a.m. Eastern) on the letting date. PURE. */
export function lettingDueIso(date: string): string | null {
  const midnightEastern = odotLettingToIso(date);
  return midnightEastern ? new Date(Date.parse(midnightEastern) + 11 * 3_600_000).toISOString() : null;
}

export interface DotdProposal {
  proposal: string;
  title: string;
  description: string;
  parishes: string[];
  route: string;
  estimate: string;
  federal: string;
}

const panel = (block: string, name: string) => {
  const m = new RegExp(`dlResults_${name}Panel_\\d+"[^>]*>([\\s\\S]*?)</div>`).exec(block);
  return m ? text(m[1]).replace(/^[^:]{1,40}:\s*/, "").trim() : "";
};

/** The letting date in the page title ("Letting of 11/10/2026 in District 58 - Chase"). PURE. */
export function noticeLettingDate(html: string): string | null {
  return /PageTitle_lblTitle">\s*Letting of (\d{1,2}\/\d{1,2}\/\d{4})/.exec(html)?.[1] ?? null;
}

/** The proposals on one Notice to Contractors page. PURE. */
export function readNoticeProposals(html: string): DotdProposal[] {
  const parts = html.split(/<div id="ContentPlaceHolder2_dlResults_ToBeLetPanel_\d+"/).slice(1);
  const out: DotdProposal[] = [];
  for (const block of parts) {
    const head = /Proposal:\s*([^<]+?)\s*<\/a>\s*([^<]*)</.exec(block);
    if (!head) continue;
    out.push({
      proposal: head[1].trim(),
      title: text(head[2]),
      description: panel(block, "LongDescr"),
      parishes: (/lblParish_\d+">([^<]*)</.exec(block)?.[1] ?? "").split(";").map((p) => text(p)).filter(Boolean),
      route: panel(block, "Route"),
      estimate: text(/lblEstimate_\d+">([^<]*)</.exec(block)?.[1] ?? ""),
      federal: panel(block, "FedNum"),
    });
  }
  return out;
}

/** ["Caldwell"] → "Caldwell Parish, LA"; several → "Caldwell, Catahoula Parishes, LA"; none or Washington → "Louisiana". PURE. */
export function parishLocation(parishes: readonly string[]): string {
  // "Washington Parish" must never read as Washington state.
  if (parishes.length === 0 || parishes.some((p) => /statewide|various|washington/i.test(p))) return "Louisiana";
  return `${parishes.join(", ")} ${parishes.length === 1 ? "Parish" : "Parishes"}, LA`;
}

export interface LaDotdParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

export function parseLaDotdNotice(html: string, file: string, now: number = Date.now()): LaDotdParseResult {
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  const skip = (id: string, reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
    skippedRows.push({ id, reason });
  };
  const date = noticeLettingDate(html);
  const due = date ? lettingDueIso(date) : null;
  const url = `${LA_DOTD_BASE}bidsadvn/${file}`;
  const seen = new Set<string>();
  for (const p of readNoticeProposals(html)) {
    const id = p.proposal;
    if (!id || !p.title) { skip(id || "unknown", "missing_fields"); continue; }
    if (seen.has(id)) { skip(id, "duplicate"); continue; }
    seen.add(id);
    if (!due) { skip(id, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(id, "closed"); continue; }
    const where = p.parishes.length ? `${p.parishes.join(", ")} ${p.parishes.length === 1 ? "Parish" : "Parishes"}` : "";
    const details = [
      p.description ? `work: ${p.description}` : "",
      where ? `location ${where}` : "",
      p.route ? `route ${p.route}` : "",
      p.federal ? `federal project ${p.federal}` : "",
      `state proposal ${id}`,
    ].filter(Boolean);
    rows.push({
      external_id: `ladotd-${id}`,
      title: where ? `${p.title} — ${where}` : p.title,
      agency: LA_DOTD_AGENCY,
      location: parishLocation(p.parishes),
      description: `LA DOTD highway construction letting: ${p.title} (${details.join("; ")}). Sealed bids are due at DOTD's ${date} letting. The Notice to Contractors, proposal items and proposal documents are on DOTD's Construction Letting Information page.`,
      category: "Construction",
      due_date: due,
      estimated_value: p.estimate || "Not specified",
      source_url: url,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: id,
      notice_type: "Construction letting",
    });
  }
  return { rows, skipped, skippedRows };
}

export const laDotdDeps = {
  fetch: (url: string, init: RequestInit) => fetch(url, init),
  pause: (ms: number) => new Promise((r) => setTimeout(r, ms)),
};

async function getHtml(url: string): Promise<string> {
  const r = await laDotdDeps.fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

export async function fetchLaDotdLettingBids(now: number = Date.now()): Promise<FetchResult> {
  try {
    const index = await getHtml(LA_DOTD_BASE);
    const notices = readLettingNotices(index);
    if (notices.length === 0) throw new Error("Notice to Contractors list missing");
    const today = new Date(now - 6 * 3_600_000).toISOString().slice(0, 10); // Central date, near enough
    const open = notices.filter((n) => (lettingDueIso(n.date) ?? "").slice(0, 10) >= today);
    if (open.length > MAX_NOTICES) throw new Error(`${open.length} upcoming lettings; refusing an unbounded read`);
    const out: LaDotdParseResult = { rows: [], skipped: {}, skippedRows: [] };
    for (const n of open) {
      await laDotdDeps.pause(2000);
      const html = await getHtml(`${LA_DOTD_BASE}bidsadvn/${n.file}`);
      if (readNoticeProposals(html).length === 0) throw new Error(`notice ${n.file} lists no proposals; refusing partial coverage`);
      const r = parseLaDotdNotice(html, n.file, now);
      const have = new Set(out.rows.map((x) => x.external_id));
      for (const row of r.rows) {
        if (have.has(row.external_id)) { out.skipped.duplicate = (out.skipped.duplicate ?? 0) + 1; continue; }
        out.rows.push(row);
      }
      for (const [k, v] of Object.entries(r.skipped)) out.skipped[k] = (out.skipped[k] ?? 0) + v;
      out.skippedRows.push(...r.skippedRows);
    }
    return out;
  } catch (e) {
    throw new SourceUnreachableError(LA_DOTD_SOURCE, [e instanceof Error ? e.message : String(e)]);
  }
}
