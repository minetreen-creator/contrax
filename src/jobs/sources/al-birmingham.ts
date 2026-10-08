/** Birmingham Purchasing Division public board. Captured/verified 2026-10-08.
 * Purchasing only: capital projects and PEP RFP boards are separate sources.
 * Deadlines use the explicitly printed CST/CDT offset, never opening dates.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";
export const BIRMINGHAM_URL = "https://www.birminghamal.gov/work/bidding-opportunities";
const SOURCE = "al_birmingham_purchasing";
const fail = (message: string): never => { throw new SourceUnreachableError(SOURCE, [message]); };
const text = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const MONTHS = "january february march april may june july august september october november december".split(" ");
export function birminghamDeadline(body: string): { iso: string; printed: string } | null {
  const value = text(body).match(/Bids Due:\s*(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4}),?\s*by\s*(\d{1,2}):(\d{2})\s*([ap])\.?m\.?\s*(CST|CDT)/i);
  if (!value) return null;
  const [, monthName, day, year, hour, minute, ampm, zone] = value;
  const month = MONTHS.indexOf(monthName.toLowerCase()) + 1;
  if (!month || +hour < 1 || +hour > 12 || +minute > 59 || +day < 1 || +day > 31) return null;
  const calendar = new Date(Date.UTC(+year, month - 1, +day));
  if (calendar.getUTCMonth() !== month - 1) return null;
  const h = +hour % 12 + (ampm.toLowerCase() === "p" ? 12 : 0);
  const iso = new Date(`${year}-${String(month).padStart(2,"0")}-${day.padStart(2,"0")}T${String(h).padStart(2,"0")}:${minute}:00${zone.toUpperCase() === "CST" ? "-06:00" : "-05:00"}`).toISOString();
  return { iso, printed: value[0] };
}
export function parseBirminghamPayload(payload: any, now = Date.now()): FetchResult {
  const node = payload?.props?.pageProps?.nodeResource;
  if (node?.path !== "/work/bidding-opportunities" || node?.title !== "Bidding Opportunities" || !Array.isArray(node.content)) fail("page shape changed");
  const rows: RawBid[] = [], skipped: Record<string, number> = {}, skippedRows: {id: string; reason: string}[] = [];
  const skip = (id: string, reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; skippedRows.push({id, reason}); };
  const seen = new Set<string>();
  let bidBlocks = 0;
  for (const paragraph of node.content) {
    const title = text(String(paragraph.title ?? ""));
    const match = title.match(/^BID\s*#\s*(\d{2}-\d+)\b/i);
    if (!match) continue;
    bidBlocks++;
    const number = match[1], id = `birminghampurchasing-${number}`;
    if (seen.has(id)) { skip(id, "duplicate"); continue; }
    seen.add(id);
    const body = String(paragraph.body?.processed ?? "");
    const deadline = birminghamDeadline(body);
    if (!deadline) { skip(id, "invalid_deadline"); continue; }
    if (Date.parse(deadline.iso) <= now) { skip(id, "closed"); continue; }
    const documents = [...body.matchAll(/href=["']([^"']+)["']/gi)].map(m => {
      const link = m[1].replace(/&amp;/g,"&");
      try { const u = new URL(link,BIRMINGHAM_URL); return u.origin === new URL(BIRMINGHAM_URL).origin && u.pathname === "/archival-document" ? u.searchParams.get("document") ?? "" : link; } catch { return ""; }
    }).filter(link => /\.pdf(?:\?|$)/i.test(link));
    const document = documents.find(link => { try { const u = new URL(link, BIRMINGHAM_URL); return u.protocol === "https:" && (u.hostname === "www.birminghamal.gov" || u.hostname === "s3.us-east-2.amazonaws.com" && u.pathname.startsWith("/assets.birminghamal.gov/")); } catch { return false; } });
    if (!document) { skip(id, "missing_document"); continue; }
    const description = `City of Birmingham Purchasing Division sealed bid. ${deadline.printed}. Deadline follows the source's explicit ${deadline.printed.match(/CST|CDT/i)?.[0]} designation. Refer to the official solicitation for scope, submission instructions and amendments.`;
    rows.push({ external_id: id, title, agency: "City of Birmingham, Alabama", description, location: "Birmingham, AL", category: mapCategory("",title,description), due_date: deadline.iso, estimated_value: "", source_url: new URL(document,BIRMINGHAM_URL).href, solicitation_number: number, notice_type: "Invitation to bid", set_aside: null, naics_code: null, psc: null });
  }
  if (!bidBlocks && !node.content.some((p: any) => /no (?:current|open|active) (?:bids|bidding opportunities)/i.test(text(String(p.body?.processed ?? ""))))) fail("no bid blocks or explicit empty-board notice");
  if (bidBlocks && !rows.length && Object.keys(skipped).some(key => key !== "closed" && key !== "duplicate")) fail("no usable rows: invalid deadline or document shape");
  return {rows,skipped,skippedRows};
}
export function parseBirminghamHtml(html: string, now = Date.now()): FetchResult {
  if (!/<h1\b[^>]*>Bidding Opportunities<\/h1>/i.test(html)) fail("missing purchasing board heading");
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? fail("missing purchasing board article");
  const headings = [...article.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  const content = headings.map((h,i) => ({title: text(h[1]),body:{processed: article.slice(h.index! + h[0].length, headings[i+1]?.index ?? article.length)}}));
  if (!headings.length) content.push({title:"",body:{processed:article}});
  return parseBirminghamPayload({props:{pageProps:{nodeResource:{path:"/work/bidding-opportunities",title:"Bidding Opportunities",content}}}},now);
}
export async function fetchBirminghamBids(now = Date.now()): Promise<FetchResult> {
  try {
    const response = await fetch(BIRMINGHAM_URL,{signal: AbortSignal.timeout(30000)});
    if (!response.ok) fail(`HTTP ${response.status}`);
    const result = parseBirminghamHtml(await response.text(),now);
    console.log(`  ${SOURCE}: ${result.rows.length} active purchasing bids; skipped ${JSON.stringify(result.skipped)}`);
    return result;
  } catch (error) {
    if (error instanceof SourceUnreachableError) throw error;
    return fail(`request failed: ${(error as Error).name}`);
  }
}
