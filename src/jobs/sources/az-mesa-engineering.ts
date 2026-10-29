/**
 * City of Mesa, Arizona — Engineering "Construction Bid Opportunities and Results"
 * (owner 2026-10-29: "Add the Phoenix, Tempe, Mesa and Maricopa boards").
 *
 * Mesa's capital construction bids are posted on this one public page, not on
 * the statewide Arizona Procurement Portal (`az_app` already carries some of
 * Mesa's goods-and-services bids). Its Vendor Self Service system needs a
 * login and is never read.
 *
 * Read path (public, no login, no documents opened): one GET of
 *   https://www.mesaaz.gov/Business-Development/Engineering/Construction-Bid-Opportunities-and-Results
 * Under "Opportunities", each `<h4>Bid Opening <Month D, YYYY></h4>` is followed by
 * one or more projects: `<p><strong>Title<br>Project No. X</strong></p>` and a
 * `<ul>` of documents (Bid Advertisement PDF, addenda, Bid Results).
 *
 * A project with a "Bid Results" document has already opened and is skipped. An
 * addendum that says "Revised bid date from … to <Weekday>, <Month D, YYYY>" moves
 * the opening to that date. The page gives the day only (bids are usually due
 * 1:00 p.m.), so the deadline is the end of that day in Arizona (UTC−7, no DST).
 * Rows link to the project's Bid Advertisement PDF, or the page when it has none.
 *
 * Captured 2026-10-29 (fixtures/az-mesa): 8 openings listed, 1 still open
 * (Desert Well equipping, opening Nov 12, 2026).
 */
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import { mapCategory } from "~/lib/trade-classification";
import type { RawBid } from "./sam-gov";

export const MESA_SOURCE = "az_mesa_engineering";
const ORIGIN = "https://www.mesaaz.gov";
export const MESA_PAGE_URL = `${ORIGIN}/Business-Development/Engineering/Construction-Bid-Opportunities-and-Results`;
const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)" };

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export interface MesaProject {
  title: string;
  projectNumbers: string | null;
  opening: string;
  hasResults: boolean;
  adUrl: string | null;
}

function text(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

/** "November 12, 2026" → 23:59 that day in Arizona (UTC−7), as ISO; null when unreadable. PURE. */
export function mesaDateToIso(s: string): string | null {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(s);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  const ms = Date.UTC(Number(m[3]), month - 1, Number(m[2]), 23 + 7, 59);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The projects listed under "Opportunities", in page order. PURE. */
export function parseMesaProjects(html: string): MesaProject[] {
  const start = html.search(/<h2[^>]*>\s*Opportunities\s*<\/h2>/i);
  if (start < 0) return [];
  const end = html.indexOf("<h2", start + 10);
  const section = html.slice(start, end < 0 ? undefined : end);
  const out: MesaProject[] = [];
  const groups = section.split(/<h4[^>]*>/i).slice(1);
  for (const g of groups) {
    const headEnd = g.search(/<\/h4>/i);
    const opening = text(g.slice(0, headEnd)).replace(/^Bid Opening\s*/i, "");
    const body = g.slice(headEnd);
    const parts = body.split(/<p[^>]*>\s*<strong>/i).slice(1);
    for (const part of parts) {
      const strongEnd = part.search(/<\/strong>/i);
      const lines = text(part.slice(0, strongEnd)).split("\n").map((l) => l.trim()).filter(Boolean);
      const title = lines.filter((l) => !/^Project No/i.test(l)).join(" ").trim();
      const proj = lines.find((l) => /^Project No/i.test(l));
      const docs = part.slice(strongEnd);
      const revised = /Revised bid date from[^<]*?\bto\s+(?:[A-Za-z]+,\s*)?([A-Za-z]+\s+\d{1,2},\s*\d{4})/i.exec(text(docs));
      const ad = /<a[^>]+href="([^"]+)"[^>]*>(?:(?!<\/a>).)*Bid Advertisement/is.exec(docs);
      if (!title) continue;
      out.push({
        title,
        projectNumbers: proj ? proj.replace(/^Project Nos?\.\s*/i, "").trim() : null,
        opening: revised ? revised[1] : opening,
        hasResults: /Bid Results/i.test(docs),
        adUrl: ad ? (ad[1].startsWith("http") ? ad[1] : `${ORIGIN}${ad[1]}`) : null,
      });
    }
  }
  return out;
}

/** One project → a bid row, or the reason it is skipped. PURE. */
export function mesaRow(p: MesaProject, now: number = Date.now()): RawBid | { skip: string } {
  if (p.hasResults) return { skip: "opened" };
  const due = mesaDateToIso(p.opening);
  if (!due) return { skip: "no_deadline" };
  if (Date.parse(due) < now) return { skip: "closed" };
  const description = [
    `City of Mesa Engineering construction bid${p.projectNumbers ? ` (Project ${p.projectNumbers})` : ""}. Bids open ${p.opening}.`,
    "Bids are emailed to the City as a PDF; plans and specifications are sold through ARC Document Solutions (see the bid advertisement).",
  ].join(" ");
  return {
    external_id: `mesaeng-${(p.projectNumbers ?? p.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    title: p.title,
    agency: "City of Mesa",
    description,
    location: "Mesa, AZ",
    category: mapCategory("", p.title, "construction"),
    due_date: due,
    estimated_value: "Not specified",
    source_url: p.adUrl ?? MESA_PAGE_URL,
    set_aside: null,
    naics_code: null,
    psc: null,
    notice_type: "Construction bid",
    solicitation_number: p.projectNumbers,
  };
}

export async function fetchAzMesaEngineeringBids(now: number = Date.now()): Promise<FetchResult> {
  let resp: Response;
  try {
    resp = await fetch(MESA_PAGE_URL, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw new SourceUnreachableError(MESA_SOURCE, [requestFailureDetail(e)]);
  }
  if (!resp.ok) throw new SourceUnreachableError(MESA_SOURCE, [httpFailureDetail(resp.status, MESA_PAGE_URL)]);
  const projects = parseMesaProjects(await resp.text());
  if (projects.length === 0) {
    throw new SourceUnreachableError(MESA_SOURCE, [`${MESA_SOURCE}: no projects under "Opportunities" at ${MESA_PAGE_URL} — page restructured`]);
  }
  const result: FetchResult = { rows: [], skipped: {}, skippedRows: [] };
  for (const p of projects) {
    const row = mesaRow(p, now);
    if ("skip" in row) {
      result.skipped[row.skip] = (result.skipped[row.skip] ?? 0) + 1;
      result.skippedRows.push({ id: p.projectNumbers ?? p.title, reason: row.skip });
    } else result.rows.push(row);
  }
  console.log(`  ${MESA_SOURCE}: ${result.rows.length} open bids accepted (skips: ${JSON.stringify(result.skipped)})`);
  return result;
}
