/**
 * Contrax Sync Runner
 *
 * Orchestrates bid data ingestion from all procurement sources.
 * Runs each source's fetchBids(), upserts via ON CONFLICT DO UPDATE,
 * and logs results to the sync_logs table.
 *
 * Usage:
 *   bun run src/jobs/runner.ts           (manual run)
 *   bun run sync-bids                     (via package.json script)
 *
 * Scheduling (production):
 *   GitHub Actions workflow .github/workflows/sync-bids.yml runs
 *   `bun run sync-bids` every 4 hours, every day (incl. weekends — the
 *   homepage "Newest solicitations" window is a rolling 24h) and can be
 *   triggered manually via workflow_dispatch. The Vercel cron entry for
 *   /api/sync-bids was removed — Vercel Hobby's 10s serverless cap cannot
 *   fit a multi-minute sync across 61 sources (4 SAM.gov passes, 51
 *   state-keyword queries, 6 open-data tail). /api/sync-bids remains as an
 *   admin diagnostic that returns 202 and points at the workflow.
 *
 * Performance notes:
 *   - The 51 state-keyword sources are independent SAM.gov queries (one per
 *     state filter) and run concurrently in batches of 5.
 *   - Inserts are batched into multi-row INSERTs (250 rows each) instead of
 *     one query per bid — the biggest DB win.
 *   - The 500ms inter-source sleep was dropped to a 100ms politeness delay
 *     between the serial SAM.gov passes.
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { US_STATES } from "../lib/states";
import { deriveInsertLocationColumns } from "../lib/location-state";
import { fetchBids as fetchSamGov } from "./sources/sam-gov";
import {
  createSamTradeSource,
  SAM_TRADE_FILTERS,
} from "./sources/sam-gov-trades";
import { fetchBids as fetchCities } from "./sources/cities";
import { nysSocrataSource } from "./sources/socrata";
import { createStateKeywordSource, STATE_NAMES } from "./sources/state-keyword";
import { fetchPennBidOpen } from "./sources/pennbid";
import { fetchVaEvirginia } from "./sources/va-ev";
import type { RawBid } from "./sources/sam-gov";
import { CITY_SOURCES } from "../lib/city-procurement";
import { sendBidDigest, type NewBidSummary } from "../lib/email";
import { createNotification } from "../lib/notifications";
import { generateBidAlerts } from "../lib/bid-alerts";
import { inferNaics } from "../lib/naics-infer";

/**
 * Run-record contract (owner 09-13): a source MAY return a FetchResult instead
 * of a bare row array to carry per-reason skip accounting. Sources that do not
 * opt in default to fetched = rows.length, skipped = {}, failed = [].
 *
 * Count definitions (fetched = accepted + skipped + failed):
 *   fetched  = raw source items examined (rows + every deliberate skip)
 *   accepted = passed the source's pre-insert guards AND upserted
 *              (new insert + existing-row refresh; insert errors are excluded)
 *   skipped  = dropped by a deliberate pre-insert guard, WITH a reason
 *   failed   = rows that threw at INSERT time
 */
export interface SkippedRow {
  /** Source identifier of the skipped row (e.g. PennBid ProjectID, VA noticeId). */
  id: string;
  /** Machine reason key — e.g. 'missing_id' | 'missing_title' | 'missing_agency' | 'closed' | 'not_va_pop'. */
  reason: string;
}

export interface FetchResult {
  rows: RawBid[];
  /** reason -> skip count (mirrors fetched = accepted + skipped + failed). */
  skipped: Record<string, number>;
  /** One diagnostic per skipped row, for the runner to print (id + reason). */
  skippedRows: SkippedRow[];
}

export type FetchFn = () => Promise<RawBid[] | FetchResult>;

/**
 * Quality gate (owner 09-13): MISSING_AGENCY_MAX_PCT % of fetched rows may be
 * skipped for 'missing_agency' before the run is marked fail. A source-format
 * change that strips agency fields must trip this gate instead of silently
 * shrinking coverage. ONLY the 'missing_agency' reason is gated — 'not_va_pop'
 * and friends are informational.
 */
export const MISSING_AGENCY_MAX_PCT = 25;

interface SyncSource {
  name: string;
  fetchFn: FetchFn;
}

/**
 * Concrete neon() query type. `ReturnType<typeof neon>` resolves to
 * `NeonQueryFunction<boolean, boolean>` (constraint instantiation), which is
 * not assignable from the `neon(DATABASE_URL)` call value
 * (`NeonQueryFunction<false, false>`), so pin the default type params.
 */
type Sql = NeonQueryFunction<false, false>;

/**
 * Heavy SAM.gov passes — run strictly serially to stay gentle on SAM.gov's
 * rate limits. sam_gov is the national + regional pass (with per-bid detail
 * fetches); "cities" is the SAM.gov keyword pass for municipal bids.
 */
const SAM_GOV_SOURCES: SyncSource[] = [
  {
    name: "sam_gov",
    // The regional pass is additive. Keep national records first so a bid
    // returned by both queries is represented once (and remains national).
    fetchFn: async () => {
      const national = await fetchSamGov();
      const regional = await fetchSamGov({ states: [...US_STATES] });
      const seen = new Set(national.map((bid) => bid.external_id));
      return national.concat(regional.filter((bid) => !seen.has(bid.external_id)));
    },
  },
  { name: "cities", fetchFn: fetchCities },
  // PR-B owner 09-13: repaired coverage sources — PennBid (PA freight) and
  // va_evirginia (VA place-of-performance verified). Both are serial like sam_gov
  // so their run-log/tier is stable and independently observable.
  { name: "pennbid", fetchFn: fetchPennBidOpen },
  { name: "va_evirginia", fetchFn: fetchVaEvirginia },
  // OWNER PRIORITY 09-21 (R1 — janitorial + trucking ingestion): one
  // structured-filter pass per code, each its OWN source so run logs /
  // staleness / quality gates are per-category and independently observable.
  // Janitorial: naics=561720 + psc=S201. Trucking/courier: the seven 484xxx /
  // 492110 NAICS codes + psc=V112 + psc=R602. Serial like the other SAM.gov
  // passes (SAM.gov politeness); the API filters are the ones measured to work
  // (`naics=` / `psc=`) — see the module header for the corrected PSC mapping.
  ...SAM_TRADE_FILTERS.map((filter) => ({
    name: filter.name,
    fetchFn: createSamTradeSource(filter),
  })),
];

/**
 * One keyword source per state (50 states + DC), generated from the shared
 * factory. Each hits SAM.gov with a different state filter, so the sources
 * are independent and safe to run concurrently in small batches. One state
 * failing never blocks the others (syncSource catches per-source errors).
 * Replaces the individual nc/sc/tx/fl/md-dc/va-ev sources; VA is now covered
 * by the va entry.
 */
const STATE_KEYWORD_SOURCES: SyncSource[] = US_STATES.map((code) => ({
  name: code.toLowerCase(),
  fetchFn: createStateKeywordSource(STATE_NAMES[code], code),
}));

/**
 * Everything else: NYS Socrata (state open-data portal) plus the city
 * open-data procurement portals (NYC, Chicago, LA, SF, Austin). These hit
 * different APIs, so they interleave one-at-a-time between state-keyword
 * batches — each is isolated so one failing never blocks the others.
 */
const TAIL_SOURCES: SyncSource[] = [
  { name: "nys_socrata", fetchFn: nysSocrataSource },
  ...CITY_SOURCES.map((s) => ({ name: s.name, fetchFn: s.fetch })),
];

/** State-keyword sources per concurrent batch (SAM.gov-friendly). */
const PARALLEL_BATCH_SIZE = 5;
/** Politeness delay between serial SAM.gov passes (was 500ms). */
const INTER_SOURCE_DELAY_MS = 100;
/** Rows per multi-row INSERT (17 cols × 250 rows = 4,250 params — well under Neon's limit). */
const INSERT_BATCH_SIZE = 250;

const BID_COLUMNS = [
  "title",
  "agency",
  "description",
  "location",
  "category",
  "set_aside",
  "due_date",
  "estimated_value",
  "source_url",
  "source",
  "external_id",
  "naics_code",
  "naics_code_source",
  // PR-B.2: insert-time location columns (source_jurisdiction /
  // raw_location / normalized_state / location_conflict) — derived from the
  // row's own text via src/lib/location-state.ts (never guessed), so future
  // syncs write populated rows that match what the radar computes at query time.
  "source_jurisdiction",
  "raw_location",
  "normalized_state",
  "location_conflict",
  // OWNER PRIORITY 09-21 (R2 — PRESERVE rule): the Product Service Code, the
  // notice TYPE and SAM's own solicitation number. All three are stored
  // additively (migration 047); a source that cannot supply one leaves it NULL
  // (never guessed). APPENDED after the existing columns so every positional
  // cast/index above stays valid.
  "psc",
  "notice_type",
  "solicitation_number",
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toIsoDueDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * IN-BATCH NATURAL-KEY DEDUPE (owner-authorized 2026-09-21, PR #414 follow-up).
 *
 * THE HOLE this closes: the batch INSERT below carries exactly two guards —
 *   (a) `WHERE NOT EXISTS (… lower(btrim(b.title)) = lower(btrim(v.title)) AND
 *       lower(btrim(b.agency)) = lower(btrim(v.agency)))`, which reads the table
 *       as it was BEFORE the statement, so N byte-identical rows inside ONE
 *       VALUES list all pass it; and
 *   (b) `ON CONFLICT (source, external_id)`, where external_id is `sam-${_id}`
 *       and SAM's `_id` VARIES for the same notice across results — so it never
 *       fires for a same-batch duplicate.
 * Measured in production on the first post-merge sync (run 35665413705): 76 rows
 * landed in the 11 new trade passes but only 69 were distinct — 5 duplicate
 * groups / 7 excess rows. The hole is generic: it affects EVERY source that
 * batch-inserts, not just the SAM trade passes.
 *
 * THE KEY (owner-specified, byte-identical across all 5 measured groups):
 *   lower(btrim(title)) + "\u0001" + lower(btrim(agency)) + "\u0001" +
 *   (notice_type ?? "") + "\u0001" + (due_date ? ISO string : "") + "\u0001" +
 *   (psc ?? "")
 * notice_type / due_date / psc are REQUIRED dimensions, not decoration: on
 * (title, agency) alone the key is too coarse — the live case 36C26126Q0795 has
 * an "Award Notice" AND an "Amendment 0001 …" Combined Synopsis/Solicitation for
 * the same solicitation/title/agency, and collapsing those would destroy a real,
 * separately-actionable notice. `source` is deliberately NOT part of the key:
 * a batch is already single-source, so the key mirrors the cross-source SQL
 * guard's semantics (see the VALUES-list guard comment below).
 *
 * ORDER: the batch is sorted by external_id before deduping, so which row of a
 * duplicate group is retained is deterministic (the LOWEST external_id — which
 * for `sam-<_id>` is the lowest SAM id) and independent of fetch order.
 */
function btrimLower(value: string | null | undefined): string {
  // Mirrors Postgres lower(btrim(x)): SAM's payloads pad with spaces, and this
  // key is compared against what the SQL guard computes on the same fields.
  return String(value ?? "")
    .replace(/^\s+|\s+$/g, "")
    .toLowerCase();
}

/** The in-batch natural key for one fetched row (see the block comment above). */
export function batchInsertNaturalKey(bid: RawBid): string {
  return [
    btrimLower(bid.title),
    btrimLower(bid.agency),
    bid.notice_type ?? "",
    toIsoDueDate(bid.due_date) ?? "",
    bid.psc ?? "",
  ].join("\u0001");
}

/**
 * Drop same-batch natural-key duplicates BEFORE they are turned into the INSERT
 * VALUES list. Pure and DB-free (unit-testable): given a batch of fetched rows
 * it returns a NEW array holding one canonical row per natural key — the row
 * with the LOWEST external_id, chosen deterministically by sorting first — and
 * never mutates the input. Applied per batch (per chunk, inside one source), so
 * two different sources/batches are deduped independently.
 */
export function dedupeBatchByNaturalKey(rows: readonly RawBid[]): RawBid[] {
  const byExternalId = [...rows].sort((a, b) =>
    a.external_id < b.external_id ? -1 : a.external_id > b.external_id ? 1 : 0,
  );
  const seen = new Set<string>();
  const out: RawBid[] = [];
  for (const bid of byExternalId) {
    const key = batchInsertNaturalKey(bid);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(bid);
  }
  return out;
}

export interface SyncSourceResult {
  fetched: number;
  /** Genuinely NEW rows inserted (subset of accepted). */
  new: number;
  /** Rows that passed guards and were upserted without error (new + existing refresh). */
  accepted: number;
  /** Rows that threw at INSERT time (subset of fetched, excluded from accepted). */
  failed: number;
  errors: string[];
  newBids: NewBidSummary[];
  /** reason -> skip count (informational; only 'missing_agency' is gated). */
  skipped: Record<string, number>;
  /** 'fail' when missing-agency skips exceed MISSING_AGENCY_MAX_PCT of fetched. */
  qualityGate: "pass" | "fail";
}

export interface SyncResult {
  totalFetched: number;
  totalNew: number;
  totalErrors: number;
  duration: string;
  results: Record<string, SyncSourceResult>;
  newBids: NewBidSummary[];
}

/**
 * Inserts a chunk of bids with a single multi-row INSERT.
 *
 * `(xmax = 0)` in RETURNING distinguishes genuinely new rows (xmax is 0 for a
 * freshly inserted tuple) from pre-existing rows that only got a mutable-field
 * refresh via ON CONFLICT DO UPDATE (xmax = the updating txn). Only genuinely
 * new rows are counted as "new" and returned for alerts/digests — so repeat
 * syncs no longer re-trigger notifications for already-seen bids.
 *
 * Uses sql.query() (not the tagged template) because the Neon driver rejects
 * array-of-objects fragment calls; placeholders are built manually.
 *
 * The chunk is FIRST collapsed by its natural key (dedupeBatchByNaturalKey) —
 * see that helper's block comment: the SQL guard below cannot see rows of its
 * own VALUES list, so a same-batch duplicate would otherwise insert every time.
 */
async function insertBidsBatch(
  sql: Sql,
  source: SyncSource,
  chunk: RawBid[],
): Promise<{ newCount: number; newBids: NewBidSummary[] }> {
  // In-batch natural-key dedupe (additive; the SQL guards below are unchanged).
  // Cross-BATCH duplicates of one source are already handled by the table-level
  // WHERE NOT EXISTS (each chunk is its own statement, so chunk N sees chunk
  // N-1's rows); only same-statement duplicates need this.
  const batch = dedupeBatchByNaturalKey(chunk);
  const droppedInBatch = chunk.length - batch.length;
  if (droppedInBatch > 0) {
    console.log(
      `  ${source.name}: in-batch dedupe dropped ${droppedInBatch} natural-key duplicate row(s) (${chunk.length} -> ${batch.length})`,
    );
  }
  const params: unknown[] = [];
  const valueRows: string[] = [];
  for (const bid of batch) {
    // NAICS heuristic: fill ONLY when the source provided no authoritative
    // code. Render the provenance label alongside whichever code is stored
    // (authoritative from the source, or inferred from title/description).
    const code = bid.naics_code ?? inferNaics(bid.title, bid.description);
    const codeSource = bid.naics_code ? "authoritative" : code ? "inferred" : null;
    // PR-B.2: derive the 4 additive location columns from the row's own text
    // (same conservative logic the radar read path uses — never guessed). The
    // stored `source` value is used for the source-name input so pennbid /
    // va_evirginia resolve to their curated PA / VA home jurisdictions.
    const loc = deriveInsertLocationColumns({
      location: bid.location,
      agency: bid.agency,
      title: bid.title,
      description: bid.description,
      sourceName: bid.source_label ?? source.name,
    });
    const row = [
      bid.title,
      bid.agency,
      bid.description,
      bid.location,
      bid.category,
      bid.set_aside ?? null,
      toIsoDueDate(bid.due_date),
      bid.estimated_value,
      bid.source_url,
      bid.source_label ?? source.name,
      bid.external_id,
      code,
      codeSource,
      loc.source_jurisdiction,
      loc.raw_location,
      loc.normalized_state,
      // Text-encoded boolean + explicit ::boolean cast (same driver-safety
      // pattern as the due_date ::timestamptz cast below): the untyped VALUES
      // list otherwise yields text and Postgres refuses implicit text→boolean
      // in INSERT…SELECT.
      loc.location_conflict === null ? null : loc.location_conflict ? "true" : "false",
      // OWNER 09-21 (R2): PSC / notice type / solicitation number, straight from
      // the source's own data (NULL when the source has none).
      bid.psc ?? null,
      bid.notice_type ?? null,
      bid.solicitation_number ?? null,
    ];
    // Index 6 is due_date (TIMESTAMPTZ) and index 16 is location_conflict
    // (BOOLEAN). The untyped VALUES list otherwise yields a text column, and
    // PostgreSQL refuses an implicit text→timestamptz / text→boolean cast in
    // INSERT…SELECT (it would only coerce untyped literals). Casting them here
    // mirrors the single-bid path's explicit casts so EXCLUDED and the conflict
    // guard compare timestamptz-to-timestamptz / boolean-to-boolean reliably.
    const placeholders = row
      .map((_, j) =>
        "$" +
          (params.length + j + 1) +
          (j === 6 ? "::timestamptz" : j === 16 ? "::boolean" : ""),
      )
      .join(", ");
    valueRows.push(`(${placeholders})`);
    params.push(...row);
  }

  const result = (await sql.query(
    `INSERT INTO bids (${BID_COLUMNS.join(", ")})
     SELECT * FROM (VALUES ${valueRows.join(", ")})
       AS v(title, agency, description, location, category, set_aside,
            due_date, estimated_value, source_url, source, external_id,
            naics_code, naics_code_source, source_jurisdiction, raw_location,
            normalized_state, location_conflict, psc, notice_type,
            solicitation_number)
     -- Cross-source dedup guard: skip a row whose natural key (title, agency)
     -- already exists in bids. Multiple sync sources return the SAME national
     -- solicitation (e.g. state-keyword sources va and va_evirginia), so
     -- without this the table grows duplicate rows every sync. Existing rows
     -- are untouched (provenance); only NEW duplicates are prevented.
     -- NOTE (PR #414 follow-up): this guard reads the table as it was BEFORE
     -- this statement, so it cannot see duplicate rows inside this statement's
     -- own VALUES list — that same-batch case is now closed IN MEMORY by
     -- dedupeBatchByNaturalKey, which runs before the VALUES list is built.
     -- This SQL guard is unchanged and still owns the cross-source case.
     WHERE NOT EXISTS (
       SELECT 1 FROM bids b
       WHERE lower(btrim(b.title)) = lower(btrim(v.title))
         AND lower(btrim(b.agency)) = lower(btrim(v.agency))
     )
     ON CONFLICT (source, external_id) DO UPDATE SET
       title = EXCLUDED.title,
       location = EXCLUDED.location,
       category = EXCLUDED.category,
       due_date = EXCLUDED.due_date,
       estimated_value = EXCLUDED.estimated_value,
       naics_code = COALESCE(EXCLUDED.naics_code, bids.naics_code),
       -- Track whichever code is actually retained: when the incoming code
       -- wins (incl. an inferred fill of a NULL), label it; when an existing
       -- code is kept, preserve its existing provenance label. This can never
       -- overwrite an authoritative provenance with 'inferred' because an
       -- authoritative source always supplies a non-NULL EXCLUDED code.
       naics_code_source = CASE
         WHEN EXCLUDED.naics_code IS NOT NULL THEN EXCLUDED.naics_code_source
         ELSE bids.naics_code_source
       END,
       -- PR-B.2: keep the additive location columns aligned with the row's
       -- current mutable fields (they follow location/agency/title changes).
       source_jurisdiction = EXCLUDED.source_jurisdiction,
       raw_location = EXCLUDED.raw_location,
       normalized_state = EXCLUDED.normalized_state,
       location_conflict = EXCLUDED.location_conflict,
       -- OWNER 09-21 (R2): COALESCE so a source that cannot supply the PSC /
       -- notice type / solicitation number never ERASES a value another pass
       -- already stored for this row.
       psc = COALESCE(EXCLUDED.psc, bids.psc),
       notice_type = COALESCE(EXCLUDED.notice_type, bids.notice_type),
       solicitation_number = COALESCE(EXCLUDED.solicitation_number, bids.solicitation_number),
       -- Source-freshness: advance ONLY when the compute-saver guard below
       -- concludes a real change (the WHERE clause gates the whole UPDATE, so
       -- no-op re-syncs leave updated_at untouched). Feeds the AI Executive
       -- Brief's generated_from_updated_at source-freshness comparison.
       updated_at = NOW()
     -- Compute saver: skip the rewrite when nothing the UPDATE would write
     -- actually changes. PostgreSQL rewrites the tuple (WAL + index churn)
     -- for EVERY DO UPDATE conflict even when every assigned value equals the
     -- current row, and the bulk of each 4h sync is re-upserting the same
     -- ~2,300 already-seen bids byte-identically. Guarding on the EFFECTIVE
     -- new values (the same expressions the SET writes) keeps real changes
     -- fresh while eliminating the no-op rewrites. Skipped conflicts return
     -- no row from RETURNING, so they are never miscounted as new inserts.
     -- (EXCLUDED.due_date arrives as text from the untyped VALUES list, so cast
     --  it to timestamptz to make the IS DISTINCT FROM comparison type-match.)
     WHERE (bids.title, bids.location, bids.category, bids.due_date,
            bids.estimated_value, COALESCE(EXCLUDED.naics_code, bids.naics_code),
            CASE WHEN EXCLUDED.naics_code IS NOT NULL THEN EXCLUDED.naics_code_source
                 ELSE bids.naics_code_source END,
            -- PR-B.2: plain equality on the additive columns (NOT COALESCE'd):
            -- a row whose stored columns are still NULL but whose incoming
            -- values are populated counts as a REAL change, so the first
            -- re-sync of a pre-PR-B.2 row populates its location columns;
            -- once populated (values equal), the no-op skip resumes.
            bids.source_jurisdiction, bids.raw_location, bids.normalized_state,
            bids.location_conflict,
            -- R2: plain equality (NOT COALESCE'd) on the three new provenance
            -- columns, exactly like the PR-B.2 location columns above — the
            -- first re-sync of a pre-047 row populates them (a real change),
            -- and once populated the no-op skip resumes.
            bids.psc, bids.notice_type, bids.solicitation_number)
           IS DISTINCT FROM
           (EXCLUDED.title, EXCLUDED.location, EXCLUDED.category, EXCLUDED.due_date::timestamptz,
            EXCLUDED.estimated_value, COALESCE(EXCLUDED.naics_code, bids.naics_code),
            CASE WHEN EXCLUDED.naics_code IS NOT NULL THEN EXCLUDED.naics_code_source
                 ELSE bids.naics_code_source END,
            EXCLUDED.source_jurisdiction, EXCLUDED.raw_location,
            EXCLUDED.normalized_state, EXCLUDED.location_conflict,
            COALESCE(EXCLUDED.psc, bids.psc),
            COALESCE(EXCLUDED.notice_type, bids.notice_type),
            COALESCE(EXCLUDED.solicitation_number, bids.solicitation_number))
     RETURNING id, external_id, (xmax = 0) AS inserted`,
    params,
  )) as any[];

  const bidByExternalId = new Map(batch.map((bid) => [bid.external_id, bid]));
  const newBids: NewBidSummary[] = [];
  let newCount = 0;
  for (const row of result) {
    if (!row.inserted) continue;
    newCount++;
    const bid = bidByExternalId.get(row.external_id);
    if (!bid) continue;
    newBids.push({
      bid_id: Number(row.id),
      title: bid.title,
      agency: bid.agency,
      source_url: bid.source_url,
      location: bid.location,
      due_date: bid.due_date ?? null,
      set_aside: bid.set_aside ?? null,
    });
  }
  return { newCount, newBids };
}

/** One-at-a-time fallback insert (batch failures only) with per-bid error isolation. */
async function insertBid(
  sql: Sql,
  source: SyncSource,
  bid: RawBid,
): Promise<NewBidSummary | null> {
  // Same NAICS heuristic as the batch path: fill ONLY when the source gave no
  // authoritative code, and label provenance alongside whatever code is stored.
  const code = bid.naics_code ?? inferNaics(bid.title, bid.description);
  const codeSource = bid.naics_code ? "authoritative" : code ? "inferred" : null;
  // PR-B.2: derive the 4 additive location columns (same conservative logic as
  // the batch path — never guessed).
  const loc = deriveInsertLocationColumns({
    location: bid.location,
    agency: bid.agency,
    title: bid.title,
    description: bid.description,
    sourceName: bid.source_label ?? source.name,
  });
  const result = (await sql`
    INSERT INTO bids (title, agency, description, location, category, set_aside, due_date, estimated_value, source_url, source, external_id, naics_code, naics_code_source, source_jurisdiction, raw_location, normalized_state, location_conflict, psc, notice_type, solicitation_number)
    SELECT
      ${bid.title},
      ${bid.agency},
      ${bid.description},
      ${bid.location},
      ${bid.category},
      ${bid.set_aside ?? null},
      ${toIsoDueDate(bid.due_date)}::timestamptz,
      ${bid.estimated_value},
      ${bid.source_url},
      ${bid.source_label ?? source.name},
      ${bid.external_id},
      ${code},
      ${codeSource},
      ${loc.source_jurisdiction},
      ${loc.raw_location},
      ${loc.normalized_state},
      ${loc.location_conflict === null ? null : loc.location_conflict ? "true" : "false"}::boolean,
      ${bid.psc ?? null},
      ${bid.notice_type ?? null},
      ${bid.solicitation_number ?? null}
    -- Cross-source dedup guard (same natural-key check as the batch path).
    WHERE NOT EXISTS (
      SELECT 1 FROM bids b
      WHERE lower(btrim(b.title)) = lower(btrim(${bid.title}))
        AND lower(btrim(b.agency)) = lower(btrim(${bid.agency}))
    )
    ON CONFLICT (source, external_id) DO UPDATE SET
      title = EXCLUDED.title,
      location = EXCLUDED.location,
      category = EXCLUDED.category,
      due_date = EXCLUDED.due_date,
      estimated_value = EXCLUDED.estimated_value,
      naics_code = COALESCE(EXCLUDED.naics_code, bids.naics_code),
      naics_code_source = CASE
        WHEN EXCLUDED.naics_code IS NOT NULL THEN EXCLUDED.naics_code_source
        ELSE bids.naics_code_source
      END,
      -- PR-B.2: keep the additive location columns aligned with the row's
      -- current mutable fields.
      source_jurisdiction = EXCLUDED.source_jurisdiction,
      raw_location = EXCLUDED.raw_location,
      normalized_state = EXCLUDED.normalized_state,
      location_conflict = EXCLUDED.location_conflict,
      -- R2: same COALESCE protection as the batch path (never erase a value
      -- another pass stored).
      psc = COALESCE(EXCLUDED.psc, bids.psc),
      notice_type = COALESCE(EXCLUDED.notice_type, bids.notice_type),
      solicitation_number = COALESCE(EXCLUDED.solicitation_number, bids.solicitation_number),
      updated_at = NOW()
    -- Same compute saver as the batch path: skip no-op rewrites of unchanged
    -- bids (plain equality on the additive columns — a NULL-stored row whose
    -- incoming values are populated counts as a real change). Dry: a skipped
    -- conflict returns no row (result.length === 0), so it is not treated as
    -- new.
    WHERE (bids.title, bids.location, bids.category, bids.due_date,
           bids.estimated_value, COALESCE(EXCLUDED.naics_code, bids.naics_code),
           CASE WHEN EXCLUDED.naics_code IS NOT NULL THEN EXCLUDED.naics_code_source
                ELSE bids.naics_code_source END,
           bids.source_jurisdiction, bids.raw_location, bids.normalized_state,
           bids.location_conflict, bids.psc, bids.notice_type,
           bids.solicitation_number)
          IS DISTINCT FROM
          (EXCLUDED.title, EXCLUDED.location, EXCLUDED.category, EXCLUDED.due_date,
           EXCLUDED.estimated_value, COALESCE(EXCLUDED.naics_code, bids.naics_code),
           CASE WHEN EXCLUDED.naics_code IS NOT NULL THEN EXCLUDED.naics_code_source
                ELSE bids.naics_code_source END,
           EXCLUDED.source_jurisdiction, EXCLUDED.raw_location,
           EXCLUDED.normalized_state, EXCLUDED.location_conflict,
           COALESCE(EXCLUDED.psc, bids.psc),
           COALESCE(EXCLUDED.notice_type, bids.notice_type),
           COALESCE(EXCLUDED.solicitation_number, bids.solicitation_number))
    RETURNING id, (xmax = 0) AS inserted
  `) as any[];
  if (result.length === 0 || !result[0].inserted) return null;
  return {
    bid_id: Number(result[0].id),
    title: bid.title,
    agency: bid.agency,
    source_url: bid.source_url,
    location: bid.location,
    due_date: bid.due_date ?? null,
    set_aside: bid.set_aside ?? null,
  };
}

/** Normalize a source's fetch return into the run-record shape. Bare row arrays
 *  are treated as FetchResults with no skips (sources that don't opt in). */
function toFetchResult(raw: RawBid[] | FetchResult): FetchResult {
  if (Array.isArray(raw)) return { rows: raw, skipped: {}, skippedRows: [] };
  return raw;
}

export async function syncSource(
  sql: Sql,
  source: SyncSource,
): Promise<SyncSourceResult> {
  const errors: string[] = [];
  const newBids: NewBidSummary[] = [];
  let newCount = 0;
  let failedCount = 0;
  let fetchedCount = 0;
  let acceptedCount = 0;
  let skippedCount = 0;
  let bids: RawBid[] = [];
  const skipReasons: Record<string, number> = {};
  let qualityGate: "pass" | "fail" = "pass";

  try {
    console.log(`\n📡 Fetching from ${source.name}...`);
    const fr = toFetchResult(await source.fetchFn());
    bids = fr.rows;
    skippedCount = Object.values(fr.skipped).reduce((s, n) => s + n, 0);
    fetchedCount = bids.length + skippedCount;
    Object.assign(skipReasons, fr.skipped);
    console.log(
      `  Fetched ${bids.length} bid(s) from ${source.name} (${fetchedCount} fetched incl. ${skippedCount} skipped)`,
    );
    for (const s of fr.skippedRows) {
      console.log(`  ${source.name} skip id=${s.id} reason=${s.reason}`);
    }

    for (let i = 0; i < bids.length; i += INSERT_BATCH_SIZE) {
      const chunk = bids.slice(i, i + INSERT_BATCH_SIZE);
      try {
        const { newCount: n, newBids: nb } = await insertBidsBatch(sql, source, chunk);
        newCount += n;
        newBids.push(...nb);
      } catch (e) {
        // A batch failed (e.g. one malformed row) — fall back to one-at-a-time
        // inserts so the bad row is isolated and logged without losing the
        // rest of the chunk. Single-statement atomicity means a failed batch
        // inserted nothing, so no rows are double-counted.
        for (const bid of chunk) {
          try {
            const summary = await insertBid(sql, source, bid);
            if (summary) {
              newCount++;
              newBids.push(summary);
            }
          } catch (e2) {
            failedCount++;
            const msg = `Insert error for ${bid.external_id}: ${(e2 as Error).message}`;
            errors.push(msg);
            console.error(`  ${msg}`);
          }
        }
      }
    }

    // accepted = passed guards AND upserted; rows that threw at insert are
    // 'failed', not accepted. Invariant: fetched = accepted + skipped + failed.
    acceptedCount = bids.length - failedCount;

    // Quality gate: only 'missing_agency' is gated (a format change that strips
    // agency fields must trip the gate instead of silently shrinking coverage).
    const missingAgency = skipReasons["missing_agency"] ?? 0;
    qualityGate =
      fetchedCount > 0 && (missingAgency / fetchedCount) * 100 > MISSING_AGENCY_MAX_PCT
        ? "fail"
        : "pass";
    if (qualityGate === "fail") {
      console.error(
        `  ⛔ ${source.name}: QUALITY GATE FAIL — ${missingAgency}/${fetchedCount} fetched rows skipped 'missing_agency' (>${MISSING_AGENCY_MAX_PCT}%) — source format may have changed`,
      );
    }
    const invariantHolds =
      fetchedCount === acceptedCount + skippedCount + failedCount;
    if (!invariantHolds) {
      console.error(
        `  ⚠️ ${source.name}: run-record invariant broken (fetched ${fetchedCount} != accepted ${acceptedCount} + skipped ${skippedCount} + failed ${failedCount})`,
      );
    }

    console.log(
      `  ${source.name}: ${newCount} new, ${acceptedCount - newCount} existing/dup, ${skippedCount} skipped, ${failedCount} failed`,
    );
  } catch (e) {
    const msg = `Source error for ${source.name}: ${(e as Error).message}`;
    errors.push(msg);
    console.error(`  ${msg}`);
  }

  // Log to sync_logs + collector_run_log (PR-B: honest run provenance — ran_zero
  // distinguishes "ran and returned zero" from "never ran"; staleness tiers read
  // from this). A fetched>>new signature (the PA 11->0 collapse pattern) is
  // written to collector_collapse_log so it is alarmed, never silent.
  // Owner 09-13: the run record carries fetched/accepted/skipped/failed counts,
  // the skip_reasons map, and the quality gate verdict.
  try {
    await sql`
      INSERT INTO sync_logs (source, fetched, new, errors, created_at)
      VALUES (${source.name}, ${fetchedCount}, ${newCount}, ${errors.join("; ") || null}, NOW())
    `;
    await sql`
      INSERT INTO collector_run_log
        (source, ran_at, rows_fetched, rows_new, ran_zero, errors,
         fetched_count, accepted_count, skipped_count, failed_count,
         skip_reasons, quality_gate)
      VALUES (${source.name}, NOW(), ${fetchedCount}, ${newCount}, ${fetchedCount === 0}, ${errors.length},
              ${fetchedCount}, ${acceptedCount}, ${skippedCount}, ${failedCount},
              ${JSON.stringify(skipReasons)}::jsonb, ${qualityGate})
    `;
    if (fetchedCount > 0 && newCount === 0) {
      await sql`
        INSERT INTO collector_collapse_log (source, occurred_at, rows_fetched, rows_new, note)
        VALUES (${source.name}, NOW(), ${fetchedCount}, ${newCount},
          ${`sources fetched but no new rows persisted (visible-result collapse signature); inspect collector_collapse_alert`})
      `;
    }
  } catch (e) {
    console.error(`  Failed to log sync for ${source.name}:`, (e as Error).message);
  }

  return {
    fetched: fetchedCount,
    new: newCount,
    accepted: acceptedCount,
    failed: failedCount,
    errors,
    newBids,
    skipped: skipReasons,
    qualityGate,
  };
}

export async function runSync(): Promise<SyncResult> {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  const sql = neon(DATABASE_URL);

  const allSources = [...SAM_GOV_SOURCES, ...STATE_KEYWORD_SOURCES, ...TAIL_SOURCES];
  console.log("🚀 Contrax Sync Runner");
  console.log(`   Started: ${new Date().toISOString()}`);
  console.log(`   Sources: ${allSources.map((s) => s.name).join(", ")}`);

  // Idempotent migration — once up front instead of once per source.
  await sql`ALTER TABLE bids ADD COLUMN IF NOT EXISTS naics_code TEXT`;
  // Provenance label for naics_code: 'authoritative' (source-supplied, e.g.
  // SAM.gov) vs 'inferred' (heuristic tag from title/description). Used by the
  // honest-enforcement path so any surfaced NAICS can be labeled as inferred.
  await sql`ALTER TABLE bids ADD COLUMN IF NOT EXISTS naics_code_source TEXT`;
  // Source-freshness for the AI Executive Brief (idempotent self-heal mirrors
  // db/migrations/015_ai_summary.sql). Synced by updated_at = NOW() in the
  // upsert paths above whenever a real change is detected.
  await sql`ALTER TABLE bids ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;

  // Functional (non-unique) index backing the cross-source dedup guard in
  // insertBidsBatch / insertBid, whose WHERE NOT EXISTS filters on
  // lower(btrim(title)), lower(btrim(agency)). Non-unique on purpose: we do
  // NOT mass-delete the ~11k existing duplicate rows (provenance preserved),
  // but this index stops NEW inserts from duplicating an existing
  // solicitation and keeps the existence check fast.
  await sql`CREATE INDEX IF NOT EXISTS idx_bids_natural_key ON bids (lower(btrim(title)), lower(btrim(agency)))`;

  const startTime = Date.now();
  const results: Record<string, SyncSourceResult> = {};

  // Phase 1 — heavy SAM.gov passes, serial (national → regional → city keyword).
  for (const source of SAM_GOV_SOURCES) {
    results[source.name] = await syncSource(sql, source);
    await sleep(INTER_SOURCE_DELAY_MS);
  }

  // Phase 2 — state-keyword sources in concurrent batches of 5 (each an
  // independent SAM.gov query with a different state filter). Tail sources
  // (NYS + city open-data portals, different APIs) interleave one at a time
  // between state batches so they progress without ever running two at once.
  let tailIndex = 0;
  for (let i = 0; i < STATE_KEYWORD_SOURCES.length; i += PARALLEL_BATCH_SIZE) {
    const batch = STATE_KEYWORD_SOURCES.slice(i, i + PARALLEL_BATCH_SIZE);
    const jobs = batch.map((source) => syncSource(sql, source));
    let tailSource: SyncSource | null = null;
    if (tailIndex < TAIL_SOURCES.length) {
      tailSource = TAIL_SOURCES[tailIndex++];
      jobs.push(syncSource(sql, tailSource));
    }
    const batchResults = await Promise.all(jobs);
    batch.forEach((source, idx) => {
      results[source.name] = batchResults[idx];
    });
    if (tailSource) {
      // The tail source's job was appended after the batch jobs, so its
      // result sits at index batch.length — record it so its new bids count
      // toward totals, alerts and digests.
      results[tailSource.name] = batchResults[batch.length];
    }
  }
  // Safety net for any tail sources left after the final state batch.
  for (; tailIndex < TAIL_SOURCES.length; tailIndex++) {
    const source = TAIL_SOURCES[tailIndex];
    results[source.name] = await syncSource(sql, source);
    await sleep(INTER_SOURCE_DELAY_MS);
  }

  const totalFetched = Object.values(results).reduce((s, r) => s + r.fetched, 0);
  const totalNew = Object.values(results).reduce((s, r) => s + r.new, 0);
  const totalErrors = Object.values(results).reduce((s, r) => s + r.errors.length, 0);
  const allNewBids: NewBidSummary[] = Object.values(results).flatMap((r) => r.newBids);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n✅ Sync complete in ${duration}s`);
  console.log(`   Total fetched: ${totalFetched}`);
  console.log(`   New bids: ${totalNew}`);
  console.log(`   Errors: ${totalErrors}`);

  if (totalErrors > 0) {
    console.log("\n⚠️  Errors encountered:");
    for (const [source, r] of Object.entries(results)) {
      for (const err of r.errors) {
        console.log(`   [${source}] ${err}`);
      }
    }
  }

  // Surface quality-gate failures at the run level (owner 09-13).
  for (const [source, r] of Object.entries(results)) {
    if (r.qualityGate === "fail") {
      console.error(`   ⛔ [${source}] QUALITY GATE FAIL — latest collector_run_log row carries quality_gate='fail'`);
    }
  }

  // Generate durable in-app bid alerts for every matching profile.
  if (totalNew > 0) {
    try { console.log(`🔔 Created ${await generateBidAlerts(allNewBids.map((b) => b.bid_id as number))} durable bid alert(s)`); }
    catch (err) { console.error("🔔 Failed to generate bid alerts:", (err as Error).message); }
  }

  // Notify matching profiles without allowing notification failures to break sync.
  if (totalNew > 0) {
    try {
      const profiles = await sql`SELECT user_id, industry, locations, service_categories, certifications FROM business_profiles WHERE user_id IS NOT NULL` as any[];
      let notified = 0;
      for (const bid of allNewBids) {
        const text = `${bid.title} ${bid.agency} ${bid.location || ""}`.toLowerCase();
        for (const profile of profiles) {
          const locations = Array.isArray(profile.locations) ? profile.locations : [];
          const services = Array.isArray(profile.service_categories) ? profile.service_categories : [];
          const industry = String(profile.industry || "").toLowerCase();
          const certifications = typeof profile.certifications === "string"
            ? (() => {
                try { return JSON.parse(profile.certifications); } catch { return []; }
              })()
            : profile.certifications;
          const profileCertifications = Array.isArray(certifications)
            ? certifications.filter((cert: unknown): cert is string => typeof cert === "string" && cert.trim().length > 0)
            : [];
          const setAside = String(bid.set_aside || "").toLowerCase();
          const matches = setAside && profileCertifications.length > 0
            ? profileCertifications.some((cert) => setAside.includes(cert.toLowerCase()) || cert.toLowerCase().includes(setAside))
            : !industry || text.includes(industry) || services.some((s: unknown) => text.includes(String(s).toLowerCase())) || locations.some((l: unknown) => text.includes(String(l).toLowerCase()));
          if (matches) {
            await createNotification({ userId: Number(profile.user_id), type: "new_bid_match", title: "New bid matches your profile", message: `"${bid.title}" from ${bid.agency} matches your business profile.`, bidId: bid.bid_id });
            notified++;
          }
        }
      }
      console.log(`🔔 Created ${notified} bid match notification(s)`);
    } catch (err) {
      console.error("🔔 Failed to create bid match notifications:", (err as Error).message);
    }
  }

  // ── Send bid digest email ────────────────────────────────────────────────
  if (totalNew > 0) {
    try {
      const userRows = await sql`SELECT email FROM users` as { email: string }[];
      if (userRows.length > 0) {
        const userEmails = userRows.map((r) => r.email);
        console.log(`\n📧 Sending bid digest to ${userEmails.length} user(s)...`);
        await sendBidDigest(userEmails, allNewBids);
      } else {
        console.log("\n📧 No users found in DB — skipping bid digest");
      }
    } catch (err) {
      console.error(
        "\n📧 Failed to query users for bid digest:",
        (err as Error).message,
      );
    }
  }

  return {
    totalFetched,
    totalNew,
    totalErrors,
    duration,
    results,
    newBids: allNewBids,
  };
}

async function main() {
  try {
    await runSync();
    console.log("\n🏁 Runner finished successfully");
    process.exit(0);
  } catch (err) {
    console.error("\n💥 Runner crashed:", err);
    process.exit(1);
  }
}

// Only run the CLI entrypoint when this file is executed directly
// (e.g. `bun run src/jobs/runner.ts`). When imported — the legacy inline
// /api/sync-bids Vercel-cron handlers were removed (sync-bids cleanup), and
// nothing imports runner.ts today — import.meta.main is undefined in the
// server bundle, so main() must not run (it would trigger a full sync and
// call process.exit(), killing the importing process). Kept as a defensive
// guard.
if ((import.meta as ImportMeta & { main?: boolean }).main) {
  main();
}
