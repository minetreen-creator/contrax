/**
 * Puerto Rico's central procurement portal (owner 2026-10-28: "yes" to Puerto
 * Rico sources). The Administración de Servicios Generales (ASG) must post every
 * government agency's bids on its public site under Ley 73-2019, so this one
 * board covers the island's state-level work.
 *
 * Read path (public pages only, no login, no documents):
 *   1. https://asg.pr.gov/subastas?page=N — cards, newest first: method,
 *      agency, number and purpose (the title, in Spanish).
 *   2. https://asg.pr.gov/subastas{number} — the detail page: Localidad,
 *      Fecha Publicación and "Acto de Apertura" (the bid opening, i.e. the
 *      deadline), dates in Spanish ("3 de diciembre de 2026", "10:00 AM").
 *      (The page's Fecha Publicación sits inside an HTML comment; not used.)
 * Puerto Rico keeps Atlantic Standard Time all year (UTC−4, no DST).
 *
 * Captured 2026-10-28 (fixtures/pr-asg): 27 cards per page, 65 pages of history.
 * Only the newest ASG_MAX_PAGES pages are read; paging stops early on a page
 * with nothing open. Requests to ASG's own detail pages are spaced
 * ASG_DETAIL_GAP_MS apart. Requests for information (RFI) are not bids and are
 * skipped, as are rows with no opening date or one already past.
 */
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import { mapCategory } from "~/lib/trade-classification";
import type { RawBid } from "./sam-gov";

export const ASG_SOURCE = "pr_asg";
export const ASG_ORIGIN = "https://asg.pr.gov";
export const ASG_MAX_PAGES = 3;
export const ASG_DETAIL_GAP_MS = 1_000;
const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)" };

export const asgListUrl = (page: number): string =>
  page <= 1 ? `${ASG_ORIGIN}/subastas` : `${ASG_ORIGIN}/subastas?page=${page}&order_by=-creado&date_scope=link`;
export const asgDetailUrl = (number: string): string => `${ASG_ORIGIN}/subastas${number}`;

export interface AsgCard {
  method: string;
  agency: string;
  number: string;
  purpose: string;
}

export interface AsgDetail {
  localidad: string | null;
  apertura: string | null;
}

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

const METHOD_EN: Record<string, string> = {
  "subasta formal": "formal bid (Subasta Formal)",
  "subasta informal": "informal bid (Subasta Informal)",
  "solicitud de propuesta (rfp)": "request for proposals (RFP)",
  "solicitud de cualificaciones (rfq)": "request for qualifications (RFQ)",
  "solicitud de información (rfi)": "request for information (RFI)",
};

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&emsp;|&ensp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z])acute;/gi, (_, c) => ({ a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" })[c as string] ?? c)
    .replace(/&ntilde;/g, "ñ")
    .replace(/&Ntilde;/g, "Ñ")
    .replace(/[​‌‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The cards on one list page, in page order. PURE. */
export function parseAsgList(html: string): AsgCard[] {
  const out: AsgCard[] = [];
  const re =
    /subasta-card-method">([\s\S]*?)<\/h1>[\s\S]*?subasta-card-agency">([\s\S]*?)<\/h2>[\s\S]*?subasta-card-number">([\s\S]*?)<\/h1>[\s\S]*?subasta-card-purpose">([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const number = decode(m[3]);
    if (!/^[0-9A-Z][0-9A-Z-]{3,40}$/i.test(number)) continue;
    out.push({ method: decode(m[1]), agency: decode(m[2]), number, purpose: decode(m[4]) });
  }
  return out;
}

/** "3 de diciembre de 2026" + "10:00 AM" (Puerto Rico, UTC−4) → ISO, or null. PURE. */
export function asgDateToIso(date: string, time: string | null): string | null {
  const d = /(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i.exec(date);
  if (!d) return null;
  const month = MONTHS[d[2].toLowerCase()];
  if (!month) return null;
  let hour = 23;
  let minute = 59;
  const t = time ? /(\d{1,2}):(\d{2})\s*([AP])\.?\s*M/i.exec(time) : null;
  if (t) {
    hour = Number(t[1]) % 12 + (t[3].toUpperCase() === "P" ? 12 : 0);
    minute = Number(t[2]);
  }
  const ms = Date.UTC(Number(d[3]), month - 1, Number(d[1]), hour + 4, minute);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Localidad and the "Acto de Apertura" opening from a detail page. PURE. */
export function parseAsgDetail(html: string): AsgDetail {
  const text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " "));
  const loc = /Localidad<\/h2>\s*([^<]{1,200})</i.exec(html);
  const ap = /Acto de Apertura\s+(\d{1,2}\s+de\s+[a-záéíóú]+\s+de\s+\d{4})\s*(\d{1,2}:\d{2}\s*[AP]\.?\s*M\.?)?/i.exec(text);
  const localidad = loc ? decode(loc[1]) : null;
  return {
    localidad: localidad && localidad.length <= 60 ? localidad : null,
    apertura: ap ? asgDateToIso(ap[1], ap[2] ?? null) : null,
  };
}

/** One card + its detail → a bid row, or the reason it is skipped. PURE. */
export function asgRow(card: AsgCard, detail: AsgDetail, now: number = Date.now()): RawBid | { skip: string } {
  const methodKey = card.method.toLowerCase();
  if (/\(rfi\)|solicitud de informaci/.test(methodKey)) return { skip: "not_a_bid" };
  if (!card.purpose) return { skip: "missing_fields" };
  if (!detail.apertura) return { skip: "no_deadline" };
  if (Date.parse(detail.apertura) < now) return { skip: "closed" };
  const method = METHOD_EN[methodKey] ?? card.method;
  const description = [
    `Puerto Rico ${method} ${card.number} posted by ${card.agency} on the Administración de Servicios Generales (ASG) public procurement portal.`,
    "The notice is in Spanish; documents and offers through the portal (see source link).",
  ].join(" ");
  return {
    external_id: `prasg-${card.number}`,
    title: card.purpose,
    agency: card.agency,
    description,
    location: detail.localidad ? `${detail.localidad}, PR` : "Puerto Rico",
    category: mapCategory("", card.purpose, description),
    due_date: detail.apertura,
    estimated_value: "Not specified",
    source_url: asgDetailUrl(card.number),
    set_aside: null,
    naics_code: null,
    psc: null,
    notice_type: card.method,
    solicitation_number: card.number,
  };
}

async function get(url: string): Promise<string> {
  let resp: Response;
  try {
    resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw new SourceUnreachableError(ASG_SOURCE, [requestFailureDetail(e)]);
  }
  if (!resp.ok) throw new SourceUnreachableError(ASG_SOURCE, [httpFailureDetail(resp.status, url)]);
  return resp.text();
}

export async function fetchPrAsgBids(now: number = Date.now()): Promise<FetchResult> {
  const result: FetchResult = { rows: [], skipped: {}, skippedRows: [] };
  const skip = (id: string, reason: string) => {
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
    result.skippedRows.push({ id, reason });
  };
  for (let page = 1; page <= ASG_MAX_PAGES; page++) {
    const cards = parseAsgList(await get(asgListUrl(page)));
    if (page === 1 && cards.length === 0) {
      throw new SourceUnreachableError(ASG_SOURCE, [`${ASG_SOURCE}: no bid cards at ${asgListUrl(1)} — page restructured`]);
    }
    let openOnPage = 0;
    for (const card of cards) {
      await new Promise((r) => setTimeout(r, ASG_DETAIL_GAP_MS));
      let detail: AsgDetail;
      try {
        detail = parseAsgDetail(await get(asgDetailUrl(card.number)));
      } catch {
        skip(`prasg-${card.number}`, "detail_unreachable");
        continue;
      }
      const row = asgRow(card, detail, now);
      if ("skip" in row) skip(`prasg-${card.number}`, row.skip);
      else {
        result.rows.push(row);
        openOnPage++;
      }
    }
    if (openOnPage === 0) break;
  }
  console.log(`  ${ASG_SOURCE}: ${result.rows.length} open bids accepted (skips: ${JSON.stringify(result.skipped)})`);
  return result;
}
