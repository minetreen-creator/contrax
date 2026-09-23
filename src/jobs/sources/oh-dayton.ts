/**
 * City of Dayton bid board — CivicEngage / CivicPlus (Ohio Phase 3, plan rev 285
 * owner-locked order step ②; connector spec: shared/ohio-phase3-prep-2026-09-23/
 * OH_DAYTON_CONNECTOR_SPEC.md).
 *
 * SOURCE: https://www.daytonohio.gov/bids.aspx — the City of Dayton's OWN bid
 * board, i.e. the first non-federal OHIO-local bid source in the corpus. It is
 * server-rendered ASP.NET with no auth, no CAPTCHA, no JS requirement and NO DOM
 * dependency needed: the bid list is plain HTML read here with STRING ANCHORS +
 * regex (the house style — there is no HTML parser in the ingest path).
 *
 * WHAT THE CONNECTOR READS (spec §2/§3):
 *   - the bare URL only, `GET /bids.aspx`. Query-param variants are NOT used:
 *     `?showAllBids=true&Status=all` returns HTTP 200 with the item container
 *     absent (an EMPTY list, not an error) — silently wrong, so never request it.
 *   - the region between `<div class="bidItems listItems">` and the closing
 *     `function submitBidForm` script; if either anchor is missing the page has
 *     been restructured → ingest ZERO rows + a loud log (never a partial guess).
 *   - per row: first `bids.aspx?bidID=<digits>` href, the `div.bidTitle` first
 *     anchor text (title), the optional `<strong>Bid No.</strong>` line, the last
 *     non-title/non-Bid-No `<span>` text (description), the enclosing group header
 *     first `<span>` (category), and the `div.bidStatus` VALUES — which live in the
 *     SECOND child div (`Status:`/`Closes:` labels are the first, so a naive
 *     "span after the label" read returns the label itself).
 *   - NO pagination exists; the whole open board renders on one page. NO detail
 *     fetches (v1) — `source_url` links the user to the authoritative page.
 *
 * DATA HONESTY (owner rules — never manufacture, relabel, or loosen):
 *   - `location` is the literal "Dayton, OH": the City publishes this board, so
 *     every row it carries is a Dayton solicitation. No state is inferred or
 *     borrowed, and no row is relabelled nationwide.
 *   - `agency` is "City of Dayton" — the page's own publisher. The list exposes no
 *     per-row buyer field, so no department hierarchy is invented.
 *   - `category` comes from the SHARED trade classifier over the row's own
 *     title+description (same purchased-service-only rule as every other source);
 *     the CivicEngage group header is used for the structural cross-check below,
 *     never as a trade stamp.
 *   - `set_aside` is set ONLY when the source text literally states a program;
 *     otherwise NULL (the non-federal-source rule in cert-matching.ts then makes a
 *     NULL set-aside small-business pursuable — no generic label is stamped).
 *   - `due_date` = shared `toIsoDueDate` (src/lib/date.ts) — "parse or NULL",
 *     NEVER a sentinel lookup table: the list writes "Upon Contract" and the
 *     detail page writes "Open Until Contracted" for the SAME open-ended state,
 *     so a string→date map would rot. A NULL due_date row is still emitted.
 *   - `naics_code` / `psc` / `notice_type` / `solicitation_number` stay NULL: this
 *     source exposes none. (`naics_code_source='inferred'` provenance then applies
 *     from the standard pipeline, exactly as for pennbid.)
 *
 * TIMEZONE (spec R17, option (a) — documented, deliberate): Dayton publishes
 * wall-clock local times with no zone suffix ("10/6/2026 10:00 AM", with
 * "(Dayton Local Time)" written in the row description). `toIsoDueDate` reads
 * that as the RUNTIME's local time, so under the sync environment (UTC) a
 * 10:00 AM Dayton closing is stored as 10:00Z — up to 4 h off the true EDT/EST
 * instant. This matches every other source (pennbid.ts has the identical latent
 * pattern) and is accepted for closing-soon boundary ordering only; option (b)
 * — a per-source DST-aware conversion — was rejected because it would make this
 * one source disagree with the corpus for no user-visible gain. Non-date
 * sentinels still become NULL, never a guessed instant.
 *
 * AMENDMENTS stay separate: this board has no amendment notice type, and
 * `external_id = dayton-<bidID>` means a re-issued/edited bid REFRESHES its row
 * (upsert key (source, external_id)); a genuinely separate notice carries a new
 * bidID. Nothing is collapsed.
 */
import { isJanitorialWork, isTransportationWork } from "~/lib/trade-classification";
import { toIsoDueDate } from "~/lib/date";
import type { FetchResult } from "../runner";
import { stripHtml, type RawBid } from "./sam-gov";

export const DAYTON_ENDPOINT = "https://www.daytonohio.gov/bids.aspx";
/** The page's own publisher identity — never a fabricated department hierarchy. */
export const DAYTON_AGENCY = "City of Dayton";
/** City-level place, provable by construction (the City publishes this board). */
export const DAYTON_LOCATION = "Dayton, OH";

/**
 * Sent exactly like the probe that captured the fixtures: a browser-like UA and
 * an HTML Accept. `cache-control: private, s-maxage=600` upstream → honour
 * politeness with ONE GET per sync (no pagination to walk, no detail fetches).
 */
export const DAYTON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
} as const;

/** Item-region anchors (spec §2.1 / §3.2 step 4). */
const ITEMS_ANCHOR = '<div class="bidItems listItems">';
const REGION_END_ANCHOR = "function submitBidForm";
/** Split into group headers + rows WITHOUT DOM nesting: the two block anchors. */
const BLOCK_SPLIT = /(?=<div class="(?:bidsHeader listHeader|listItemsRow bid))/;

/** One row exactly as the board presents it (pre-guard, for tests/diagnostics). */
export interface DaytonBoardRow {
  bidID: string;
  /** The enclosing CivicEngage group header text (e.g. "Procurement"). */
  group: string;
  groupCountText: string | null;
  /** The optional "Bid No." line; `null` when the row does not carry one. */
  bidNo: string | null;
  title: string;
  description: string;
  status: string;
  /** Verbatim `Closes:` value — a date string OR a non-date sentinel. */
  closes: string;
  sourceUrl: string;
}

export interface DaytonParseResult {
  /** Post-guard rows, ready to ingest. */
  rows: RawBid[];
  /** Every row the anchors yielded BEFORE the open/closed guards (diagnostics). */
  parsed: DaytonBoardRow[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

/**
 * Text decode for the board's HTML fragments: tag-strip + entity decode via the
 * shared `stripHtml`, with the one entity it does not cover (`&nbsp;`, used by
 * the source's "Read on" affordance) normalized first. Whitespace is collapsed.
 */
function decodeText(raw: string | null | undefined): string {
  return stripHtml(String(raw ?? "").replace(/&nbsp;/g, " ").replace(/&#160;/g, " "));
}

/** Record one deliberate pre-insert guard drop (reason-coded skip). */
function recordSkip(
  skipped: Record<string, number>,
  skippedRows: { id: string; reason: string }[],
  id: string,
  reason: string,
) {
  skipped[reason] = (skipped[reason] ?? 0) + 1;
  skippedRows.push({ id, reason });
}

/**
 * Category stamp — the SHARED classifier's trade decision (src/lib/
 * trade-classification.ts), copied from the pennBid pattern so this source cannot
 * grow its own bare `/(clean|truck)/` branch (the false-positive amplifier removed
 * in the janitorial PR): a purchased SERVICE is Janitorial/Transportation only
 * when the shared rule says so, and the product veto keeps e.g. a liner/supply
 * purchase out of a service trade. Exported so it is unit-testable with zero
 * network (house convention).
 */
export function daytonCategory(title: string, description = ""): string {
  const titleLc = (title || "").toLowerCase();
  const full = `${titleLc} ${(description || "").toLowerCase()}`.trim();
  if (isTransportationWork(titleLc, full)) return "Transportation";
  if (isJanitorialWork(titleLc, full)) return "Janitorial";
  if (/(construct|renovat|demolit|pav|road|bridge)/.test(full)) return "Construction";
  if (/(supply|materiel|material|equipment)/.test(full)) return "Supplies & Equipment";
  return "Other";
}

/**
 * Set-aside program stated LITERALLY in the row's own text (spec §3.4). The board
 * publishes no set-aside field, and today's rows carry no such language at all —
 * so the honest default is NULL, which the certification layer already treats as
 * small-business pursuable for a non-federal source. NOTHING is inferred from the
 * fact that the buyer is a city.
 */
export function daytonSetAside(text: string): string | null {
  const m = String(text ?? "").match(
    /\b(8\(a\)|EDWOSB|SDVOSB|WOSB|HUBZone|small[- ]business set[- ]aside|SBA set[- ]aside)/i,
  );
  return m ? m[1] : null;
}

/** `<option value="18">Engineering & Construction</option>` → group → CatID. */
function catIdsByGroup(html: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of html.matchAll(/<option value="(\d+)"[^>]*>([\s\S]*?)<\/option>/g)) {
    const name = decodeText(m[2]);
    if (name) map.set(name, m[1]);
  }
  return map;
}

/** Every non-empty `<span …>text</span>` of a fragment, decoded, in order. */
function spanTexts(fragment: string): string[] {
  return [...fragment.matchAll(/<span(?:\s[^>]*)?>([\s\S]*?)<\/span>/g)]
    .map((m) => decodeText(m[1]))
    .filter((s) => s.length > 0);
}

/**
 * PURE board parse — no network, no DB, no clock beyond the injected `now` used
 * by the defensive `closed` guard (tests pass a fixed reference instant so the
 * fixture never depends on the wall clock).
 */
export function parseDaytonBoard(html: string, now: number = Date.now()): DaytonParseResult {
  const rows: RawBid[] = [];
  const parsed: DaytonBoardRow[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];

  // Shape guard (spec §3.2 step 4 / R11 / R16): a CivicEngage upgrade that moves
  // or drops the item container must produce ZERO rows + a loud log. A partial
  // parse of a restructured page is the dangerous mode (it looks like coverage).
  const start = html.indexOf(ITEMS_ANCHOR);
  const end = start >= 0 ? html.indexOf(REGION_END_ANCHOR, start) : -1;
  if (start < 0 || end < 0) {
    console.error(
      `  oh_dayton: page shape changed — item-region anchor missing (start=${start}, end=${end}); ingesting 0 rows (fail-safe, never a guess)`,
    );
    recordSkip(skipped, skippedRows, "dayton-board", "shape_change");
    return { rows, parsed, skipped, skippedRows };
  }

  const catIds = catIdsByGroup(html);
  const region = html.slice(start, end);
  let group: string | null = null;
  let groupCountText: string | null = null;

  for (const part of region.split(BLOCK_SPLIT)) {
    if (/^\s*<div class="bidsHeader listHeader"/.test(part)) {
      const spans = spanTexts(part);
      group = spans[0] ?? null;
      groupCountText = spans[1] ?? null;
      continue;
    }
    if (!/^\s*<div class="listItemsRow bid/.test(part)) continue;

    // Never assume group order or a fixed group set: the category comes from the
    // header that PRECEDES the row, and a row with no header yet is skipped.
    const idMatch = part.match(/href="bids\.aspx\?bidID=(\d+)"/);
    const bidID = idMatch ? idMatch[1] : null;
    if (!bidID) {
      recordSkip(skipped, skippedRows, "dayton-unknown-row", "missing_id");
      continue;
    }
    const rowId = `dayton-${bidID}`;
    if (!group) {
      recordSkip(skipped, skippedRows, rowId, "missing_category");
      continue;
    }

    // Title: the FIRST anchor of div.bidTitle (a row also carries a "Read on"
    // anchor — same bidID — that must not be mistaken for the title).
    const titleMatch = part.match(
      /<div class="bidTitle"[^>]*>\s*<span><a href="bids\.aspx\?bidID=\d+"[^>]*>([\s\S]*?)<\/a>/,
    );
    const title = titleMatch ? decodeText(titleMatch[1]) : "";
    if (!title) {
      recordSkip(skipped, skippedRows, rowId, "missing_title");
      continue;
    }

    const titleDiv = (part.match(/<div class="bidTitle"[^>]*>([\s\S]*?)<\/div>/) ?? [])[1] ?? "";
    // Drop the source's "Read on" affordance ELEMENT first: it is an <a> with a
    // nested <span>, and leaving it in makes a non-greedy <span>…</span> read
    // truncate the description mid-sentence (spec R7).
    const titleDivNoReadOn = titleDiv.replace(/<a\b[^>]*>\s*Read&nbsp;on[\s\S]*?<\/a>/gi, "");

    // "Bid No." is OPTIONAL and its span starts at column 0 (no indentation) —
    // anchor on the <strong> only, never on whitespace (spec R3/R4).
    const bidNoMatch = titleDiv.match(/<strong>Bid No\.<\/strong>\s*([\s\S]*?)<\/span>/);
    const bidNoText = bidNoMatch ? decodeText(bidNoMatch[1]) : "";
    const bidNo = bidNoText || null;

    // Description: the LAST span text of div.bidTitle that is neither the title
    // nor the Bid No. line. Stored verbatim (incl. the source's own "…") — scope
    // detail is never completed or invented.
    let description = "";
    for (const s of spanTexts(titleDivNoReadOn)) {
      if (s === title) continue;
      if (bidNo && s.includes(bidNo)) continue;
      description = s;
    }
    // Remove the empty "[]" affordance remnant left by the Read-on strip.
    description = description.replace(/\[\s*\]/g, "").replace(/\s+/g, " ").trim();

    // Status/Closes VALUES: div.bidStatus holds TWO child divs — the first with
    // the labels ("Status:", "Closes:"), the second with the values. Reading the
    // 3rd/4th non-empty span texts is equivalent and cannot pick up a label.
    const statusBlock = (part.match(/<div class="bidStatus">([\s\S]*)$/) ?? [])[1] ?? "";
    const statusSpans = spanTexts(statusBlock);
    const status = statusSpans[2];
    if (!status) {
      recordSkip(skipped, skippedRows, rowId, "missing_status");
      continue;
    }
    const closes = statusSpans[3] ?? "";

    // Structural cross-check (spec §2.5): the label span id is
    // `BidStatus<bidID><CatID>`, so a restructure that mis-groups rows fails
    // LOUDLY here instead of mis-assigning a category silently. Only asserted
    // when BOTH the id and the group's CatID are present.
    const statusId = (statusBlock.match(/<span id="BidStatus(\d+)"/) ?? [])[1];
    const catId = catIds.get(group);
    if (statusId && catId && statusId !== `${bidID}${catId}`) {
      console.warn(
        `  oh_dayton: BidStatus id cross-check failed for ${rowId}: id=${statusId}, expected=${bidID}${catId} (group "${group}")`,
      );
      recordSkip(skipped, skippedRows, rowId, "id_catid_mismatch");
      continue;
    }

    const sourceUrl = `${DAYTON_ENDPOINT}?bidID=${bidID}`;
    parsed.push({
      bidID,
      group,
      groupCountText,
      bidNo,
      title,
      description,
      status,
      closes,
      sourceUrl,
    });

    // The bare GET is ALREADY the open list, so `not_open` is defensive against
    // the page's default changing. The <span>Open</span> VALUE is the authority.
    if (status.trim().toLowerCase() !== "open") {
      recordSkip(skipped, skippedRows, rowId, "not_open");
      continue;
    }

    // "Parse or NULL" — never map a sentinel to a fabricated date (spec R5/R6).
    const due = toIsoDueDate(closes);
    // Defensive: never insert a row already closed between fetch and insert.
    // A NULL due_date ("Upon Contract" / "Open Until Contracted") is legitimate
    // and MUST still be emitted — it is not a reason to drop.
    if (due && Date.parse(due) < now) {
      recordSkip(skipped, skippedRows, rowId, "closed");
      continue;
    }

    const fallbackDescription =
      "Open City of Dayton solicitation issued by the City of Dayton. Full details and documents are on the City of Dayton bid board (see source link).";

    rows.push({
      external_id: `dayton-${bidID}`,
      title,
      agency: DAYTON_AGENCY,
      description: description || fallbackDescription,
      location: DAYTON_LOCATION,
      category: daytonCategory(title, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: sourceUrl,
      // Only if the row's own text states a program — otherwise NULL.
      set_aside: daytonSetAside(`${title} ${description}`),
      // This source exposes none of these; NULL means "not supplied", never guessed.
      naics_code: null,
      psc: null,
      notice_type: null,
      solicitation_number: null,
    });
  }

  return { rows, parsed, skipped, skippedRows };
}

/**
 * Fetch the City of Dayton open-bid board and return ingest rows.
 *
 * ONE bare GET per sync (`?showAllBids=true&Status=all` returns an empty list,
 * not an error), 20 s AbortController timeout (a stalled list fetch would hold up
 * a whole sync), and any HTTP/network failure degrades to ZERO rows + a log —
 * never a throw that could abort the run.
 */
export async function fetchOhDaytonBids(): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let resp: Response;
  try {
    resp = await fetch(DAYTON_ENDPOINT, { headers: DAYTON_HEADERS, signal: controller.signal });
  } catch (e) {
    console.error(`  oh_dayton: fetch failed:`, (e as Error).message);
    return { rows: [], skipped: {}, skippedRows: [] };
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    console.error(`  oh_dayton: HTTP ${resp.status}`);
    return { rows: [], skipped: {}, skippedRows: [] };
  }

  const html = await resp.text();
  const { rows, parsed, skipped, skippedRows } = parseDaytonBoard(html);
  console.log(
    `  oh_dayton: ${rows.length} open bids accepted (rows read: ${parsed.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
