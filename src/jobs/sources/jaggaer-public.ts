/**
 * Shared reader for JAGGAER (formerly SciQuest) public sourcing sites —
 * bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=<org>. Several
 * states and universities publish their open IFBs and RFPs on one of these
 * pages; each portal is a thin config (see mt-emacs.ts).
 *
 * SOURCE (verified live on Montana eMACS 2026-10-02, no login, no CAPTCHA):
 *   GET PublicEvent?CustomerOrg=<org>&tab=PHX_NAV_SourcingOpenForBid&PageSize=200
 * returns the "Open for Bid" tab, server-rendered, every event on one page
 * (the page prints "1-30 of 30 Results"; the parsed count must equal the
 * total, so a cut-off or layout change fails loudly). One table row per
 * event:
 *   - a status badge ("Open"),
 *   - the event title (a link into the bidder site),
 *   - a short description,
 *   - "Open" and "Close" date/times with their zone ("10/30/2026, 5:00 PM <b>MDT</b>"),
 *   - "Type" (IFB, RFP, LimtSol, …), "Number", the buyer contact, and a
 *     "View as PDF" link to …/Sourcingevent/<event id>-event.pdf.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = the event title; `solicitation_number` = "Number".
 *   - `agency` = the portal's buyer name from the config (the public list
 *     names no agency per event; the agency code stays in the number).
 *   - `location` = the config's state name.
 *   - `due_date` = "Close", in the zone the page prints.
 *   - `description` = the event's short description, its type and number
 *     (buyer contacts are not ingested).
 *   - `notice_type` = "Type"; `source_url` = the portal's public Open for Bid
 *     page (the per-event links carry short-lived tokens).
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Events not marked Open, or whose close time has passed, are skipped, and
 * sole source notices (type "SolSour", or "Sole Source" in the title) are
 * skipped as `not_biddable_type` (they announce a no-competition award).
 *
 * IDENTITY: `external_id = <idPrefix>-<event id>` (JAGGAER's event id).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export interface JaggaerConfig {
  /** Source label, e.g. "mt_emacs". */
  source: string;
  /** The CustomerOrg query value, e.g. "StateOfMontana". */
  customerOrg: string;
  /** external_id prefix, e.g. "mtemacs". */
  idPrefix: string;
  /** Bid location, e.g. "Montana". */
  stateName: string;
  /** Buyer shown as the agency, e.g. "State of Montana". */
  buyerName: string;
  /** Portal name for descriptions, e.g. "Montana eMACS". */
  portalName: string;
}

export interface JaggaerEvent {
  id: string;
  status: string;
  title: string;
  summary: string;
  close: string; // "10/30/2026, 5:00 PM MDT"
  type: string;
  number: string;
}

export interface JaggaerParseResult {
  rows: RawBid[];
  events: JaggaerEvent[];
  total: number | null;
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const MAX_DESCRIPTION = 1500;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** Sole source notices ("SolSour", "Intent to Sole Source …") announce a no-competition award. */
const SOLE_SOURCE_RE = /\bSolSour\b|sole\s*source/i;

/** UTC offsets (hours) of the zone abbreviations JAGGAER prints. */
const ZONE_OFFSETS: Record<string, number> = {
  EDT: -4, EST: -5, CDT: -5, CST: -6, MDT: -6, MST: -7, PDT: -7, PST: -8, AKDT: -8, AKST: -9, HST: -10,
};

export function jaggaerListUrl(cfg: JaggaerConfig): string {
  return `https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=${encodeURIComponent(cfg.customerOrg)}&tab=PHX_NAV_SourcingOpenForBid`;
}

function decode(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** "10/30/2026, 5:00 PM MDT" → ISO. Unknown zone or invalid → null. */
export function jaggaerDateToIso(text: string): string | null {
  const m = decode(text).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})\s*([AP]M)\s+([A-Z]{2,4})$/i);
  if (!m) return null;
  const offset = ZONE_OFFSETS[m[7]!.toUpperCase()];
  if (offset === undefined) return null;
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 1 || hour > 12 || minute > 59) return null;
  if (m[6]!.toUpperCase() === "PM" && hour !== 12) hour += 12;
  if (m[6]!.toUpperCase() === "AM" && hour === 12) hour = 0;
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offset * 3_600_000).toISOString();
}

function labelled(block: string, label: string): string {
  const re = new RegExp(`phxText">${label}</div></div></div><div class="phx table-cell-layout"><div class="phx data-row-content">([\\s\\S]*?)</div></div></div>`, "i");
  const m = block.match(re);
  return m ? decode(m[1]!) : "";
}

/** The events on an Open for Bid page, and the page's "of N Results" total. */
export function readJaggaerEvents(html: string): { events: JaggaerEvent[]; total: number | null } {
  const events: JaggaerEvent[] = [];
  // Rows start with the status badge cell (the first row's cell has no class).
  for (const tr of html.matchAll(/<tr>\s*<td[^>]*>\s*<span class="[^"]*status-badge[\s\S]*?<\/tr>/gi)) {
    const block = tr[0];
    const id = block.match(/Sourcingevent\/(\d+)-event\.pdf/i)?.[1];
    if (!id) continue;
    events.push({
      id,
      status: decode(block.match(/status-badge[^"]*">([\s\S]*?)<\/span>/i)?.[1] ?? ""),
      title: decode(block.match(/btn-link-header"[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? ""),
      summary: decode(block.match(/class="phx display-block phxText label-mini">([\s\S]*?)<\/div>/i)?.[1] ?? ""),
      close: labelled(block, "Close"),
      type: labelled(block, "Type"),
      number: labelled(block, "Number"),
    });
  }
  const total = decode(html).match(/\d+\s*-\s*\d+\s+of\s+(\d+)\s+Results/i);
  return { events, total: total ? Number(total[1]) : null };
}

function recordSkip(result: JaggaerParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseJaggaerPage(cfg: JaggaerConfig, html: string, now: number = Date.now()): JaggaerParseResult {
  const { events, total } = readJaggaerEvents(html);
  const result: JaggaerParseResult = { rows: [], events, total, skipped: {}, skippedRows: [] };
  for (const e of events) {
    const rowId = `${cfg.idPrefix}-${e.id}`;
    if (!e.title) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    if (!/^open$/i.test(e.status)) {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    if (SOLE_SOURCE_RE.test(e.type) || SOLE_SOURCE_RE.test(e.title)) {
      recordSkip(result, rowId, "not_biddable_type");
      continue;
    }
    const due = jaggaerDateToIso(e.close);
    if (!due) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    let summary = e.summary.replace(EMAIL_RE, "(email on the event page)");
    if (summary.length > MAX_DESCRIPTION) summary = `${summary.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`;
    const description = [
      summary,
      `${e.type || "Solicitation"}${e.number ? ` ${e.number}` : ""} on ${cfg.portalName}.`,
      "The event document and response instructions are on the portal (see source link).",
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title: e.title,
      agency: cfg.buyerName,
      description,
      location: cfg.stateName,
      category: mapCategory("", e.title, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: jaggaerListUrl(cfg),
      set_aside: null,
      notice_type: e.type || "Solicitation",
      solicitation_number: e.number || e.id,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

/** Fetch one portal's Open for Bid page and return ingest rows. */
export async function fetchJaggaerBids(cfg: JaggaerConfig, now: number = Date.now()): Promise<FetchResult> {
  const url = `${jaggaerListUrl(cfg)}&PageSize=200`;
  const fail = (detail: string): never => {
    console.error(`  ${cfg.source}: ${detail}`);
    throw new SourceUnreachableError(cfg.source, [detail]);
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let html = "";
  try {
    const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: controller.signal });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, url));
    html = await resp.text();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  const r = parseJaggaerPage(cfg, html, now);
  if (r.total === null) fail(`page shape changed: no "of N Results" total (${html.length} bytes)`);
  if (r.events.length !== r.total) fail(`page shape changed: ${r.total} results listed, ${r.events.length} parsed`);
  console.log(
    `  ${cfg.source}: ${r.rows.length} open events accepted (listed: ${r.events.length}; skips: ${
      Object.entries(r.skipped)
        .map(([k, n]) => `${k}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows: r.rows, skipped: r.skipped, skippedRows: r.skippedRows };
}
