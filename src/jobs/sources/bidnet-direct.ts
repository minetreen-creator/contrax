/**
 * BidNet Direct — shared reader for the public, login-free "open bids" lists of
 * BidNet's state *Purchasing Groups* (the third-party aggregator behind
 * `sd_bidnet` and `nh_bidnet`).
 *
 * WHY THIS MODULE EXISTS: BidNet Direct (International Data Base Corp.,
 * bidnetdirect.com — not a .gov host) runs one "open bids" list per purchasing
 * group at `/{state-slug}/solicitations/open-bids`. Every group's list is the
 * SAME server-rendered "mets" markup, paginates by URL the same way and exposes
 * the same cells, so the reader is one engine configured per group rather than a
 * copy per state. `sd-bidnet.ts` and `nh-bidnet.ts` are the two configs.
 *
 * SOURCE (no login, no CAPTCHA, no JavaScript, no cookies, no POST):
 *   GET https://www.bidnetdirect.com/{slug}/solicitations/open-bids
 * is server-rendered HTML. Its heading states the total ("N Open Solicitations")
 * and it paginates as `.../open-bids/page<N>`, 25 rows per page, discovered from
 * the page's own `#pagination_select_g_*` options (`data-page-number` +
 * `data-href`) — a plain GET, NOT a PrimeFaces POST like the Periscope *buyer*
 * boards in `periscope-bso.ts`. Each row is
 *   <tr data-index="N" class="mets-table-row odd|even"> …
 *     <a class="solicitation-link" href="/public/supplier/solicitations/
 *        statewide/<id>/abstract?purchasingGroupId=…&origin=1">TITLE</a>
 *     <span class="sol-region-item">STATE</span>
 *     <span class="sol-publication-date">… <span class="date-value">MM/DD/YYYY
 *     <span class="sol-closing-date open">… <span class="date-value">MM/DD/YYYY
 *
 * HONESTY (binding — this is a THIRD-PARTY AGGREGATOR, not an official portal):
 *   - BidNet Direct is a private bid-notification service on which agencies
 *     SELF-POST. Neither the badge nor any row claims the state operates it.
 *   - ONLY the public, no-login pages are read: the open-bids list and its own
 *     pagination pages. No POST, no cookie, no session, no auth bypass, and NO
 *     page behind the vendor registration wall is touched.
 *   - The list publishes: title, region, published date and closing date. The
 *     public detail ("abstract") page additionally prints the exact closing time
 *     in EASTERN time but LOCKS the Issuing Organization, Solicitation Number,
 *     Description and Source cells behind "Registered members only". Locked data
 *     is NOT read, guessed or scraped — `solicitation_number` stays NULL and the
 *     description says why.
 *   - Dates come from the source's own text only. The LIST prints no closing
 *     time, so the date is stored at 11:59 PM Eastern on that closing day
 *     (BidNet renders its deadlines in Eastern time). End-of-day is deliberately
 *     the LATE bound: a row can never read as closed while the source still lists
 *     it as open.
 *   - `category` is Contrax's OWN trade classification of the TITLE (BidNet's
 *     list publishes no category) and is never presented as the source's own.
 *
 * WHAT A ROW BECOMES (never manufacture, relabel or loosen):
 *   - `title`       = the listing's title, verbatim.
 *   - `agency`      = "<Group Name> (BidNet Direct)" — the only buyer-side fact
 *                     the public page supports. The issuing organization is a
 *                     members-only cell, so it is NOT invented.
 *   - `location`    = the row's own region text, or the group's state when the
 *                     row printed none.
 *   - `due_date`    = the closing date at 11:59 PM Eastern (see above).
 *   - `source_url`  = the row's own public detail page, absolutized.
 *   - `solicitation_number` / `naics_code` / `psc` / `set_aside` = NULL;
 *     `estimated_value` = "Not specified" (the public list publishes no value).
 * Skipped: the row's closing cell is not the list's `open` state (`not_open`),
 * the closing date has passed (`closed`), no readable closing date (`bad_date`),
 * no detail id or title (`missing_id` / `missing_title`), the same solicitation
 * twice in one read (`duplicate`).
 *
 * IDENTITY: `external_id = <prefix>-<BidNet's own solicitation id>` — the numeric
 * id in the row's detail URL (e.g. `sdbidnet-2719424597`). Never positional, so a
 * re-read can never write a second row and a reordering cannot repoint one.
 * Two groups are separate sources with separate prefixes: when one publisher's
 * solicitation also appears on another surface they are two publishers' listings
 * of the same work and are stored as two rows, exactly as `va_eva` and the
 * locality boards coexist.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import {
  httpFailureDetail,
  requestFailureDetail,
  SourceUnreachableError,
} from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const BIDNET_ORIGIN = "https://www.bidnetdirect.com";
/** Hard cap on pages read in one pass (bounds a pathological/looping page). */
export const BIDNET_MAX_PAGES = 20;
/** Politeness delay between pagination reads. */
export const BIDNET_PAGE_DELAY_MS = 300;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** Everything that differs between two BidNet purchasing groups. */
export interface BidNetGroupConfig {
  /** Contrax source name, e.g. `sd_bidnet`. */
  source: string;
  /** `external_id` prefix, e.g. `sdbidnet`. */
  idPrefix: string;
  /** BidNet's URL slug for the state, e.g. `south-dakota`. */
  slug: string;
  /** The state exactly as the source prints it, e.g. `South Dakota`. */
  stateName: string;
  /** BidNet's own name for the group, e.g. `South Dakota Purchasing Group`. */
  groupName: string;
  /** Max list pages read in one pass (default `BIDNET_MAX_PAGES`). */
  maxPages?: number;
  /** Politeness delay between pagination reads (default `BIDNET_PAGE_DELAY_MS`). */
  pageDelayMs?: number;
}

/** One solicitation row of the list page, exactly as the page prints it. */
export interface BidNetRow {
  /** BidNet's own numeric solicitation id, from the detail URL. */
  id: string;
  title: string;
  /** The row's own region text (`sol-region-item`). */
  region: string;
  /** MM/DD/YYYY as printed in `sol-publication-date`. */
  published: string;
  /** MM/DD/YYYY as printed in `sol-closing-date`. */
  closing: string;
  /** The state class the page puts on the closing cell (`open` on this list). */
  closingState: string;
  /** Absolute public detail URL (the row's own `solicitation-link`). */
  url: string;
}

export interface BidNetParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

/** What Contrax reports about the members-only cells — kept in every row. */
export const BIDNET_LOCKED_NOTE =
  "BidNet shows the issuing organization, solicitation number, description and source to registered members only, so Contrax reports none of them.";

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&ndash;/g, "\u2013")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the page still has the shape the parser needs: the solicitations
 * table plus its own "N Open Solicitations" heading. A reshape FAILS the fetch;
 * the shape present with ZERO rows is honest-empty (a quiet group), not a break.
 */
export function bidNetListShapeOk(html: string): boolean {
  return (
    /class="sol-table mets-table/.test(html) && /Open Solicitations/.test(html)
  );
}

/**
 * The total the page's own heading claims ("44 Open Solicitations"), or null.
 * The heading groups thousands with a comma on a large group ("1,176 Open
 * Solicitations" — the Virginia & DC group), so the comma form is read as one
 * number; without it the count would silently read as the last three digits.
 */
export function bidNetStatedOpenCount(html: string): number | null {
  const flat = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  const m = /([\d,]+)\s*Open Solicitations/.exec(flat);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** Absolute URL for a link the page itself printed. */
export function bidNetAbsoluteUrl(href: string): string {
  return new URL(href, BIDNET_ORIGIN).toString();
}

/**
 * The pagination pages the page itself advertises, from its own page selector
 * (`<option class="mets-pagination-number" value="2" data-page-number="2"
 * data-href="/south-dakota/solicitations/open-bids/page2">`). Includes the
 * current page; the caller decides which to read next.
 */
export function parseBidNetPageLinks(
  html: string,
): { pageNumber: number; href: string }[] {
  const out: { pageNumber: number; href: string }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(
    /<option\b[^>]*data-page-number="(\d+)"[^>]*data-href="([^"]+)"/g,
  )) {
    const href = bidNetAbsoluteUrl(m[2]);
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ pageNumber: Number(m[1]), href });
  }
  // Fallback: the "Next" control, if the selector ever disappears.
  for (const m of html.matchAll(/<link\b[^>]*rel="next"[^>]*href="([^"]+)"/g)) {
    const href = bidNetAbsoluteUrl(m[1]);
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ pageNumber: out.length + 1, href });
  }
  return out;
}

/** BidNet's own solicitation id from a detail URL, or null. */
export function bidNetDetailId(href: string): string | null {
  const m = /\/public\/supplier\/solicitations\/[a-z-]+\/(\d+)\/abstract/.exec(
    href,
  );
  return m ? m[1] : null;
}

/**
 * The solicitation rows of one list page, in the page's own order. Reads the
 * rows only (`<tr data-index=…>`), never the table's header, empty-state or
 * hidden-template rows.
 */
export function parseBidNetRows(html: string): BidNetRow[] {
  const out: BidNetRow[] = [];
  for (const m of html.matchAll(/<tr\s+data-index="\d+"[\s\S]*?<\/tr>/g)) {
    const row = m[0];
    const aTag = /<a\b[^>]*class="[^"]*solicitation-link[^"]*"[^>]*>/.exec(row);
    if (!aTag) continue;
    const href = /href="([^"]+)"/.exec(aTag[0])?.[1];
    if (!href) continue;
    const body = row.slice(aTag.index + aTag[0].length);
    const title = decode(body.slice(0, body.search(/<\/a>/)));
    const at = row.indexOf('class="sol-closing-date');
    const head = at >= 0 ? row.slice(0, at) : row;
    const tail = at >= 0 ? row.slice(at) : "";
    const region = decode(
      /class="sol-region-item"[^>]*>([\s\S]*?)<\/span>/.exec(row)?.[1] ?? "",
    );
    const published =
      /class="sol-publication-date"[\s\S]*?<span class="date-value">([^<]*)<\/span>/
        .exec(head)?.[1]
        ?.trim() ?? "";
    // The state token the page puts on the closing cell ("open" on this list) —
    // read as ONE token so an added sibling class cannot be folded into it.
    const closingState =
      /class="sol-closing-date\s+([A-Za-z0-9_-]+)/.exec(tail)?.[1] ?? "";
    const closing =
      /<span class="date-value">([^<]*)<\/span>/.exec(tail)?.[1]?.trim() ?? "";
    out.push({
      id: bidNetDetailId(href) ?? "",
      title,
      region,
      published,
      closing,
      closingState,
      url: bidNetAbsoluteUrl(href),
    });
  }
  return out;
}

/** "MM/DD/YYYY" → 11:59 PM Eastern that day (EDT/EST by US rules), or NaN. */
export function bidNetDueMs(closing: string): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(closing.trim());
  if (!m) return NaN;
  const [y, mo, d] = [+m[3], +m[1], +m[2]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return NaN;
  // US DST (Eastern): second Sunday of March → first Sunday of November.
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + 7 * (n - 1);
  };
  const dstStart = Date.UTC(y, 2, nthSunday(3, 2));
  const dstEnd = Date.UTC(y, 10, nthSunday(11, 1));
  const day = Date.UTC(y, mo - 1, d);
  const offsetHours = day >= dstStart && day < dstEnd ? 4 : 5;
  return Date.UTC(y, mo - 1, d, 23 + offsetHours, 59);
}

/** "10/26/2026" → "2026-10-26" (the date as BidNet prints it). */
export function bidNetDateKey(closing: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(closing.trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

function recordSkip(result: BidNetParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/**
 * PURE parse of the list rows for one group — no network, no DB; `now` is
 * injected. Exported standalone (and re-exported per group) so a test can parse
 * captured bytes without constructing the whole group.
 */
export function parseBidNetRowsFor(
  cfg: BidNetGroupConfig,
  rows: readonly BidNetRow[],
  now: number = Date.now(),
): BidNetParseResult {
  const result: BidNetParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const r of rows) {
    const dateKey = bidNetDateKey(r.closing);
    const dueMs = bidNetDueMs(r.closing);
    const rowId = r.id ? `${cfg.idPrefix}-${r.id}` : "";
    if (!r.id) {
      recordSkip(result, r.title || "(no id)", "missing_id");
      continue;
    }
    if (!r.title) {
      recordSkip(result, rowId, "missing_title");
      continue;
    }
    if (r.closingState !== "open") {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    if (!dateKey || !Number.isFinite(dueMs)) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (seen.has(rowId)) {
      recordSkip(result, rowId, "duplicate");
      continue;
    }
    seen.add(rowId);
    if (dueMs < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const region = r.region || cfg.stateName;
    const description = [
      `Listed by BidNet Direct (bidnetdirect.com), a private third-party bid service — not the State of ${cfg.stateName}'s procurement portal — in its ${cfg.groupName}.`,
      `Published ${r.published || "(not printed)"}; closing ${r.closing}.`,
      "BidNet's public list prints the closing DATE only, so Contrax stores the deadline at 11:59 PM Eastern on that date (BidNet prints its deadlines in Eastern time).",
      BIDNET_LOCKED_NOTE,
    ].join(" ");
    result.rows.push({
      external_id: rowId,
      title: r.title,
      agency: `${cfg.groupName} (BidNet Direct)`,
      description,
      location: region,
      // Contrax's own trade classification of the TITLE (the list publishes none).
      category: mapCategory("", r.title, ""),
      due_date: new Date(dueMs).toISOString(),
      estimated_value: "Not specified",
      source_url: r.url,
      set_aside: null,
      notice_type: "Open solicitation",
      solicitation_number: null,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

export interface BidNetGroup {
  readonly source: string;
  readonly idPrefix: string;
  readonly origin: string;
  readonly listUrl: string;
  readonly agency: string;
  readonly maxPages: number;
  /** The list URL plus its own page-2..N URLs, absolutized. */
  readonly listShapeOk: (html: string) => boolean;
  readonly statedOpenCount: (html: string) => number | null;
  readonly absoluteUrl: (href: string) => string;
  readonly parsePageLinks: (
    html: string,
  ) => { pageNumber: number; href: string }[];
  readonly detailId: (href: string) => string | null;
  readonly parseRows: (html: string) => BidNetRow[];
  readonly dueMs: (closing: string) => number;
  readonly dateKey: (closing: string) => string | null;
  readonly parse: (
    rows: readonly BidNetRow[],
    now?: number,
  ) => BidNetParseResult;
  readonly fetchBids: (now?: number) => Promise<FetchResult>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Build the reader for one BidNet purchasing group. Every URL is derived from the
 * group's own slug, so a new state is a config object — no new parser.
 */
export function createBidNetGroup(cfg: BidNetGroupConfig): BidNetGroup {
  const listUrl = `${BIDNET_ORIGIN}/${cfg.slug}/solicitations/open-bids`;
  const maxPages = cfg.maxPages ?? BIDNET_MAX_PAGES;
  const pageDelayMs = cfg.pageDelayMs ?? BIDNET_PAGE_DELAY_MS;

  async function getHtml(url: string, signal: AbortSignal): Promise<string> {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        Referer: listUrl,
      },
      signal,
    });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, url));
    return await resp.text();
  }

  function fail(detail: string): never {
    console.error(`  ${cfg.source}: ${detail}`);
    throw new SourceUnreachableError(cfg.source, [detail]);
  }

  /**
   * Read this group's public open-bids list, following its own pagination, and
   * return one bid per solicitation. ZERO rows is honest-empty (0 rows), never a
   * failure; a page that lost its shape, or a heading that claims solicitations
   * the rows did not deliver, FAILS instead of reading as empty.
   */
  async function fetchBids(now: number = Date.now()): Promise<FetchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    const pages: string[] = [];
    let stated: number | null = null;
    try {
      const first = await getHtml(listUrl, controller.signal);
      if (!bidNetListShapeOk(first)) {
        fail(
          `page shape changed: BidNet's ${cfg.stateName} open-bids list no longer has its table/heading`,
        );
      }
      pages.push(first);
      stated = bidNetStatedOpenCount(first);
      const seen = new Set<string>([listUrl]);
      const queue = parseBidNetPageLinks(first)
        .filter((l) => l.pageNumber > 1)
        .map((l) => l.href)
        .filter((href) => !seen.has(href));
      while (queue.length > 0 && pages.length < maxPages) {
        const href = queue.shift()!;
        if (seen.has(href)) continue;
        seen.add(href);
        await sleep(pageDelayMs);
        const html = await getHtml(href, controller.signal);
        if (!bidNetListShapeOk(html))
          fail(
            `page shape changed: BidNet list page ${href} has no solicitations table`,
          );
        pages.push(html);
        for (const l of parseBidNetPageLinks(html)) {
          if (l.pageNumber > 1 && !seen.has(l.href) && !queue.includes(l.href))
            queue.push(l.href);
        }
      }
    } catch (e) {
      if (e instanceof SourceUnreachableError) throw e;
      fail(requestFailureDetail(e));
    } finally {
      clearTimeout(timer);
    }
    const listed = pages.flatMap((h) => parseBidNetRows(h));
    if (stated !== null && stated > 0) {
      if (listed.length === 0)
        fail(`the list claims ${stated} open solicitations but no row parsed`);
      if (!listed.some((r) => r.closingState === "open")) {
        fail(
          "the list has rows but none carries the open closing state (BidNet reshaped its rows)",
        );
      }
    }
    const { rows, skipped, skippedRows } = parseBidNetRowsFor(cfg, listed, now);
    console.log(
      `  ${cfg.source}: ${rows.length} open solicitations accepted (pages: ${pages.length}; stated: ${
        stated ?? "n/a"
      }; listed: ${listed.length}; skips: ${
        Object.entries(skipped)
          .map(([r, n]) => `${r}=${n}`)
          .join(", ") || "none"
      })`,
    );
    return { rows, skipped, skippedRows };
  }

  return {
    source: cfg.source,
    idPrefix: cfg.idPrefix,
    origin: BIDNET_ORIGIN,
    listUrl,
    agency: `${cfg.groupName} (BidNet Direct)`,
    maxPages,
    listShapeOk: bidNetListShapeOk,
    statedOpenCount: bidNetStatedOpenCount,
    absoluteUrl: bidNetAbsoluteUrl,
    parsePageLinks: parseBidNetPageLinks,
    detailId: bidNetDetailId,
    parseRows: parseBidNetRows,
    dueMs: bidNetDueMs,
    dateKey: bidNetDateKey,
    parse: (rows, now) => parseBidNetRowsFor(cfg, rows, now),
    fetchBids,
  };
}
