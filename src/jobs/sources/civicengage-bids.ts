/**
 * SHARED CivicEngage / CivicPlus bid-board reader (`bids.aspx`).
 *
 * WHY THIS MODULE EXISTS — five CivicEngage boards are now in the corpus (City of
 * Dayton = `oh-dayton.ts`, plus the four Virginia localities in this dispatch:
 * Loudoun County, City of Suffolk, City of Lynchburg, City of Charlottesville).
 * They are the SAME server-rendered ASP.NET product with the SAME row markup, so
 * the reader is config-driven ONCE and each board contributes a small config
 * (the `wi-milwaukee-bonfire.ts` / `tx-*-bonfire.ts` per-tenant pattern, applied
 * to a string-anchor reader instead of a JSON API).
 *
 * `oh-dayton.ts` is deliberately NOT refactored onto this module (policy R8 — no
 * rename / no dedupe churn on a live source): it keeps its own copy of the anchors
 * and its own tests, and the two must stay behaviourally equivalent. The shared
 * reader below is a faithful superset with two documented refinements (see
 * "DIFFERENCES FROM oh-dayton.ts").
 *
 * SOURCE SHAPE — the bare URL only, `GET <endpoint>`:
 *   - each board's bid list is plain HTML read with STRING ANCHORS + regex (the
 *     house style: there is no HTML parser and no DOM in the ingest path).
 *   - query-param variants are NEVER requested. On Dayton
 *     `?showAllBids=true&Status=all` answers HTTP 200 with the item container
 *     absent (a silent empty list); on ALL FOUR Virginia boards the same URL
 *     answers HTTP 404 with no item container (measured 2026-10-08 — the trap
 *     response for each board is committed under fixtures/<board>/). Both modes
 *     are wrong in the same direction, so the bare URL is the only request.
 *   - NO pagination exists on these boards; the whole open list renders on one
 *     page. There is no "next page" to walk, and the reader asserts it: it reads
 *     ONE item region and emits every row block it contains.
 *   - NO detail fetches in v1 — `source_url` links the user to the authoritative
 *     per-bid page (`<endpoint>?bidID=<id>`, confirmed HTTP 200 with a matching
 *     `og:url` on all four boards 2026-10-08).
 *
 * DATA HONESTY (owner rules — never manufacture, relabel or loosen):
 *   - `location` and `agency` come from the board CONFIG (literals), not from the
 *     row text: the board is published by that jurisdiction, so every row it
 *     carries is that jurisdiction's solicitation. Nothing is inferred per row and
 *     no row is relabelled nationwide.
 *   - `category` comes from the SHARED trade classifier over the row's own
 *     title+description (same purchased-service-only rule as every other source).
 *     The CivicEngage group header is used for a STRUCTURAL cross-check, never as a
 *     trade stamp.
 *   - `set_aside` is set ONLY when the source text literally states a program;
 *     otherwise NULL (the non-federal-source rule in cert-matching.ts then makes a
 *     NULL set-aside small-business pursuable — no generic label is stamped).
 *   - `due_date` = shared `toIsoDueDate` — "parse or NULL", NEVER a sentinel lookup
 *     table. These boards print `Upon Contract` for the open-ended state, and the
 *     detail page prints `Open Until Contracted` for the same state, so a
 *     string→date map would rot. A NULL due_date row is still EMITTED.
 *   - `naics_code` / `psc` / `notice_type` / `solicitation_number` stay NULL: the
 *     source exposes none. (`naics_code_source='inferred'` provenance then applies
 *     from the standard pipeline, exactly as for oh-dayton / pennbid.)
 *
 * TIME ZONE — AS PUBLISHED, UNVERIFIED (same documented decision as oh-dayton):
 * all four boards publish wall-clock local times with NO zone suffix
 * ("10/13/2026 4:00 PM") and, unlike Dayton, none of them writes a zone anywhere
 * on the page (measured 2026-10-08: zero occurrences of "Eastern"/"ET"/"local
 * time" in the four captures). `toIsoDueDate` therefore reads the value as the
 * RUNNING environment's local time, so under the sync environment (UTC) a 4:00 PM
 * Eastern closing is stored as 16:00Z — up to 4 h off the true EDT/EST instant.
 * This matches every other source (pennbid / oh-dayton have the identical latent
 * pattern) and is accepted for closing-soon boundary ordering only. The flag below
 * is what a future countdown surface MUST read before rendering a deadline count
 * for these rows. Non-date sentinels still become NULL, never a guessed instant.
 *
 * AMENDMENTS stay separate: these boards expose no amendment notice type, and
 * `external_id = <idPrefix>-<bidID>` means a re-issued/edited bid REFRESHES its row
 * (upsert key (source, external_id)); a genuinely separate notice carries a new
 * bidID. Nothing is collapsed.
 *
 * DIFFERENCES FROM `oh-dayton.ts` (both deliberate, both pinned in
 * civicengage-bids.test.ts):
 *   1. The source's truncated-description affordance is echoed as `Read&nbsp;on`
 *      on Dayton but as a PLAIN `Read on` on all four Virginia boards — the strip
 *      is tolerant of either spelling.
 *   2. The "Bid No." line is skipped by its LABEL (`Bid No.`) instead of by
 *      "does this span contain the bid number". On this platform the read-on
 *      affordance echoes the TITLE (and therefore the bid number) into the
 *      description span, so a containment test drops real descriptions; on Dayton
 *      the two rules are equivalent because its read-on affordance is stripped
 *      first.
 */
import { isJanitorialWork, isTransportationWork } from "~/lib/trade-classification";
import { toIsoDueDate } from "~/lib/date";
import type { FetchResult } from "../runner";
import {
  httpFailureDetail,
  requestFailureDetail,
  SourceUnreachableError,
} from "../fetch-failure";
import { stripHtml, type RawBid } from "./sam-gov";

/**
 * The due-date zone is NOT settled for any CivicEngage board (see the header).
 * A surface that renders a countdown ("due in N days") must read this flag and
 * suppress the label for these sources' rows.
 */
export const CIVICENGAGE_DUE_DATE_ZONE_UNVERIFIED = true;

/** Item-region anchors — identical markup on every board (dayton included). */
export const CIVICENGAGE_ITEMS_ANCHOR = '<div class="bidItems listItems">';
export const CIVICENGAGE_REGION_END_ANCHOR = "function submitBidForm";

/** Split into group headers + rows WITHOUT DOM nesting: the two block anchors. */
const BLOCK_SPLIT = /(?=<div class="(?:bidsHeader listHeader|listItemsRow bid))/;

/**
 * The smallest body that can be a real board page. Every board measured ~100 KB
 * (98 713 – 129 879 B, 2026-10-08); an empty / truncated / error body must fail
 * CLOSED rather than be parsed as an honest empty board. Deliberately far below
 * the real size so a legitimately slimmer board is not rejected.
 */
export const CIVICENGAGE_MIN_BODY_BYTES = 5_000;

/** Sent exactly like the probe that captured the fixtures (browser-like UA). */
export const CIVICENGAGE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
} as const;

/** One board, exactly as it must be described on a row. All literals, no inference. */
export interface CivicEngageBoardConfig {
  /** Registered source label, e.g. `va_loudoun` (also the run-log label). */
  source: string;
  /** Bare absolute board URL, e.g. `https://www.loudoun.gov/bids.aspx`. */
  endpoint: string;
  /** Host of `endpoint` — asserted, never derived from fetched bytes. */
  host: string;
  /** The page's own publisher identity, e.g. `County of Loudoun`. */
  agency: string;
  /** City-level place, provable by construction (this board is its own). */
  location: string;
  /** `external_id` prefix, e.g. `loudoun` → `loudoun-1107`. Stable = upsert, never dup. */
  idPrefix: string;
}

/** One row exactly as the board presents it (pre-guard, for tests/diagnostics). */
export interface CivicEngageBoardRow {
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

export interface CivicEngageParseResult {
  /** Post-guard rows, ready to ingest. */
  rows: RawBid[];
  /** Every row the anchors yielded BEFORE the open/closed guards (diagnostics). */
  parsed: CivicEngageBoardRow[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

/**
 * A config mistake must fail LOUDLY at load, never silently fetch a query-param
 * URL (the silent-empty trap) or stamp a wrong jurisdiction. Pure, no network.
 */
export function assertCivicEngageConfig(config: CivicEngageBoardConfig): void {
  const missing = (["source", "endpoint", "host", "agency", "location", "idPrefix"] as const).filter(
    (k) => !String(config[k] ?? "").trim(),
  );
  if (missing.length) throw new Error(`civicengage: config ${config.source || "?"} is missing ${missing.join(", ")}`);
  if (!config.endpoint.startsWith("https://")) {
    throw new Error(`civicengage: ${config.source} endpoint must be absolute https (got ${config.endpoint})`);
  }
  if (config.endpoint.includes("?")) {
    throw new Error(
      `civicengage: ${config.source} endpoint must be the BARE board URL — query params return an empty list (HTTP 200 on Dayton, HTTP 404 on the Virginia boards)`,
    );
  }
  if (!config.endpoint.includes(`//${config.host}/`)) {
    throw new Error(`civicengage: ${config.source} host ${config.host} does not match endpoint ${config.endpoint}`);
  }
}

/**
 * Text decode for the board's HTML fragments: tag-strip + entity decode via the
 * shared `stripHtml`, with the two entities it does not cover (`&nbsp;`/`&#160;`,
 * used by the source's "Read on" affordance) normalized first. Whitespace
 * collapsed. (Same rule as oh-dayton.)
 */
function decodeText(raw: string | null | undefined): string {
  return stripHtml(
    String(raw ?? "")
      .replace(/&nbsp;/g, " ")
      .replace(/&#160;/g, " ")
      // These boards mix entities into row text (Loudoun/Suffolk/Charlottesville
      // write `&ldquo;RFP&rdquo;`, `&rsquo;s`, `&mdash;`). `stripHtml` decodes only
      // the five XML/HTML basics, so without these the stored description would
      // carry the raw entity spelling into user-visible copy.
      .replace(/&ldquo;/g, "\u201c")
      .replace(/&rdquo;/g, "\u201d")
      .replace(/&lsquo;/g, "\u2018")
      .replace(/&rsquo;/g, "\u2019")
      .replace(/&mdash;/g, "\u2014")
      .replace(/&ndash;/g, "\u2013")
      .replace(/&hellip;/g, "\u2026")
      .replace(/&apos;/g, "'"),
  );
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
 * Category stamp — the SHARED classifier's trade decision, copied from the
 * pennBid/oh-dayton pattern so these sources cannot grow their own bare
 * `/(clean|truck)/` branch: a purchased SERVICE is Janitorial/Transportation only
 * when the shared rule says so, and the product veto keeps e.g. a pipe purchase
 * out of a service trade. Exported so it is unit-testable with zero network.
 */
export function civicEngageCategory(title: string, description = ""): string {
  const titleLc = (title || "").toLowerCase();
  const full = `${titleLc} ${(description || "").toLowerCase()}`.trim();
  if (isTransportationWork(titleLc, full)) return "Transportation";
  if (isJanitorialWork(titleLc, full)) return "Janitorial";
  if (/(construct|renovat|demolit|pav|road|bridge)/.test(full)) return "Construction";
  if (/(supply|materiel|material|equipment)/.test(full)) return "Supplies & Equipment";
  return "Other";
}

/**
 * Set-aside program stated LITERALLY in the row's own text. These boards publish
 * no set-aside field, and today's rows carry no such language at all — so the
 * honest default is NULL, which the certification layer already treats as
 * small-business pursuable for a non-federal source. NOTHING is inferred from the
 * fact that the buyer is a city or a county.
 */
export function civicEngageSetAside(text: string): string | null {
  const m = String(text ?? "").match(
    /\b(8\(a\)|EDWOSB|SDVOSB|WOSB|HUBZone|small[- ]business set[- ]aside|SBA set[- ]aside)/i,
  );
  return m ? m[1] : null;
}

/** `<option value="17">Procurement</option>` → group → CatID. */
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
 * The block-level shape of a row, before any per-field extraction. Exported so a
 * row with a missing anchor pair is distinguishable from an empty board.
 */
export function civicEngageRegion(html: string): { start: number; end: number } {
  const start = html.indexOf(CIVICENGAGE_ITEMS_ANCHOR);
  const end = start >= 0 ? html.indexOf(CIVICENGAGE_REGION_END_ANCHOR, start) : -1;
  return { start, end };
}

/**
 * PURE board parse — no network, no DB, no clock beyond the injected `now` used by
 * the defensive `closed` guard (tests pass a fixed reference instant so a fixture
 * never depends on the wall clock).
 */
export function parseCivicEngageBoard(
  html: string,
  config: CivicEngageBoardConfig,
  now: number = Date.now(),
): CivicEngageParseResult {
  assertCivicEngageConfig(config);
  const rows: RawBid[] = [];
  const parsed: CivicEngageBoardRow[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];

  // Shape guard: a CivicEngage upgrade that moves or drops the item container must
  // produce ZERO rows + a loud log. A partial parse of a restructured page is the
  // dangerous mode (it looks like coverage). This is also EXACTLY what the
  // query-param trap returns — 404-with-no-container (Virginia) or
  // 200-with-no-container (Dayton) — so the guard is the second line of defence.
  const { start, end } = civicEngageRegion(html);
  if (start < 0 || end < 0) {
    console.error(
      `  ${config.source}: page shape changed — item-region anchor missing (start=${start}, end=${end}); ingesting 0 rows (fail-safe, never a guess)`,
    );
    recordSkip(skipped, skippedRows, `${config.idPrefix}-board`, "shape_change");
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
      recordSkip(skipped, skippedRows, `${config.idPrefix}-unknown-row`, "missing_id");
      continue;
    }
    const rowId = `${config.idPrefix}-${bidID}`;
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
    // NESTED <span> echoing the title, so leaving it in makes a non-greedy
    // <span>…</span> read truncate the description mid-sentence and leak the
    // title into the description text. The spelling differs per site
    // (`Read&nbsp;on` on Dayton, a plain `Read on` on the Virginia boards), so
    // match either; the aria-label before the anchor text is harmless.
    const titleDivNoReadOn = titleDiv.replace(/<a\b[^>]*>\s*Read(?:\s|&nbsp;|&#160;)*on[\s\S]*?<\/a>/gi, "");

    // "Bid No." is OPTIONAL and its span starts at column 0; anchor on the
    // <strong> only, never on whitespace.
    const bidNoMatch = titleDiv.match(/<strong>Bid No\.<\/strong>\s*([\s\S]*?)<\/span>/);
    const bidNoText = bidNoMatch ? decodeText(bidNoMatch[1]) : "";
    const bidNo = bidNoText || null;

    // Description: the LAST span text of div.bidTitle that is neither the title
    // nor the "Bid No." line. The Bid-No. line is recognized by its LABEL (see
    // the header): on this platform the read-on affordance echoes the title, so
    // "does this span contain the bid number" would drop real descriptions.
    let description = "";
    for (const s of spanTexts(titleDivNoReadOn)) {
      if (s === title) continue;
      if (/^Bid No\./.test(s)) continue;
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

    // Structural cross-check: the label span id is `BidStatus<bidID><CatID>`, so a
    // restructure that mis-groups rows fails LOUDLY here instead of mis-assigning a
    // category silently. Only asserted when BOTH the id and the group's CatID are
    // present.
    const statusId = (statusBlock.match(/<span id="BidStatus(\d+)"/) ?? [])[1];
    const catId = catIds.get(group);
    if (statusId && catId && statusId !== `${bidID}${catId}`) {
      console.warn(
        `  ${config.source}: BidStatus id cross-check failed for ${rowId}: id=${statusId}, expected=${bidID}${catId} (group "${group}")`,
      );
      recordSkip(skipped, skippedRows, rowId, "id_catid_mismatch");
      continue;
    }

    const sourceUrl = `${config.endpoint}?bidID=${bidID}`;
    parsed.push({ bidID, group, groupCountText, bidNo, title, description, status, closes, sourceUrl });

    // The bare GET is ALREADY the open list, so `not_open` is defensive against
    // the page's default changing. The <span>Open</span> VALUE is the authority.
    if (status.trim().toLowerCase() !== "open") {
      recordSkip(skipped, skippedRows, rowId, "not_open");
      continue;
    }

    // "Parse or NULL" — never map a sentinel to a fabricated date.
    const due = toIsoDueDate(closes);
    // Defensive: never insert a row already closed between fetch and insert.
    // A NULL due_date ("Upon Contract") is legitimate and MUST still be emitted.
    if (due && Date.parse(due) < now) {
      recordSkip(skipped, skippedRows, rowId, "closed");
      continue;
    }

    rows.push({
      external_id: rowId,
      title,
      agency: config.agency,
      description: description || civicEngageFallbackDescription(config),
      location: config.location,
      category: civicEngageCategory(title, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: sourceUrl,
      // Only if the row's own text states a program — otherwise NULL.
      set_aside: civicEngageSetAside(`${title} ${description}`),
      // These boards expose none of these; NULL means "not supplied", never guessed.
      naics_code: null,
      psc: null,
      notice_type: null,
      solicitation_number: null,
    });
  }

  return { rows, parsed, skipped, skippedRows };
}

/**
 * THE COPY, built per board from its own config so a surface, an alert or a run
 * record quotes the same sentence and a count line can only be built from numbers
 * a REAL run produced. NO COVERAGE CLAIM: the 2026-10-08 probe measured ZERO
 * courier / freight / trucking rows on all four Virginia boards, so nothing here
 * says — or implies — that a particular trade appears on a board.
 */
export function civicEngageCopy(config: CivicEngageBoardConfig): {
  publisherLine: string;
  badge: string;
  openSetDefinition: string;
  publisherNote: string;
  timeZoneNote: string;
  noClaimsLine: string;
} {
  const place = config.location.replace(/,\s*[A-Z]{2}$/, "");
  return {
    publisherLine: `Open solicitations as published on ${config.agency}'s own bid board.`,
    badge: place,
    openSetDefinition: `Every solicitation ${config.agency} currently lists as open. The board renders its own open list; a notice whose stated close date has already passed is not ingested.`,
    publisherNote: `${config.agency} publishes this board, so every notice on it is ${config.agency}'s own. The publisher is shown exactly as the board identifies it; no department hierarchy is invented.`,
    timeZoneNote:
      "Close dates are shown exactly as the board publishes them. The board prints a wall-clock time with no time zone, so the time zone is not settled: Contrax stores the value as published, never shifted, and does not show a countdown for these rows.",
    noClaimsLine:
      "Contrax checks this board on a schedule, but does not warrant that every solicitation it lists is captured, and makes no claim about which trades appear on it. Always confirm details and deadlines at the official source.",
  };
}

/**
 * The live-count honesty line. `count` MUST be the number of open rows a REAL run
 * (or an explicit capture) read; `asOf` is that run's own stamp. Never hardcode a
 * number beside this string.
 */
export function civicEngageCountLine(
  config: CivicEngageBoardConfig,
  count: number,
  asOf: Date | string,
): string {
  const stamped =
    typeof asOf === "string"
      ? asOf
      : new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/New_York",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
          .format(asOf)
          .replace(",", "");
  return `${config.agency}'s bid board listed ${count} open solicitations · last checked by Contrax ${stamped} ET.`;
}

/** The description used when the source published none (never an invented scope). */
export function civicEngageFallbackDescription(config: CivicEngageBoardConfig): string {
  return `Open solicitation issued by ${config.agency}. Full details and documents are on the board's own bid page (see source link).`;
}

/**
 * Fetch ONE board and return ingest rows.
 *
 * ONE bare GET per sync, 20 s AbortController timeout (a stalled list fetch would
 * hold up a whole sync), and any failure is reported as an UNREACHABLE source
 * (DEAD) instead of degrading to zero rows — a dead board must never read like an
 * honest empty (`rows_fetched = 0, errors = 0`). Four fetch gates, all fail-closed:
 *   1. non-2xx status,
 *   2. a body below `CIVICENGAGE_MIN_BODY_BYTES` (empty / truncated / error stub),
 *   3. a body without the item-region anchors (restructured board, or the
 *      query-param trap page),
 *   4. a network/abort failure.
 * A 200 whose anchors ARE present and whose board genuinely lists nothing is the
 * honest EMPTY and returns zero rows with no error — unchanged.
 */
export async function fetchCivicEngageBoard(
  config: CivicEngageBoardConfig,
  now: number = Date.now(),
): Promise<FetchResult> {
  assertCivicEngageConfig(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let resp: Response;
  try {
    resp = await fetch(config.endpoint, { headers: CIVICENGAGE_HEADERS, signal: controller.signal });
  } catch (e) {
    const detail = requestFailureDetail(e);
    console.error(`  ${config.source}: ${detail}`);
    throw new SourceUnreachableError(config.source, [detail]);
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const detail = httpFailureDetail(resp.status, config.endpoint);
    console.error(`  ${config.source}: ${detail}`);
    throw new SourceUnreachableError(config.source, [detail]);
  }

  const html = await resp.text();
  if (html.trim().length < CIVICENGAGE_MIN_BODY_BYTES) {
    const detail = `${config.source}: body is ${html.length} bytes (< ${CIVICENGAGE_MIN_BODY_BYTES}) at ${config.endpoint} — refusing to read it as an empty board`;
    console.error(`  ${detail}`);
    throw new SourceUnreachableError(config.source, [detail]);
  }

  const { rows, parsed, skipped, skippedRows } = parseCivicEngageBoard(html, config, now);
  // A missing anchors pair is NOT an honest empty: it means the page we fetched is
  // not the board we know how to read. Fail closed (the parse already logged why).
  if (skipped.shape_change) {
    throw new SourceUnreachableError(config.source, [
      `${config.source}: item-region anchors missing at ${config.endpoint} — board restructured`,
    ]);
  }
  console.log(
    `  ${config.source}: ${rows.length} open bids accepted (rows read: ${parsed.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
