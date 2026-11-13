/**
 * Daily sweep of every OPEN federal solicitation on SAM.gov (owner 2026-11-13: "we need thousands").
 *
 * WHY: the sam_gov pass reads the 100 most recently modified notices plus the state-filtered pass, and
 * the nightly CSV keeps what it can date. A count on 2026-11-13 found 6,606 solicitations (notice types
 * `o` Solicitation and `k` Combined Synopsis/Solicitation) with a response date still ahead, of which
 * 4,719 were stored; about 1,900 were missing.
 *
 * HOW (measured 2026-11-13): SAM's public search honours `notice_type=o` / `notice_type=k` on their own
 * (6,535 and 16,670 active), but returns 0 when `state=` is added, so the sweep pages by type, 100 per
 * page, in both modified-date orders to get past the 10,000-row window (k has 16,670). Rows whose
 * response date has passed are dropped here. No per-notice detail request is made (6,600 of them would
 * be far too many): set-aside, NAICS and PSC stay as the regular passes stored them (the upsert never
 * erases them), and a new row gets its category from its own title and description.
 *
 * Polite: about 240 page requests, 700 ms apart, once a day (the 04:00 UTC sync), as ContraxBot.
 */
import { mapSamItem, type OpportunityDetail, type RawBid } from "./sam-gov";

const SEARCH = "https://sam.gov/api/prod/sgs/v1/search/";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
export const SAM_OPEN_PAGE_SIZE = 100;
/** SAM's search window: 10,000 rows per query. */
export const SAM_OPEN_MAX_PAGES = 100;
const DELAY_MS = 700;
const NO_DETAIL: OpportunityDetail = { setAside: null, naicsCode: null, psc: null, noticeType: null, solicitationNumber: null };

export const samOpenDeps = {
  fetch: (url: string, init: RequestInit) => fetch(url, init),
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

/** Runs on the first sync of the UTC day window (04:00-07:59), or when forced. PURE. */
export function samOpenSweepDue(nowMs: number, force = process.env.SAM_OPEN_SWEEP === "1"): boolean {
  const h = new Date(nowMs).getUTCHours();
  return force || (h >= 4 && h < 8);
}

export function samOpenUrl(noticeType: "o" | "k", page: number, sort: "-modifiedDate" | "modifiedDate"): string {
  return `${SEARCH}?page=${page}&size=${SAM_OPEN_PAGE_SIZE}&mode=opportunities&q=&is_active=true&notice_type=${noticeType}&sort=${sort}`;
}

/** Still open: a response date after `now`. PURE. */
export function isStillOpen(item: { responseDate?: string | null }, now: number): boolean {
  const t = Date.parse(String(item?.responseDate ?? ""));
  return Number.isFinite(t) && t > now;
}

export async function fetchOpenSamSolicitations(): Promise<RawBid[]> {
  const now = samOpenDeps.now();
  const items = new Map<string, any>();
  let pages = 0;
  async function sweep(type: "o" | "k", sort: "-modifiedDate" | "modifiedDate"): Promise<number> {
    let total = Infinity;
    for (let page = 0; page < SAM_OPEN_MAX_PAGES && page * SAM_OPEN_PAGE_SIZE < total; page++) {
      if (pages++) await samOpenDeps.sleep(DELAY_MS);
      const resp = await samOpenDeps.fetch(samOpenUrl(type, page, sort), { headers: { "User-Agent": UA, Accept: "application/hal+json" }, signal: AbortSignal.timeout(60_000) });
      if (resp.status === 403 || resp.status === 429) throw new Error(`SAM.gov open sweep refused (HTTP ${resp.status}); stopped`);
      if (!resp.ok) throw new Error(`SAM.gov open sweep HTTP ${resp.status} (${type} ${sort} page ${page})`);
      const data: any = await resp.json();
      total = Number(data?.page?.totalElements ?? 0);
      const rows: any[] = data?._embedded?.results ?? [];
      for (const it of rows) if (it?._id && isStillOpen(it, now)) items.set(String(it._id), it);
      if (rows.length < SAM_OPEN_PAGE_SIZE) break;
    }
    return total;
  }
  for (const type of ["o", "k"] as const) {
    // Newest-modified first; when a type holds more than SAM's 10,000-row window, read the
    // oldest-modified end as well so the whole set is covered.
    const total = await sweep(type, "-modifiedDate");
    if (total > SAM_OPEN_MAX_PAGES * SAM_OPEN_PAGE_SIZE) await sweep(type, "modifiedDate");
  }
  const out: RawBid[] = [];
  for (const it of items.values()) {
    try {
      out.push(await mapSamItem(it, { sourceLabel: "sam_gov", detailFetcher: async () => NO_DETAIL, detailDelay: false }));
    } catch {
      /* a malformed item is skipped, as in the other SAM passes */
    }
  }
  console.log(`  SAM.gov open sweep: ${out.length} open solicitations from ${pages} pages`);
  return out;
}
