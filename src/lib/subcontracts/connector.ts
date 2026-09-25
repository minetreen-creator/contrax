/**
 * Contrax — SUBCONTRACTING preview, DATA LAYER: the connector contract
 * (owner directive 2026-09-25, BUILD-PLAN.md §6.2).
 *
 * PURE MODULE: no DB, no network, no node builtins, no env reads, no import side
 * effects. Every decision below is unit-tested in
 * src/lib/subcontracts/{subnet-parser,dedupe,expiry}.test.ts. The HTTP crawl lives
 * in src/lib/subcontracts/subnet.ts, the Postgres half in
 * src/lib/subcontracts/store.server.ts, and the run orchestration in
 * src/lib/subcontracts/sync.server.ts.
 *
 * WHY THIS SHAPE. SBA SUBNet is the only public source of open, prime-posted
 * subcontracting opportunities, and it publishes NO API, no JSON, no RSS and no
 * export (verified 2026-09-25) — an HTML index of 10 rows/page plus one detail page
 * per notice is the whole surface. So this feature follows the state-grants
 * connector contract exactly: fetch() → parse() → classify() → dedupe() → store().
 *
 * HONESTY CONTRACT (the same rules the state-grants connector carries, because the
 * preview must not be more permissive than the shipped Grants product):
 *   1. `open` requires a PUBLISHED closing date that has not passed — US Eastern
 *      day boundary, the closing day itself INCLUSIVE (a notice closing today is
 *      still open all of today, ET). Nothing else can make a notice open.
 *   2. A closing date before today (ET) is `closed` and hidden.
 *   3. No closing date at all is `unverified`: stored, but excluded from the
 *      default open set and NEVER expired by inference. It is never rendered as an
 *      open deadline.
 *   4. A row the source STOPPED publishing (a complete run did not see it) is
 *      hidden in the same transaction: `closed` when its own published closing date
 *      has passed, otherwise `unverified` — because we can no longer confirm it is
 *      open. A failed run writes nothing at all (fail-closed).
 *   5. Every displayed string is the source's OWN words, else null. Nothing is
 *      inferred, averaged, generated or back-filled. NAICS, the place of
 *      performance and the point of contact are carried verbatim; the 2-letter
 *      `stateCode` is a normalization of the source's own place-of-performance
 *      value and is NULL whenever it is not unambiguous.
 *   6. There is NO source timestamp (no posted date, no updated date, no
 *      dateModified, and Last-Modified equals the response time), so
 *      `sourceUpdatedAt` is ALWAYS null and `source_updated_at` stays NULL in the
 *      database. "Last verified" means OUR last successful fetch.
 *
 * IDENTITY is (source_id, external_id), where external_id is the SUBNet detail-page
 * slug — see dedupeNotices(). `naturalKey` is stored for audit and to detect a slug
 * change, and is deliberately NOT the identity: SBA amends notices in place (same
 * slug, new dates) and the same title legitimately exists twice (`…-landscaping`
 * and `…-landscaping-0`), so a natural-key-only identity would merge two real
 * notices into one.
 *
 * ISOLATION: nothing here is part of the federal/state grants experience, the Radar
 * funnel, or any grants_* / radar_* event. No pricing surface is touched.
 */
import { easternDayStart } from "~/lib/grants";
// Two PURE primitives are REUSED rather than re-implemented, so there is exactly one
// canonical day parser and one canonical content hash in the repo:
//   * parseStateDay — "11/4/2026" (SUBNet's MM/DD/YYYY form, with either 1 or 2
//     digits in either field), "2026-11-04" and "November 4, 2026" all parse; a
//     value the source did not publish returns null. (A two-digit-only pattern here
//     is what made the recon probe report "91 notices have no closing date" — see
//     the file header of subnet.ts — so the tolerant, shared parser is deliberate.)
//   * contentFingerprint — the four-lane FNV-1a content hash used for change
//     detection (never for uniqueness).
import { contentFingerprint, parseStateDay } from "~/lib/state-grants/connector";

/** The status model. `unverified` is a real bucket, not an error state. */
export type SubcontractStatus = "open" | "closed" | "unverified";

export const SUBCONTRACT_STATUSES: readonly SubcontractStatus[] = [
  "open",
  "closed",
  "unverified",
] as const;

/** Human labels, in the source's honest register (never "expired opportunity"). */
export const SUBCONTRACT_STATUS_LABELS: Record<SubcontractStatus, string> = {
  open: "Open — a published closing date that has not passed",
  closed: "Closed — the published closing date has passed",
  unverified:
    "Unverified — no published closing date, or the source no longer publishes it, so we cannot confirm it is still open",
};

export function isSubcontractStatus(value: unknown): value is SubcontractStatus {
  return typeof value === "string" && (SUBCONTRACT_STATUSES as readonly string[]).includes(value);
}

// ── The source ───────────────────────────────────────────────────────────────

export interface SubcontractSource {
  /** Stable key: `subcontract_sources.source_key`. */
  sourceKey: string;
  name: string;
  agency: string;
  officialUrl: string;
  officialHost: string;
  kind: "subnet" | "prime_directory";
  cadence: string;
  coverageTier: "unavailable" | "limited" | "curated" | "connected";
  note: string;
}

/**
 * The one source the crawler reads. `coverageTier: "connected"` means COMPLETE FOR
 * THIS SOURCE ONLY (every open notice SBA SUBNet publishes) — never "nationwide
 * subcontracting coverage", which SUBNet's sparse per-state board cannot support.
 */
export const SUBNET_SOURCE: SubcontractSource = {
  sourceKey: "sba-subnet",
  name: "SBA SUBNet — subcontracting opportunities board",
  agency: "U.S. Small Business Administration",
  officialUrl:
    "https://legacy.sba.gov/federal-contracting/contracting-guide/prime-subcontracting/subcontracting-opportunities",
  officialHost: "legacy.sba.gov",
  kind: "subnet",
  cadence: "daily (GitHub Actions, 14:00 UTC — see .github/workflows/sync-subcontracts.yml)",
  coverageTier: "connected",
  note:
    "Server-rendered Drupal index (10 rows/page) + one /opportunity/<slug> detail page per notice. No API, no JSON, no RSS, no export. Complete for the notices SUBNet publishes, and nothing more: 89 distinct primes / 35 distinct places of performance on 2026-09-25.",
};

/** The annual FY directory of primes with subcontracting plans (S2, not crawled). */
export const PRIME_DIRECTORY_SOURCE: SubcontractSource = {
  sourceKey: "sba-prime-directory",
  name: "SBA Directory of Federal Government Prime Contractors with Subcontracting Plans",
  agency: "U.S. Small Business Administration",
  officialUrl:
    "https://www.sba.gov/document/support--directory-federal-government-prime-contractors-subcontracting-plans",
  officialHost: "www.sba.gov",
  kind: "prime_directory",
  cadence: "annual (one XLSX per fiscal year, operator-loaded)",
  coverageTier: "curated",
  note:
    "Annual FPDS-derived snapshot of companies with a federal subcontracting plan — companies to approach, NOT open opportunities, and it carries no contact information. The XLSX lives under /sites/default/files/*, which legacy.sba.gov/robots.txt disallows, so it is loaded by hand rather than crawled (BUILD-PLAN §6.1 S2).",
};

export const SUBCONTRACT_SOURCES: readonly SubcontractSource[] = [
  SUBNET_SOURCE,
  PRIME_DIRECTORY_SOURCE,
];

// ── Records ──────────────────────────────────────────────────────────────────

/** One file the notice links (name + human size only — never mirrored). */
export interface SubcontractAttachment {
  name: string;
  size: string | null;
}

/**
 * A normalised-but-UNCLASSIFIED notice. Every field is the source's own value or
 * null/[] — a parser may never invent one.
 */
export interface SubcontractNotice {
  /** The connector's own id (half of the row identity) — stamped, never trusted. */
  sourceKey: string;
  /** The SUBNet detail-page slug, e.g. "dorm-common-area-landscaping". */
  externalId: string;
  title: string;
  prime: string;
  primeDivision: string | null;
  website: string | null;
  /** The notice's own description text (its scope, in the source's words). */
  scope: string | null;
  /** The notice's own "Project Summary" block, when it published one. */
  summary: string | null;
  /** "Listed scopes": the source's own NAICS description, nothing inferred. */
  trades: string[];
  /** The detail page's own "Type of Businesses Being Solicited" list. */
  certsSolicited: string[];
  /** The source's own `code: title` NAICS string, verbatim. */
  naics: string | null;
  naicsCode: string | null;
  naicsTitle: string | null;
  /** The source's own place-of-performance wording (a state name, or "Not applicable"). */
  placeOfPerformance: string | null;
  /** Normalized 2-letter code, only when placeOfPerformance is unambiguous. */
  stateCode: string | null;
  /** Source-published closing date ('YYYY-MM-DD'), null when none was published. */
  closingDate: string | null;
  performanceStartDate: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** The list page the notice was found on. */
  sourceUrl: string;
  /** The notice's own page on the official source. */
  detailUrl: string;
  attachments: SubcontractAttachment[];
  /** True when this run also fetched and parsed the detail page. */
  detailFetched: boolean;
  /** ALWAYS null — SUBNet publishes no timestamp of any kind (honesty contract 6). */
  sourceUpdatedAt: null;
  /** The parsed fields verbatim (no HTML, no invented keys). */
  raw: Record<string, unknown>;
}

/** A notice plus its classification and content fingerprint. */
export interface SubcontractNoticeRow extends SubcontractNotice {
  status: SubcontractStatus;
  statusReason: string;
  naturalKey: string;
  fingerprint: string;
}

export interface SubcontractClassification {
  status: SubcontractStatus;
  reason: string;
}

// ── Normalization (source words → a filterable column) ───────────────────────

/** The 50 states + DC, by full name, lowercased. Territories are deliberately absent. */
const STATE_NAMES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

/**
 * The source's own place-of-performance wording → a 2-letter code, or null.
 *
 * Only an EXACT full state name (or a 2-letter code the source wrote itself) maps.
 * "Not applicable" (3 live rows), a city, a multi-state list or any other wording
 * maps to NULL on purpose: a guessed state would put a notice in the wrong state
 * filter, which is exactly the kind of fabrication this feature forbids.
 */
export function stateCodeForPlace(place: string | null | undefined): string | null {
  if (typeof place !== "string") return null;
  const key = place.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  if (/^[a-z]{2}$/.test(key)) return key.toUpperCase();
  return STATE_NAMES[key] ?? null;
}

/**
 * "Listed scopes" for a notice: the source's OWN NAICS description, title-cased.
 *
 * Deliberately nothing more. The preview's `trades` filter is fed by this, and the
 * UI labels it "Listed scopes … labels reflect the notice; they are not an
 * eligibility or fit determination" — so mapping NAICS families onto invented trade
 * names ("Janitorial") would be an inference the notice did not make.
 */
export function listedScopes(naicsTitle: string | null | undefined): string[] {
  if (typeof naicsTitle !== "string") return [];
  const text = naicsTitle.trim();
  if (!text) return [];
  const label = text
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bAnd\b/g, "and");
  return [label];
}

/** "561730: Landscaping Services" → the source's code and title, or nulls. */
export function splitNaics(naics: string | null | undefined): {
  code: string | null;
  title: string | null;
} {
  if (typeof naics !== "string") return { code: null, title: null };
  const text = naics.trim();
  if (!text) return { code: null, title: null };
  const m = /^(\d{2,6})\s*[:\-–]\s*(.+)$/.exec(text);
  if (m) return { code: m[1]!, title: m[2]!.trim() };
  return { code: null, title: text };
}

/**
 * The audit key: md5-hex of (source list URL | prime | title | closing date).
 *
 * NOT the identity (see the file header). Computed with the repo's dependency-free
 * content hash so the pure module stays pure; the column is TEXT and the value is
 * stable across runs, which is all the audit use needs.
 */
export function naturalKeyFor(parts: {
  sourceUrl: string;
  prime: string;
  title: string;
  closingDate: string | null;
}): string {
  return contentFingerprint({
    sourceUrl: parts.sourceUrl,
    prime: parts.prime.toLowerCase(),
    title: parts.title.toLowerCase(),
    closingDate: parts.closingDate,
  });
}

// ── Classification ───────────────────────────────────────────────────────────

/** `YYYY-MM-DD` → the UTC-midnight epoch of that day (null when unusable). */
export function dayEpoch(day: string | null): number | null {
  const parsed = parseStateDay(day);
  if (parsed === null) return null;
  return Date.parse(`${parsed}T00:00:00Z`);
}

/**
 * The freshness decision for one notice.
 *
 * TRUTH TABLE (in evaluation order):
 *   1. a published closing date >= today (ET, closing day inclusive) → open
 *   2. a published closing date <  today (ET)                        → closed
 *   3. no published closing date                                     → unverified
 *
 * `now` is the one clock for the whole run. The boundary is the start of the
 * current US Eastern day (easternDayStart), so 11 notices closing 2026-09-25 were
 * still OPEN on 2026-09-25 and become closed at 00:00 ET on 2026-09-26.
 */
export function classifySubcontractNotice(
  notice: Pick<SubcontractNotice, "closingDate">,
  now: Date | number = new Date(),
): SubcontractClassification {
  const today = easternDayStart(now);
  const closing = dayEpoch(notice.closingDate);
  if (closing === null) {
    return {
      status: "unverified",
      reason:
        "the source published no closing date for this notice — we cannot confirm it is still accepting responses, so it is unverified and never shown as an open deadline",
    };
  }
  if (!Number.isNaN(today) && closing >= today) {
    return {
      status: "open",
      reason:
        "the source published a closing date that has not passed (the closing day itself is inclusive in US Eastern time)",
    };
  }
  return {
    status: "closed",
    reason: "the source's published closing date has passed (US Eastern day boundary)",
  };
}

/**
 * The status a row gets when a COMPLETE run did NOT see it any more.
 *
 * The honest split: its own published closing date has passed ⇒ `closed` (a fact
 * the source published). Otherwise ⇒ `unverified`, because a notice the source has
 * stopped publishing cannot be confirmed open — and it must not stay in the open
 * set. This is the only inference-free option available: SUBNet gives no
 * cancellation field and no timestamp.
 */
export function sweptStatusFor(
  closingDate: string | null,
  now: Date | number = new Date(),
): SubcontractClassification {
  const today = easternDayStart(now);
  const closing = dayEpoch(closingDate);
  if (closing !== null && !Number.isNaN(today) && closing < today) {
    return {
      status: "closed",
      reason:
        "the source no longer publishes this notice and its published closing date has passed — marked closed rather than left looking open",
    };
  }
  return {
    status: "unverified",
    reason:
      "the source no longer publishes this notice (a complete run did not see it) and no passed closing date confirms closure — hidden from the open set as unverified",
  };
}

/** Record + classification + fingerprint: the row the store writes. */
export function toNoticeRow(
  notice: SubcontractNotice,
  now: Date | number = new Date(),
): SubcontractNoticeRow {
  const classification = classifySubcontractNotice(notice, now);
  return {
    ...notice,
    status: classification.status,
    statusReason: classification.reason,
    naturalKey: naturalKeyFor(notice),
    fingerprint: contentFingerprint({
      sourceKey: notice.sourceKey,
      externalId: notice.externalId,
      title: notice.title,
      prime: notice.prime,
      primeDivision: notice.primeDivision,
      website: notice.website,
      scope: notice.scope,
      summary: notice.summary,
      trades: notice.trades,
      certsSolicited: notice.certsSolicited,
      naics: notice.naics,
      naicsCode: notice.naicsCode,
      naicsTitle: notice.naicsTitle,
      placeOfPerformance: notice.placeOfPerformance,
      stateCode: notice.stateCode,
      closingDate: notice.closingDate,
      performanceStartDate: notice.performanceStartDate,
      contactName: notice.contactName,
      contactEmail: notice.contactEmail,
      contactPhone: notice.contactPhone,
      detailUrl: notice.detailUrl,
      attachments: notice.attachments,
      raw: notice.raw,
    }),
  };
}

// ── Dedupe ───────────────────────────────────────────────────────────────────

export interface DedupeResult<T> {
  records: T[];
  /** `<source>:<external_id>` for every duplicate the payload contained. */
  collisions: string[];
}

/**
 * One record per (source, external_id) — first occurrence wins, every collision
 * reported rather than silently dropped.
 *
 * A pager can legitimately serve the same row twice (an out-of-range page redisplaying
 * page 1 on the short query form), and a notice can move between pages between two
 * requests of the same crawl, so the collapse happens here rather than being assumed.
 * An amendment arrives as the SAME (source, external_id) with different content, so it
 * is not a collision: it is one record here and one UPDATED row in the store.
 */
export function dedupeNotices<T extends { sourceKey: string; externalId: string }>(
  records: readonly T[],
): DedupeResult<T> {
  const seen = new Map<string, T>();
  const order: string[] = [];
  const collisions: string[] = [];
  for (const record of records) {
    const key = `${record.sourceKey}:${record.externalId}`;
    if (seen.has(key)) {
      collisions.push(key);
      continue;
    }
    seen.set(key, record);
    order.push(key);
  }
  return { records: order.map((k) => seen.get(k)!), collisions };
}

// ── Crawler control (pure, so the stop rules are unit-tested, not assumed) ────

/**
 * One page's effect on the crawl. The pager has TWO end-of-list shapes, both real:
 *   * past-the-end pages on the exposed-query form return a page with NO table and a
 *     `no-results` div (observed 2026-09-25, `?keyword=&state=All&op=contains&page=15`);
 *   * past-the-end pages on the short form REDISPLAY page 1 (the recon's original
 *     observation, `?page=15` → 10 rows), which is why "an empty page" cannot be the
 *     only stop signal.
 * So a crawl stops only when it sees a page that contributes NO NEW record AND
 * repeats at least one slug it has already stored — or when it hits the page cap.
 * A repeated page with a hard cap and a seen-set is the whole safety net: there is
 * no "total pages" number anywhere in the HTML to trust.
 */
export function crawlShouldStop(state: {
  /** Records this page contributed that were not already seen. */
  newRecords: number;
  /** True when at least one slug on this page was already seen earlier in the crawl. */
  repeatedSlug: boolean;
  /** True when the page carried the source's own `no-results` marker. */
  emptyMarker: boolean;
  /** Pages fetched so far (1-based). */
  pagesFetched: number;
  pageCap: number;
}): { stop: boolean; reason: string | null } {
  if (state.emptyMarker && state.newRecords === 0) {
    return { stop: true, reason: "the source returned its no-results marker (past the end of the pager)" };
  }
  if (state.newRecords === 0 && state.repeatedSlug) {
    return {
      stop: true,
      reason: "the page added no new notice and repeated an already-seen slug (the pager is redisplaying an earlier page)",
    };
  }
  if (state.pagesFetched >= state.pageCap) {
    return { stop: true, reason: `page cap reached (${state.pageCap} pages)` };
  }
  return { stop: false, reason: null };
}
