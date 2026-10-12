/** County of San Diego BuyNet public solicitations. City PlanetBids is separate.
 * Verified public list 2026-10-12; no login. Read Open records only, deduplicate
 * lots by BPM code, and use the portal countdown epoch for DST-safe deadlines.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import type { RawBid } from "./sam-gov";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import { azFormFields, azRowIds, decodeHtml } from "./az-app";
export const CA_SAN_DIEGO_COUNTY_SOURCE = "ca_san_diego_county";
const HOST = "https://sdbuynet.sandiegocounty.gov";
export const CA_SAN_DIEGO_COUNTY_LIST_URL = `${HOST}/page.aspx/en/rfp/request_browse_public`;
const UA = "Contrax/1.0 (+https://www.contrax.company)";
const MAX_PAGES = 40;
const PAGE_DELAY_MS = 500;
const text = (s: string) => decodeHtml(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
export function parseSanDiegoCountyPages(pages: string[], now = Date.now()) {
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  const seen = new Set<string>();
  const skip = (id: string, reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; skippedRows.push({ id, reason }); };
  for (const page of pages) for (const m of page.matchAll(/<tr id="body_x_grid_grd_tr_(\d+)"[^>]*>(.*?)<\/tr>/gs)) {
    const cells = [...m[2].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(c => c[1]);
    const code = text(cells[1] ?? "");
    const id = `sd-buynet:${code || m[1]}`;
    const title = text(cells[2] ?? "");
    if (cells.length < 16 || !/^BPM\d+$/.test(code) || !title) { skip(id, "missing_fields"); continue; }
    if (text(cells[10]) !== "Open") { skip(id, "not_open"); continue; }
    const epoch = /rfp-end-date=['"](\d+)['"]/.exec(cells[9]);
    const due = epoch ? Number(epoch[1]) : NaN;
    if (!Number.isFinite(due)) { skip(id, "bad_date"); continue; }
    if (due <= now) { skip(id, "closed"); continue; }
    if (seen.has(code)) { skip(id, "duplicate_lot"); continue; }
    seen.add(code);
    const commodity = text(cells[5]);
    const description = `County of San Diego solicitation ${code}. Commodity: ${commodity}. Respond through BuyNet; review all lots and documents at the source link.`;
    rows.push({ external_id: id, title, agency: "County of San Diego", description,
      location: "San Diego County, CA", category: mapCategory("", title, commodity),
      due_date: new Date(due).toISOString(), estimated_value: "Not specified",
      source_url: `${HOST}/page.aspx/en/bpm/process_manage_extranet/${m[1]}`,
      solicitation_number: code, set_aside: null, notice_type: null, naics_code: null, psc: null });
  }
  return { rows, skipped, skippedRows };
}
function fail(detail: string): never {
  console.error(`  ${CA_SAN_DIEGO_COUNTY_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(CA_SAN_DIEGO_COUNTY_SOURCE, [detail]);
}

/** Fetch every "Open for Bidding" page and return ingest rows. */
export async function fetchCaSanDiegoCountyBids(now: number = Date.now()): Promise<FetchResult> {
  const cookies = new Map<string, string>();
  const request = async (body?: URLSearchParams): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const headers: Record<string, string> = { "User-Agent": UA, Accept: "text/html" };
      if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
      if (body) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        headers.Referer = CA_SAN_DIEGO_COUNTY_LIST_URL;
      }
      const resp = await fetch(body ? `${CA_SAN_DIEGO_COUNTY_LIST_URL}?` : CA_SAN_DIEGO_COUNTY_LIST_URL, {
        method: body ? "POST" : "GET",
        headers,
        body: body?.toString(),
        redirect: "manual",
        signal: controller.signal,
      });
      const setCookies: string[] =
        typeof (resp.headers as any).getSetCookie === "function" ? (resp.headers as any).getSetCookie() : [];
      for (const c of setCookies) {
        const [pair] = c.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
      if (resp.status !== 200) fail(httpFailureDetail(resp.status, CA_SAN_DIEGO_COUNTY_LIST_URL));
      return await resp.text();
    } catch (e) {
      if (e instanceof SourceUnreachableError) throw e;
      fail(requestFailureDetail(e));
    } finally {
      clearTimeout(timer);
    }
  };

  const first = await request();
  if (!first.includes('<form method="post"')) fail("list page shape changed: no form");
  const filter = azFormFields(first).filter(([k]) => k !== "body:x:selRfxStatus");
  filter.push(["body:x:selRfxStatus", "val"], ["body:x:prxFilterBar:x:cmdSearchBtn", ""], ["__EVENTTARGET", ""], ["__EVENTARGUMENT", ""]);
  let page = await request(new URLSearchParams(filter));
  const pages = [page];
  const ids = new Set(azRowIds(page));
  if (ids.size === 0) fail("no rows on the filtered list (page shape changed?)");
  for (let p = 1; p < MAX_PAGES; p++) {
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    const fields = azFormFields(page);
    fields.push(["__EVENTTARGET", "body_x_grid_grd"], ["__EVENTARGUMENT", `Page|${p}`]);
    page = await request(new URLSearchParams(fields));
    const fresh = azRowIds(page).filter((id) => !ids.has(id));
    if (fresh.length === 0) break;
    fresh.forEach((id) => ids.add(id));
    pages.push(page);
  }
  const { rows, skipped, skippedRows } = parseSanDiegoCountyPages(pages, now);
  console.log(
    `  ${CA_SAN_DIEGO_COUNTY_SOURCE}: ${rows.length} open solicitations accepted (listed: ${ids.size} on ${pages.length} page(s); skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
