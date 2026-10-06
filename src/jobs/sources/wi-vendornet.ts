/**
 * Wisconsin DOA VendorNet Bids — `wi_vendornet`, the State of Wisconsin's own
 * statewide solicitation board (`https://vendornet.wi.gov/Bids`), run by the
 * Wisconsin Department of Administration. This is the first BROWSER-RENDERED
 * source in the bids family: VendorNet's `/Bids` page is a 3.8 KB Blazor Server
 * shell with ZERO rows in its HTML, no REST/JSON endpoint (`/api/bids` → 404) and
 * no ETag/Last-Modified on anything that carries data — rows arrive over
 * `/_blazor/negotiate` (HTTP 200) + a WebSocket (handshake 101). Deep-linking the
 * filter state does NOT work (proved by the Phase-1 spike: every query-param
 * variant renders the pristine 7,841-item state), so the filters are driven
 * through the grid's own UI. Owner decision 2026-10-06: browser collector YES,
 * join the shared `bids` table as a state source, NO new cron, NO migration.
 *
 * HOW THE READ IS SPLIT (and why this module imports no browser):
 *   · `.github/scripts/vendornet-bids-fetch.mjs` — the puppeteer-core DRIVER. It
 *     renders the page, drives the open-only filter, pages to the end of that set
 *     and writes ONE JSON envelope of exactly what the page showed (cell text as
 *     rendered + the grid's own footer count). It is installed ephemerally by
 *     `sync-bids.yml` (the runner image already ships Chrome) so the repo manifest
 *     stays untouched — the same pattern the Phase-1 spike proved in CI.
 *   · THIS MODULE — the PARSE. Pure, deterministic, no browser, no network, no
 *     clock beyond the injected `now`. Every rule about what a row MEANS lives
 *     here and is pinned by fixtures in `wi-vendornet.test.ts`.
 *
 * THE OPEN SET (owner-locked definition, plan §1.3/§4 — the definition the copy
 * beside the rows describes, and the only one this source may use):
 *   a row is open iff its published Due Date is TODAY OR LATER (Central Time,
 *   deadline day inclusive), with the grid's "Include Awarded Bids" and "Include
 *   Canceled Bids" toggles OFF, Bid Type left at All, and both Available-range
 *   fields blank. The count quoted anywhere is the GRID'S OWN footer count
 *   ("1 - 50 of 56 items" ⇒ 56), never our arithmetic.
 *
 * DATA HONESTY (never manufacture, relabel, or loosen — plan §3.1/§4.2):
 *   · `source` = `wi_vendornet`; class `state`, badge "State (WI)" (R5/R8: a
 *     statewide portal is STATE even though its buyers include cities, counties
 *     and special districts — the buyer string is kept verbatim in `agency` and
 *     is NEVER used to infer a per-row jurisdiction, policy R7 / ruling b).
 *   · `location` = "Wisconsin" (the source's own statewide scope; the same shape
 *     as id_ipro's "Idaho" / wa_webs's "Washington"), and the write path pins the
 *     class' home jurisdiction (SOURCE_HOME_JURISDICTIONS.wi_vendornet = "WI").
 *   · `title` / `agency` / `due_date` are as published. `due_date` is parsed with
 *     the shared `toIsoDueDate` ("parse or NULL", never an invented instant) and a
 *     date the runtime cannot parse is stored NULL and COUNTED as a diagnostic —
 *     a row the source published is never silently dropped for a formatting
 *     quirk.
 *   · `bid_type` ("RFB" / "RFP" / "RFI" / "Simplified Bid") and `available_date`
 *     are captured in this module's parse result and the run's diagnostics, but
 *     `bids` has NO column for them and this PR adds NO migration, so they are
 *     deliberately NOT stuffed into a wrong column (plan §3.1: "don't stuff data
 *     into a wrong column"). The raw values stay in the driver payload.
 *   · `set_aside` is ALWAYS NULL. VendorNet publishes no federal set-aside, and
 *     the owner's ruling (f) is explicit that a missing federal set-aside must
 *     never be read as a state/local small-business opportunity. Nothing is
 *     inferred from Wisconsin's own MBE/WBE/DVB programs.
 *   · `naics_code` / `psc` / `notice_type` are NULL — this source exposes none.
 *     `solicitation_number` carries the source's own reference number when the row
 *     publishes a real one (the same shape id_ipro uses for its event number).
 *
 * IDENTITY (plan §1.5 — "derived, never positional"):
 *   · a real Solicitation Ref # ⇒ `external_id = wi-<ref>`.
 *   · no usable ref # ⇒ `wi-s-<dueDay|nodue>-<fnv1a32 of title|organization|dueDay>`.
 *     "Not usable" covers BOTH observed shapes: an EMPTY ref cell, and the MMSD
 *     rows where the ref cell merely repeats the solicitation text
 *     ("MMSD, 2026, PFAS Testing of Wastewater and Biosolids Consultant" for a
 *     title of "PFAS Testing of Wastewater and Biosolids Consultant"). Both are
 *     counted separately in the diagnostics because they mean different things
 *     about the source, and neither may silently borrow the title as an id.
 *   · duplicate ids WITHIN one payload are disambiguated deterministically
 *     (`-2`, `-3`, …) and counted (`collisions`) — never silently overwritten.
 *
 * COPY (§4 of the build plan; the strings this product may use):
 *   publisher line, badge, open-set definition, buyer-mix note, time-zone note,
 *   no-claims line and the live-count honesty line are exported below as
 *   `WI_VENDORNET_COPY` + `wiVendornetCountLine()` so no surface can invent its
 *   own wording, and the count line can only be built from REAL run numbers.
 *
 * RUN PLUMBING: the source is registered in `src/jobs/runner.ts` TAIL_SOURCES, so
 * the EXISTING `sync-bids.yml` cadence (weekdays every 4h, weekends once a day)
 * picks it up — no new cron (owner decision ③). The workflow installs
 * puppeteer-core into `$RUNNER_TEMP` and points `WI_VENDORNET_FETCH_SCRIPT` at the
 * copied driver; a missing/!failing driver is a DEAD source (SourceUnreachableError
 * → errors>0, rows_fetched=0), never an "empty" result and never a partial write.
 *
 * NATURAL-KEY NOTE: `bids` carries migration 048's frozen-predicate unique index on
 * (title, agency, notice_type, due_date, psc). This source publishes NULL for
 * notice_type/psc, so two genuinely different solicitations with the same
 * title+agency+due date collide there; `syncSource` already classifies that as
 * "deduped by natural key" (not a failure) for every state source, and nothing
 * here changes that behaviour.
 */
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapCategory } from "~/lib/trade-classification";
import { toIsoDueDate } from "~/lib/date";
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

/** The stored `bids.source` label (R8: never renamed, never inferred). */
export const WI_VENDORNET_SOURCE = "wi_vendornet";
/** The board itself — the only URL this source reads or cites. */
export const WI_VENDORNET_ENDPOINT = "https://vendornet.wi.gov/Bids";
/** Official host, asserted on every emitted `source_url`. */
export const WI_VENDORNET_HOST = "vendornet.wi.gov";
/** The publisher, as it names itself on the board. */
export const WI_VENDORNET_PUBLISHER = "Wisconsin DOA VendorNet";
/** Statewide scope ⇒ the same `location` shape as id_ipro ("Idaho") / wa_webs ("Washington"). */
export const WI_VENDORNET_LOCATION = "Wisconsin";
/** The collector's own label for a shape it cannot parse — never an empty set. */
export const WI_VENDORNET_SHAPE_FAILURE = "shape_change";
/** Source-reported-open-set failures (the read, not the source's shape). */
export const WI_VENDORNET_INCOMPLETE = "incomplete_open_set";

/**
 * THE COPY (plan §4.1 — owner-locked wording). Exported so a surface, an alert or
 * a run record quotes the same sentence, and so the count line can only be built
 * from numbers a real run produced.
 */
export const WI_VENDORNET_COPY = {
  publisherLine: "State and local solicitations as published by Wisconsin DOA VendorNet.",
  /** The badge comes from `source-class.ts` (STATE → "State (WI)"); pinned here too. */
  badge: "State (WI)",
  openSetDefinition:
    "Showing solicitations due today or later. Awarded and canceled solicitations are excluded, as are solicitations whose due date has passed.",
  buyerMixNote:
    "VendorNet hosts solicitations for Wisconsin state agencies, the University of Wisconsin System, and for cities, counties and special districts that publish through it. Contact and buyer details are as the source states them.",
  timeZoneNote:
    "Due dates and times are shown as published by the source (Central Time), and are not converted.",
  noClaimsLine:
    "Contrax checks this source on a schedule, but does not warrant that every Wisconsin solicitation is listed. Always confirm details and deadlines at the official source.",
} as const;

/**
 * The live-count honesty line (plan §4.1). `count` MUST be the grid's own footer
 * count from the run being described; `asOf` is the run's own "last checked"
 * stamp. Never hardcode a number beside this string.
 */
export function wiVendornetCountLine(count: number, asOf: Date | string): string {
  const stamped =
    typeof asOf === "string"
      ? asOf
      : new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Chicago",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
          .format(asOf)
          .replace(",", "");
  return `Wisconsin DOA VendorNet listed ${count} solicitations due today or later · last checked by Contrax ${stamped} CT.`;
}

// ── Driver payload contract ────────────────────────────────────────────────
/** One row exactly as the rendered grid presents it (cell text, verbatim). */
export interface WiVendornetRow {
  ref: string | null;
  title: string | null;
  organization: string | null;
  available_date: string | null;
  due_date: string | null;
  bid_type: string | null;
  cells?: string[];
}
/** One rendered page of the open-only set. */
export interface WiVendornetPage {
  page: number;
  footerText: string | null;
  rangeStart: number | null;
  rangeEnd: number | null;
  countFromSource: number | null;
  rowCount: number;
  firstRef: string | null;
  refs?: (string | null)[];
  rows: WiVendornetRow[];
}
/** The driver's envelope — what the page actually showed. */
export interface WiVendornetPayload {
  v: number;
  source: string;
  endpoint: string;
  capturedAt: string;
  captureTimezone?: string;
  expectedHeaders?: string[];
  browser?: { launchMode?: string; version?: string; executablePath?: string | null };
  driver?: { file?: string; node?: string; puppeteerCore?: string };
  baseline?: { footerText?: string | null; totalItems?: number | null; rowCount?: number };
  filterRequested?: Record<string, unknown>;
  filterReadBack?: Record<string, unknown>;
  openOnly?: {
    footerText?: string | null;
    countFromSource?: number | null;
    footerKind?: string;
    rowCount?: number;
    headers?: string[];
    headerSource?: string;
    columnMapping?: string;
  };
  pages: WiVendornetPage[];
  countFromSource: number;
  rowsSeen: number;
  pagesRendered: number;
  blazor?: Record<string, unknown>;
  elapsedMs?: number;
}

/** One accepted row, pre-guard, for tests/diagnostics. */
export interface WiVendornetBoardRow {
  externalId: string;
  idSource: "ref" | "slug";
  ref: string | null;
  refCell: string | null;
  title: string;
  organization: string;
  availableDate: string | null;
  dueText: string | null;
  dueDate: string | null;
  dueDay: string | null;
  bidType: string | null;
  sourceUrl: string;
}

export interface WiVendornetParseMeta {
  /** The grid's OWN count for the open-only set ("N items"). */
  countFromSource: number;
  /** Rows the driver actually read across all pages. */
  rowsSeen: number;
  pagesRendered: number;
  /** Every page's own footer text — the audit trail for the count above. */
  pageFooters: string[];
  capturedAt: string | null;
  capturedTimezone: string | null;
  /** Non-skip observations worth reporting (never "columns" the schema lacks). */
  diagnostics: {
    /** Rows whose ref was empty ⇒ slug identity. */
    refMissing: number;
    /** Rows whose ref cell merely repeated the solicitation text ⇒ slug identity. */
    refRepeatedTitle: number;
    /** Rows whose due text could not be read as a date ⇒ due_date NULL (row kept). */
    dueDateUnparseable: number;
    /** Rows with no Bid Type value at all ⇒ captured as null, never guessed. */
    bidTypeAbsent: number;
    /** Same generated id twice in one payload ⇒ suffixed -2/-3 (never dropped). */
    collisions: number;
    /** Distinct bid types the source published in this run (metadata only). */
    bidTypesSeen: string[];
  };
  /** Set when the payload itself is unusable (the read failed) — see the fetch fn. */
  fatalReason: string | null;
  fatalDetail: string | null;
  /** The Central-Time day the open-set definition was evaluated against. */
  referenceDay: string;
  /** Applied from "today or later" DOWNWARD only: rows the source still published. */
  notOpen: number;
}

export interface WiVendornetParseResult {
  rows: RawBid[];
  parsed: WiVendornetBoardRow[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
  meta: WiVendornetParseMeta;
}

// ── small pure helpers ─────────────────────────────────────────────────────
/** Collapse whitespace: the driver hands over `textContent`, so nothing else is needed. */
function norm(v: unknown): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The Central-Time calendar day of an instant, as `YYYY-MM-DD`. The open-set
 * definition is a DATE (the grid filters on "Due Date Start = today"), so the
 * boundary is evaluated by day — not by an instant — which is also why a row due
 * "10/06/2026 02:00 PM" is still open all of 2026-10-06 whatever the host clock
 * says. `now` is injectable so tests never depend on the wall clock.
 */
export function centralDateOnly(now: Date | number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

/**
 * The calendar day written in a due-date cell (`MM/DD/YYYY`, optionally followed
 * by a time; an already-ISO `YYYY-MM-DD` is accepted too). Returns null when the
 * cell carries no readable day — never a guessed day, and never a sentinel table
 * (the source publishes no sentinel: every row in the open set carries a date).
 */
export function dueDayFromText(value: string | null | undefined): string | null {
  const raw = norm(value);
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}

/** FNV-1a 32-bit, hex — deterministic on every runtime, no dependency, no import. */
export function wiSlugHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Is the ref cell a USABLE solicitation reference? Rejected: an empty cell, a cell
 * far longer than any real reference, and a cell that merely repeats the row's own
 * solicitation text (the MMSD shape). A rejected cell means the row is identified
 * by its deterministic slug instead — the ref cell is never borrowed as an id and
 * never merged into another row's id.
 */
export function wiRefIsUsable(ref: string | null | undefined, title: string | null | undefined): boolean {
  const r = norm(ref).toLowerCase();
  const t = norm(title).toLowerCase();
  if (!r || r.length > 80) return false;
  if (!t) return true;
  if (r === t) return false;
  if (t.length >= 8 && r.includes(t)) return false;
  return true;
}

/**
 * Deterministic identity for a row the source published without a usable ref
 * (plan §1.5: "derived, never positional"). The hash covers title|organization|
 * due-day, so the same solicitation keeps the same id across runs, and the
 * due-day prefix makes an id diagnosable from the row alone.
 */
export function wiSlugExternalId(row: {
  title: string | null | undefined;
  organization: string | null | undefined;
  dueDay: string | null;
}): string {
  const title = norm(row.title);
  const org = norm(row.organization);
  const day = row.dueDay ?? "nodue";
  return `wi-s-${day}-${wiSlugHash(`${title}|${org}|${day}`)}`;
}

/**
 * Envelope validation. Returns a reason when the payload cannot be trusted as a
 * read of the open-only set:
 *   · `envelope` — it is not this source's payload, or it is not the board we read;
 *   · `columns` — the grid's column meaning could not be established;
 *   · `count` — the source's own count is missing/unreadable;
 *   · `incomplete` — the source reports N > 0 items but fewer rows were read (or
 *     none at all). A PARTIAL open set must never reach the corpus: that is the
 *     "silence is never coverage" rule, applied to a rendered grid.
 */
export function validateWiVendornetPayload(
  payload: WiVendornetPayload | null | undefined,
): { ok: true } | { ok: false; reason: string; detail: string } {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "envelope", detail: "no payload object" };
  }
  if (payload.source !== WI_VENDORNET_SOURCE) {
    return { ok: false, reason: "envelope", detail: `unexpected source "${String(payload.source)}"` };
  }
  let host = "";
  try {
    host = new URL(String(payload.endpoint)).host;
  } catch {
    return { ok: false, reason: "envelope", detail: `endpoint is not a URL: "${String(payload.endpoint)}"` };
  }
  if (host !== WI_VENDORNET_HOST) {
    return { ok: false, reason: "envelope", detail: `endpoint host "${host}" is not ${WI_VENDORNET_HOST}` };
  }
  if (!Array.isArray(payload.pages)) {
    return { ok: false, reason: "envelope", detail: "payload.pages is not an array" };
  }
  const open = payload.openOnly;
  if (!open || open.columnMapping === "unmapped" || !Array.isArray(open.headers) || !open.headers.length) {
    return {
      ok: false,
      reason: "columns",
      detail: `the grid's column labels could not be established (mapping=${String(open && open.columnMapping)})`,
    };
  }
  if (open.footerKind === "absent" || open.footerKind === "other") {
    return { ok: false, reason: "count", detail: `no usable footer count (${String(open.footerKind)}: "${String(open.footerText)}")` };
  }
  const count = Number(payload.countFromSource);
  const seen = Number(payload.rowsSeen);
  if (!Number.isFinite(count) || !Number.isFinite(seen)) {
    return { ok: false, reason: "count", detail: `count=${String(payload.countFromSource)} rowsSeen=${String(payload.rowsSeen)}` };
  }
  if (count > 0 && seen < count) {
    return {
      ok: false,
      reason: "incomplete",
      detail: `the source reports ${count} open items but only ${seen} rows were read`,
    };
  }
  return { ok: true };
}

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
 * PURE parse of the driver envelope into `bids` rows — no network, no DB, no
 * browser, and no clock beyond the injected `now` used by the defensive
 * "not open any more" guard (tests pass a fixed instant).
 *
 * A payload that cannot be trusted as a read (see `validateWiVendornetPayload`)
 * yields ZERO rows, a loud log and one `shape_change` skip — never a partial
 * parse that would look like coverage. The caller (`fetchWiVendornetBids`) turns a
 * fatal payload into a DEAD source instead of an empty one.
 */
export function parseWiVendornetPayload(
  payload: WiVendornetPayload | null | undefined,
  now: Date | number = Date.now(),
): WiVendornetParseResult {
  const referenceDay = centralDateOnly(now);
  const meta: WiVendornetParseMeta = {
    countFromSource: Number(payload?.countFromSource ?? 0),
    rowsSeen: Number(payload?.rowsSeen ?? 0),
    pagesRendered: Array.isArray(payload?.pages) ? payload!.pages.length : 0,
    pageFooters: Array.isArray(payload?.pages) ? payload!.pages.map((p) => String(p.footerText ?? "")) : [],
    capturedAt: payload?.capturedAt ?? null,
    capturedTimezone: payload?.captureTimezone ?? null,
    diagnostics: {
      refMissing: 0,
      refRepeatedTitle: 0,
      dueDateUnparseable: 0,
      bidTypeAbsent: 0,
      collisions: 0,
      bidTypesSeen: [],
    },
    fatalReason: null,
    fatalDetail: null,
    referenceDay,
    notOpen: 0,
  };

  const verdict = validateWiVendornetPayload(payload);
  if (!verdict.ok) {
    meta.fatalReason = verdict.reason;
    meta.fatalDetail = verdict.detail;
    console.error(
      `  wi_vendornet: unusable payload (${verdict.reason}) — ${verdict.detail}; ingesting 0 rows (fail-safe, never a partial open set)`,
    );
    const skipped: Record<string, number> = {};
    const skippedRows: { id: string; reason: string }[] = [];
    recordSkip(skipped, skippedRows, "wi-vendornet-payload", WI_VENDORNET_SHAPE_FAILURE);
    return { rows: [], parsed: [], skipped, skippedRows, meta };
  }

  // Honest-empty: the grid's own count is 0 ⇒ no rows, no skips, no error.
  if (meta.countFromSource === 0) {
    console.log("  wi_vendornet: the board reports 0 solicitations due today or later (honest empty)");
    return { rows: [], parsed: [], skipped: {}, skippedRows: [], meta };
  }

  const rows: RawBid[] = [];
  const parsed: WiVendornetBoardRow[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  const usedIds = new Map<string, number>();
  const bidTypes = new Set<string>();

  for (const page of payload!.pages) {
    for (const raw of page.rows ?? []) {
      const title = norm(raw.title);
      const organization = norm(raw.organization);
      const refCell = norm(raw.ref) || null;
      const dueText = norm(raw.due_date) || null;
      const availableDate = norm(raw.available_date) || null;
      const bidType = norm(raw.bid_type) || null;
      if (bidType) bidTypes.add(bidType);
      else meta.diagnostics.bidTypeAbsent += 1;
      const dueDay = dueDayFromText(dueText);

      // Identity FIRST so every skip can name the row it dropped.
      const usableRef = wiRefIsUsable(refCell, title);
      let externalId: string;
      let idSource: "ref" | "slug";
      if (usableRef) {
        externalId = `wi-${refCell}`;
        idSource = "ref";
      } else {
        externalId = wiSlugExternalId({ title, organization, dueDay });
        idSource = "slug";
        // Two different observations, counted apart on purpose: an EMPTY ref cell
        // and a ref cell that merely repeats the solicitation text.
        if (!refCell) meta.diagnostics.refMissing += 1;
        else meta.diagnostics.refRepeatedTitle += 1;
      }
      // Duplicate ids within one payload are kept (never dropped) and made unique.
      const seen = usedIds.get(externalId) ?? 0;
      usedIds.set(externalId, seen + 1);
      if (seen > 0) {
        meta.diagnostics.collisions += 1;
        externalId = `${externalId}-${seen + 1}`;
      }

      if (!title) {
        recordSkip(skipped, skippedRows, externalId, "missing_title");
        continue;
      }
      if (!organization) {
        recordSkip(skipped, skippedRows, externalId, "missing_agency");
        continue;
      }

      // "Parse or NULL", never an invented instant. A row whose date the runtime
      // cannot read is still a real, source-published row: it is KEPT (due_date
      // NULL, diagnosed) rather than dropped — silence is never coverage.
      const dueDate = toIsoDueDate(dueText);
      if (dueText && !dueDay && !dueDate) meta.diagnostics.dueDateUnparseable += 1;

      // Defensive: the open-only filter is a DATE window ("today or later"), so a
      // row whose published day is already past can only come from a stale render.
      // It is dropped WITH a reason (never silently), and only ever compared by
      // day — never by an instant, which would mis-drop a row due later today.
      if (dueDay && dueDay < referenceDay) {
        meta.notOpen += 1;
        recordSkip(skipped, skippedRows, externalId, "not_open");
        continue;
      }

      const sourceUrl = WI_VENDORNET_ENDPOINT;
      const description = [
        `Open Wisconsin solicitation published by ${organization} on the Wisconsin DOA VendorNet bid board.`,
        `Solicitation reference ${usableRef && refCell ? refCell : "not stated"}.`,
        `Bid type ${bidType ?? "not stated"}.`,
        availableDate ? `Available date ${availableDate}.` : null,
        dueText ? `Due ${dueText} (as published, Central Time).` : null,
        "Full details and documents are on VendorNet (see source link).",
      ]
        .filter(Boolean)
        .join(" ");

      parsed.push({
        externalId,
        idSource,
        ref: usableRef ? refCell : null,
        refCell,
        title,
        organization,
        availableDate,
        dueText,
        dueDate,
        dueDay,
        bidType,
        sourceUrl,
      });

      rows.push({
        external_id: externalId,
        title,
        agency: organization,
        description,
        location: WI_VENDORNET_LOCATION,
        category: mapCategory(bidType ?? "", title, description),
        due_date: dueDate,
        estimated_value: "Not specified",
        source_url: sourceUrl,
        // Ruling (f): the absence of a federal set-aside is NEVER a state/local
        // small-business signal, so this source stamps nothing at all.
        set_aside: null,
        // This source publishes no NAICS/PSC/notice type. NULL means "not
        // supplied", and the reference number is the source's own id, not a
        // federal solicitation number.
        naics_code: null,
        psc: null,
        notice_type: null,
        solicitation_number: usableRef ? refCell : null,
      });
    }
  }

  meta.diagnostics.bidTypesSeen = [...bidTypes].sort();
  console.log(
    `  wi_vendornet: ${rows.length} open solicitations accepted (source count ${meta.countFromSource}; ` +
      `rows read ${meta.rowsSeen} over ${meta.pagesRendered} page(s); ref ids ${rows.length - meta.diagnostics.refMissing - meta.diagnostics.refRepeatedTitle}, ` +
      `slug ids ${meta.diagnostics.refMissing + meta.diagnostics.refRepeatedTitle}, collisions ${meta.diagnostics.collisions}; skips: ${
        Object.entries(skipped)
          .map(([r, n]) => `${r}=${n}`)
          .join(", ") || "none"
      })`,
  );
  return { rows, parsed, skipped, skippedRows, meta };
}

// ── the fetch: run the headless driver, then parse ─────────────────────────
/** Where the driver lives by default (the repo's own copy). */
export const WI_VENDORNET_DRIVER_DEFAULT = ".github/scripts/vendornet-bids-fetch.mjs";
/** The driver's own hard wall clock, inside the spawn timeout below. */
export const WI_VENDORNET_DRIVER_DEADLINE_MS = 8 * 60 * 1000;
/** The spawn timeout: a dead driver must not hold a sync open. */
export const WI_VENDORNET_SPAWN_TIMEOUT_MS = 10 * 60 * 1000;

export interface WiVendornetDriverConfig {
  /** Absolute or cwd-relative path of the driver script to execute. */
  script: string;
  /** Node binary (the driver is ESM + puppeteer-core, so it runs under Node). */
  node: string;
  /** Hard kill for the child process. */
  timeoutMs: number;
  /** Where the driver writes its JSON envelope. */
  outFile: string;
  /** The driver's internal deadline (always below `timeoutMs`). */
  deadlineMs: number;
}

/**
 * Resolve the driver invocation from the environment. `WI_VENDORNET_FETCH_SCRIPT`
 * is what `sync-bids.yml` sets to the EPHEMERALLY installed copy (puppeteer-core
 * lives beside it in `$RUNNER_TEMP`, and Node resolves the dependency from the
 * script's own directory); without it the repo's copy is used, which needs a
 * puppeteer-core install to be resolvable and otherwise fails LOUDLY (a dead
 * source, never an empty set).
 */
export function resolveWiVendornetDriverConfig(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): WiVendornetDriverConfig {
  const timeoutMs = Number(env.WI_VENDORNET_SPAWN_TIMEOUT_MS ?? "") || WI_VENDORNET_SPAWN_TIMEOUT_MS;
  return {
    script: env.WI_VENDORNET_FETCH_SCRIPT || join(cwd, WI_VENDORNET_DRIVER_DEFAULT),
    node: env.WI_VENDORNET_NODE || "node",
    timeoutMs,
    outFile: env.WI_VENDORNET_PAYLOAD_OUT || join(tmpdir(), "wi-vendornet-payload.json"),
    // Let the DRIVER fail first, with its own precise stage, whenever there is room.
    deadlineMs: Number(env.WI_VENDORNET_DEADLINE_MS ?? "") || Math.max(60_000, timeoutMs - 30_000),
  };
}

interface DriverRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string[];
  stdoutTail: string[];
  timedOut: boolean;
}

/** Spawn the driver, stream its log into ours, and NEVER let it outlive its timeout. */
function runDriver(cfg: WiVendornetDriverConfig): Promise<DriverRun> {
  return new Promise((resolve) => {
    const child = spawn(cfg.node, [cfg.script], {
      env: {
        ...process.env,
        WI_VENDORNET_OUT: cfg.outFile,
        WI_VENDORNET_DEADLINE_MS: String(cfg.deadlineMs),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderrTail: string[] = [];
    const stdoutTail: string[] = [];
    const keep = (arr: string[], line: string) => {
      arr.push(line);
      if (arr.length > 40) arr.shift();
    };
    child.stdout?.on("data", (b: Buffer) => {
      for (const line of String(b).split("\n").filter(Boolean)) {
        console.log(`  [wi_vendornet driver] ${line}`);
        keep(stdoutTail, line);
      }
    });
    child.stderr?.on("data", (b: Buffer) => {
      for (const line of String(b).split("\n").filter(Boolean)) {
        console.error(`  [wi_vendornet driver] ${line}`);
        keep(stderrTail, line);
      }
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.error(`  wi_vendornet: driver exceeded ${cfg.timeoutMs}ms — killing it (no payload is trusted)`);
      child.kill("SIGKILL");
    }, cfg.timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, signal: null, stderrTail: [`spawn failed: ${err.message}`], stdoutTail, timedOut });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stderrTail, stdoutTail, timedOut });
    });
  });
}

/**
 * Read the VendorNet open-only board and return ingest rows.
 *
 * One driver process per sync: launch a browser, apply the open-only filter through
 * the grid's own UI, page to the end of that set, emit one payload, exit. There is
 * no conditional GET to lean on (no ETag/Last-Modified on any payload carrying
 * data) and no deep link (proved), so every sync is a fresh, complete re-render of
 * the open set — the "delta" is the parser's identity + the upsert's natural key.
 *
 * FAIL-CLOSED: a driver that cannot start, cannot launch a browser, cannot set the
 * filter, cannot finish its pages, times out, or writes an unreadable payload is
 * reported as an UNREACHABLE source (SourceUnreachableError) — the run record gets
 * `errors > 0, rows_fetched = 0`, which reads as DEAD. It is never "0 rows".
 */
export async function fetchWiVendornetBids(): Promise<FetchResult> {
  const cfg = resolveWiVendornetDriverConfig();
  console.log(
    `  wi_vendornet: running the headless driver (${cfg.script}) → ${cfg.outFile} [budget ${Math.round(cfg.timeoutMs / 1000)}s]`,
  );
  const run = await runDriver(cfg);
  if (run.timedOut) {
    throw new SourceUnreachableError(WI_VENDORNET_SOURCE, [
      `the headless driver exceeded its ${cfg.timeoutMs}ms budget and was killed`,
      ...run.stderrTail.slice(-3),
    ]);
  }
  if (run.code !== 0) {
    throw new SourceUnreachableError(WI_VENDORNET_SOURCE, [
      `the headless driver exited ${run.code === null ? `on signal ${run.signal}` : `with code ${run.code}`}`,
      ...run.stderrTail.slice(-3),
    ]);
  }

  let payload: WiVendornetPayload;
  try {
    payload = JSON.parse(readFileSync(cfg.outFile, "utf8")) as WiVendornetPayload;
  } catch (e) {
    throw new SourceUnreachableError(WI_VENDORNET_SOURCE, [
      `the driver's payload could not be read (${(e as Error).message})`,
    ]);
  }

  const result = parseWiVendornetPayload(payload);
  if (result.meta.fatalReason) {
    // An unusable payload is a READ failure (the browser could not establish the
    // open set), not an empty source: DEAD, with no writes at all.
    throw new SourceUnreachableError(WI_VENDORNET_SOURCE, [
      `payload ${result.meta.fatalReason}: ${result.meta.fatalDetail ?? "unknown"}`,
    ]);
  }
  console.log(`  wi_vendornet: ${wiVendornetCountLine(result.meta.countFromSource, result.meta.capturedAt ?? new Date())}`);
  return { rows: result.rows, skipped: result.skipped, skippedRows: result.skippedRows };
}
