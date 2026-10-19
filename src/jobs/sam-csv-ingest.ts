/**
 * SAM.gov NIGHTLY CSV INGEST — CLI entrypoint (`bun run sam-csv-ingest`).
 *
 * Owner-approved 2026-10-19 ("Build it."), spec:
 * shared/sam-csv-ingest-spec-2026-10-19.md. Runs from
 * .github/workflows/sync-sam-csv.yml at 04:30 UTC (SAM regenerates the file
 * ~03:30 UTC), i.e. before the 06:00 Eastern morning emails. The every-4-hours
 * SAM.gov search sync is deliberately UNTOUCHED: it owns same-day new bids.
 *
 *   curl -sSL "$SAM_CSV_URL" | bun run sam-csv-ingest
 *
 * WHAT IT DOES, IN ORDER
 * ----------------------
 *  1. STREAM stdin (never the whole 201.8 MB file — spec §Engineering): the
 *     incremental record splitter in ./sam-csv.ts turns chunks into rows.
 *  2. Keep only rows that are live opportunities under the counter's own
 *     definition: a parsable deadline whose UTC date is today or later, and not
 *     an award / justification notice (spec §Filters).
 *  3. TOTALSTATES IS OBSERVED, NEVER GATED (owner 2026-10-19): compute the state
 *     set the /map + homepage counter would show before and after this run, plus
 *     each state's open-count delta in BOTH directions. A change is logged
 *     prominently and alerted (email + notification artifact) and the import
 *     ALWAYS CONTINUES — it never fails, and never writes nothing, because the
 *     count moved. The count follows the REAL data.
 *  4. Batch-upsert (500/row statement) `ON CONFLICT (source, external_id)` — the
 *     SAME identity the 4-hourly sync writes (`sam-<NoticeId>`) — with the
 *     runner's no-op guard (`IS DISTINCT FROM`, extended with this job's two
 *     date columns and `closed_at`), so only genuinely new or changed rows are
 *     written and only genuinely new rows are counted as new.
 *  4b. NATURAL-KEY SAFETY (post-merge fix, first real run 2026-10-19 03:05 UTC):
 *     the kept stream is deduped on the FIVE-column tuple of
 *     `idx_bids_natural_key_unique` BEFORE the VALUES list is built, and the
 *     cross-source guard compares that same five-column tuple (scoped to the
 *     index's frozen `created_at >= 2026-09-22` predicate). A row whose tuple an
 *     existing row already holds is SKIPPED, counted and logged — never an
 *     abort. Before this, two NoticeIds sharing one tuple inside a single
 *     500-row statement killed the whole run with 23505 and wrote zero rows.
 *  5. CLOSE OUT rows whose deadline passed, or which vanished from tonight's
 *     file, without ever touching a row stored after the extract was generated
 *     (a same-day 4h-sync bid).
 *
 * Read paths never see this module: it writes what the existing pages already
 * read (`bids`), which is what makes the homepage counter move on its own.
 *
 * Env: DATABASE_URL (required). Optional: SAM_CSV_EXTRACT_TIME (ISO; the S3
 * object's Last-Modified, used for the close-out fence), SAM_CSV_REPORT_ONLY=1
 * (parse + report + exit, write nothing — used for the dry run).
 */
import {
  createCsvRecordStream,
  csvHeaderIndex,
  csvNoticeToBid,
  dedupeKeptRowsByNaturalKey,
  describeStateSetChange,
  isAwardOrJustificationType,
  isOpenDeadline,
  keptRowCounterStats,
  NATURAL_KEY_INDEX,
  NATURAL_KEY_SCOPE_SQL,
  parseDeadline,
  parseSamCsvRecord,
  projectStates,
  SAM_CSV_SOURCE,
  stateCodeFromLocation,
  stateOpenCountDeltas,
  type SamCsvBidRow,
  type SamCsvNotice,
} from "./sam-csv";
import { alertCounterStateChange, counterStateChangeReport } from "./sam-csv-state-alert";
import { sql } from "~/db";
import { OPEN_BID_SQL, AWARD_NOTICE_EXCLUSION_SQL } from "~/lib/open-bids";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { LOW_CONTENT_SQL } from "~/lib/low-content";

export const BATCH_SIZE = 500;

/** The columns this job writes, in VALUES order. */
const WRITE_COLUMNS = [
  "title",
  "agency",
  "description",
  "location",
  "category",
  "due_date",
  "estimated_value",
  "source_url",
  "source",
  "external_id",
  "set_aside",
  "naics_code",
  "psc",
  "notice_type",
  "solicitation_number",
  "source_jurisdiction",
  "raw_location",
  "normalized_state",
  "posted_date",
  "archive_date",
] as const;

/** Postgres types the untyped VALUES list must be cast to (index → cast). */
const CASTS: Record<number, string> = {
  5: "::timestamptz", // due_date
  18: "::date", // posted_date
  19: "::date", // archive_date
};

export interface IngestSummary {
  csvRows: number;
  kept: number;
  skipped: Record<string, number>;
  batches: number;
  inserted: number;
  updated: number;
  unchanged: number;
  /** Rows refused because an existing row already holds their natural-key tuple. */
  skippedNaturalKey: number;
  /** Rows collapsed in-stream because two NoticeIds share one natural-key tuple. */
  naturalKeyDuplicates: number;
  closed: number;
  projectedStates: ReturnType<typeof projectStates>;
  reportOnly: boolean;
}

/** Parse the stream into the rows this job would store (streaming, in memory bounded by the kept rows only). */
export async function readSamCsv(input: AsyncIterable<string | Uint8Array>): Promise<{
  rows: SamCsvBidRow[];
  csvRows: number;
  skipped: Record<string, number>;
  duplicateIds: number;
  /** Rows collapsed because they share the UNIQUE index's 5-column tuple (post-merge fix). */
  naturalKeyDuplicates: number;
  /** How many natural-key groups held more than one NoticeId. */
  naturalKeyGroups: number;
}> {
  const stream = createCsvRecordStream();
  const decoder = new TextDecoder();
  const rows: SamCsvBidRow[] = [];
  const skipped: Record<string, number> = {};
  const seen = new Set<string>();
  let index: Map<string, number> | null = null;
  let csvRows = 0;
  let duplicateIds = 0;

  const handle = (records: string[][]) => {
    for (const record of records) {
      if (!index) {
        // The header is the first record of the file; a leading blank line is
        // tolerated because the extract starts with one.
        if (record.every((f) => f.trim() === "")) continue;
        index = csvHeaderIndex(record);
        continue;
      }
      if (record.every((f) => f.trim() === "")) continue;
      csvRows++;
      const notice = parseSamCsvRecord(record, index);
      if (!notice) {
        skipped.unusable_row = (skipped.unusable_row ?? 0) + 1;
        continue;
      }
      if (seen.has(notice.noticeId)) {
        duplicateIds++;
        skipped.duplicate_notice_id = (skipped.duplicate_notice_id ?? 0) + 1;
        continue;
      }
      seen.add(notice.noticeId);
      const bid = csvNoticeToBid(notice);
      if (!bid) {
        const reason = awardOrPast(notice);
        skipped[reason] = (skipped[reason] ?? 0) + 1;
        continue;
      }
      rows.push(bid);
    }
  };

  for await (const chunk of input) {
    handle(stream.push(typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true })));
  }
  handle(stream.end());

  // ── IN-STREAM NATURAL-KEY DEDUPE (post-merge regression fix, 2026-10-19) ───
  // The extract holds DISTINCT NoticeIds whose (title, agency, notice_type,
  // due_date, psc) tuple is IDENTICAL. The old title+agency pre-filter could not
  // see a sibling row inside the SAME 500-row statement, so two colliders landed
  // in one batch and the whole run aborted with 23505 on
  // idx_bids_natural_key_unique — zero rows written. Collapsing the kept stream
  // on the index's OWN tuple BEFORE the VALUES list is built makes that
  // structurally impossible: a natural-key tuple appears at most once per run.
  const dedupe = dedupeKeptRowsByNaturalKey(rows);
  if (dedupe.dropped.length > 0) {
    skipped.natural_key_duplicate = dedupe.dropped.length;
  }
  return {
    rows: dedupe.rows,
    csvRows,
    skipped,
    duplicateIds,
    naturalKeyDuplicates: dedupe.dropped.length,
    naturalKeyGroups: dedupe.groups,
  };
}

/** The skip reason for a notice that produced no row (kept visible in the log). */
function awardOrPast(notice: SamCsvNotice): string {
  if (isAwardOrJustificationType(notice.noticeType)) return "award_or_justification";
  if (!notice.responseDeadline) return "missing_deadline";
  return parseDeadline(notice.responseDeadline) && isOpenDeadline(notice.responseDeadline)
    ? "unusable_row"
    : "past_deadline";
}

/** The live counter population's state set — the BEFORE side of the owner's gate. */
export async function liveCounterStates(): Promise<{
  states: string[];
  /** Open rows per state code — the counter's OWN before-side counts. */
  counts: Record<string, number>;
  totalOpen: number;
}> {
  const q = sql();
  const rows = (await q`
    SELECT location FROM bids
    WHERE ${q.unsafe(OPEN_BID_SQL)}
      AND ${q.unsafe(LOW_CONTENT_SQL)}
      AND ${q.unsafe(AWARD_EXCLUSION_SQL)}
      AND ${q.unsafe(AWARD_NOTICE_EXCLUSION_SQL)}
  `) as { location: string | null }[];
  const states = new Set<string>();
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const code = stateCodeFromLocation(r.location);
    if (code) {
      states.add(code);
      counts[code] = (counts[code] ?? 0) + 1;
    }
  }
  return { states: [...states], counts, totalOpen: rows.length };
}

/**
 * ── THE CROSS-SOURCE NATURAL-KEY GUARD: THE INDEX'S OWN FIVE COLUMNS ─────────
 *
 * The pre-merge guard compared (title, agency) only. The UNIQUE index
 * (db/migrations/048_bids_natural_key_unique.sql) is a FIVE-column tuple with a
 * frozen `created_at >=` predicate, so a (title, agency) match was BOTH
 * over-aggressive (a same title+agency row with a DIFFERENT due_date or psc is
 * NOT a duplicate on the index and must be inserted) and under-guarded (it could
 * not see a sibling in its own VALUES list). This predicate mirrors the index
 * exactly:
 *   lower(btrim(title)), lower(btrim(agency)), COALESCE(notice_type, ''),
 *   due_date (IS NOT DISTINCT FROM — the index is NULLS NOT DISTINCT),
 *   COALESCE(psc, '')
 * scoped to `b.created_at >= NATURAL_KEY_SCOPE_SQL` (rows before the frozen
 * cutover are grandfathered and are NOT enforced by the index — refusing an
 * insert against one would lose a row the database would have accepted).
 *
 * SELF-EXCLUSION (owner fix 2026-10-10, eVA staleness): the row's OWN identity is
 * excluded, so a re-fetch of an already-stored notice still reaches
 * `ON CONFLICT (source, external_id) DO UPDATE` and refreshes in place.
 */
export const NATURAL_KEY_GUARD_SQL = `
      lower(btrim(b.title)) = lower(btrim(v.title))
        AND lower(btrim(b.agency)) = lower(btrim(v.agency))
        AND COALESCE(b.notice_type, '') = COALESCE(v.notice_type, '')
        AND b.due_date IS NOT DISTINCT FROM v.due_date::timestamptz
        AND COALESCE(b.psc, '') = COALESCE(v.psc, '')
        AND b.created_at >= ${NATURAL_KEY_SCOPE_SQL}
        AND NOT (b.source = v.source AND b.external_id = v.external_id)`;

export interface BatchOutcome {
  inserted: number;
  updated: number;
  unchanged: number;
  /**
   * Rows the guard REFUSED because an existing row (any source, inside the
   * index's scope) already holds their natural-key tuple. Logged and counted —
   * never an error, never an abort.
   */
  skippedNaturalKey: number;
}

/**
 * One batch upsert, in ONE statement. Returns how many rows were genuinely
 * inserted, refreshed, skipped-as-identical and skipped as natural-key
 * collisions — the `xmax = 0` trick the runner uses, plus the no-op guard's own
 * silence for unchanged rows, plus the collision count the `colliding` CTE adds.
 *
 * The `colliding` CTE exists because a row refused by the WHERE NOT EXISTS never
 * reaches RETURNING, so it would otherwise be indistinguishable from an
 * unchanged row. Counting it in the same statement keeps one round trip per
 * batch and reports the skip honestly.
 */
export async function upsertBatch(batch: readonly SamCsvBidRow[]): Promise<BatchOutcome> {
  if (batch.length === 0) return { inserted: 0, updated: 0, unchanged: 0, skippedNaturalKey: 0 };
  const q = sql();
  const params: unknown[] = [];
  const valueRows: string[] = [];
  for (const row of batch) {
    const values: unknown[] = [
      row.title,
      row.agency,
      row.description,
      row.location,
      row.category,
      row.due_date,
      row.estimated_value,
      row.source_url,
      SAM_CSV_SOURCE,
      row.external_id,
      row.set_aside,
      row.naics_code,
      row.psc,
      row.notice_type,
      row.solicitation_number,
      row.source_jurisdiction,
      row.raw_location,
      row.normalized_state,
      row.posted_date,
      row.archive_date,
    ];
    const placeholders = values
      .map((_, j) => `$${params.length + j + 1}${CASTS[j] ?? ""}`)
      .join(", ");
    valueRows.push(`(${placeholders})`);
    params.push(...values);
  }

  const text = `
    INSERT INTO bids (${WRITE_COLUMNS.join(", ")})
    SELECT * FROM (VALUES ${valueRows.join(", ")})
      AS v(title, agency, description, location, category, due_date,
           estimated_value, source_url, source, external_id, set_aside,
           naics_code, psc, notice_type, solicitation_number,
           source_jurisdiction, raw_location, normalized_state, posted_date,
           archive_date)
    WHERE NOT EXISTS (
      SELECT 1 FROM bids b
      WHERE ${NATURAL_KEY_GUARD_SQL}
    )
      ON CONFLICT (source, external_id) DO UPDATE SET
        title = EXCLUDED.title,
        description = CASE WHEN EXCLUDED.description <> '' THEN EXCLUDED.description ELSE bids.description END,
        location = EXCLUDED.location,
        category = EXCLUDED.category,
        due_date = EXCLUDED.due_date,
        set_aside = COALESCE(EXCLUDED.set_aside, bids.set_aside),
        naics_code = COALESCE(EXCLUDED.naics_code, bids.naics_code),
        psc = COALESCE(EXCLUDED.psc, bids.psc),
        notice_type = COALESCE(EXCLUDED.notice_type, bids.notice_type),
        solicitation_number = COALESCE(EXCLUDED.solicitation_number, bids.solicitation_number),
        agency = EXCLUDED.agency,
        source_url = EXCLUDED.source_url,
        source_jurisdiction = EXCLUDED.source_jurisdiction,
        raw_location = EXCLUDED.raw_location,
        normalized_state = EXCLUDED.normalized_state,
        posted_date = EXCLUDED.posted_date,
        archive_date = EXCLUDED.archive_date,
        -- A notice that is BACK in tonight's file is open again.
        closed_at = NULL,
        updated_at = NOW()
      -- NO-OP GUARD (the runner's compute saver, extended with this job's columns):
      -- only rewrite a row when a value this statement would write actually
      -- differs. Identical rows return nothing from RETURNING, so they are never
      -- counted as new and cost no CU.
      WHERE (bids.title, bids.location, bids.category, bids.due_date,
             bids.set_aside, bids.naics_code, bids.psc, bids.notice_type,
             bids.agency, bids.source_url, bids.normalized_state,
             bids.posted_date, bids.archive_date, bids.closed_at)
          IS DISTINCT FROM
            (EXCLUDED.title, EXCLUDED.location, EXCLUDED.category, EXCLUDED.due_date,
             COALESCE(EXCLUDED.set_aside, bids.set_aside),
             COALESCE(EXCLUDED.naics_code, bids.naics_code),
             COALESCE(EXCLUDED.psc, bids.psc),
             COALESCE(EXCLUDED.notice_type, bids.notice_type),
             EXCLUDED.agency, EXCLUDED.source_url, EXCLUDED.normalized_state,
             EXCLUDED.posted_date, EXCLUDED.archive_date, NULL::timestamptz)
      RETURNING (xmax = 0) AS inserted`;

  const returned = (await q.query(text, params)) as { inserted: boolean }[];
  const inserted = returned.filter((r) => r.inserted).length;
  // The rows the guard REFUSED never reach RETURNING, so the skip is counted by
  // its own read over the same batch (a refused row and an unchanged row would
  // otherwise be indistinguishable from the row count alone). One jsonb
  // parameter, so the five-column predicate is planned against the columns it
  // compares by name.
  const skippedNaturalKey = await countNaturalKeyCollisions(batch);
  return {
    inserted,
    updated: returned.length - inserted,
    unchanged: batch.length - returned.length - skippedNaturalKey,
    skippedNaturalKey,
  };
}

/**
 * How many of this batch's rows have their natural-key tuple ALREADY held by an
 * existing row (any source, inside the index's frozen scope). SELECT-only, and
 * the same five columns/scopes as `NATURAL_KEY_GUARD_SQL` — which is what makes
 * the run log's "skipped (natural-key collision)" count the predicate the writer
 * itself applied.
 */
export async function countNaturalKeyCollisions(batch: readonly SamCsvBidRow[]): Promise<number> {
  if (batch.length === 0) return 0;
  const q = sql();
  const payload = JSON.stringify(
    batch.map((r) => ({
      external_id: r.external_id,
      title: r.title,
      agency: r.agency,
      notice_type: r.notice_type ?? "",
      due_date: r.due_date,
      psc: r.psc ?? "",
    })),
  );
  const rows = (await q.query(
    `WITH v AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS t(
         external_id text, title text, agency text, notice_type text,
         due_date text, psc text)
     )
     SELECT count(*)::int AS n FROM v
     WHERE EXISTS (
       SELECT 1 FROM bids b
       WHERE lower(btrim(b.title)) = lower(btrim(v.title))
         AND lower(btrim(b.agency)) = lower(btrim(v.agency))
         AND COALESCE(b.notice_type, '') = v.notice_type
         AND to_char(b.due_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = v.due_date
         AND COALESCE(b.psc, '') = v.psc
         AND b.created_at >= ${NATURAL_KEY_SCOPE_SQL}
         AND NOT (b.source = '${SAM_CSV_SOURCE}' AND b.external_id = v.external_id)
     )`,
    [payload],
  )) as { n: number }[];
  return Number(rows[0]?.n) || 0;
}

/**
 * True when a failed statement was rejected by the natural-key UNIQUE INDEX
 * (migration 048). Same two conditions as `isNaturalKeyViolation` in
 * src/jobs/runner.ts (message-matched on purpose: the Neon HTTP driver's error
 * shape is not guaranteed to carry `code`, and the index name is what identifies
 * it). Kept local so this job does not import the whole 73-source runner graph.
 */
export function isNaturalKeyViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return (
    /duplicate key value violates unique constraint/i.test(message) &&
    message.includes(NATURAL_KEY_INDEX)
  );
}

function combineOutcome(a: BatchOutcome, b: BatchOutcome): BatchOutcome {
  return {
    inserted: a.inserted + b.inserted,
    updated: a.updated + b.updated,
    unchanged: a.unchanged + b.unchanged,
    skippedNaturalKey: a.skippedNaturalKey + b.skippedNaturalKey,
  };
}

/**
 * The batch writer the run uses: `upsertBatch`, plus a SAFETY NET for the one
 * failure mode that took the first real run down.
 *
 * The in-stream dedupe makes a same-statement natural-key collision structurally
 * impossible, and the SQL guard mirrors the index column-for-column. This wrapper
 * exists so that a FUTURE divergence between the two (a new key dimension, a
 * changed index predicate, a normalization difference between JS `trim()` and
 * Postgres `btrim()`) degrades into "a few rows skipped and logged" instead of
 * "the nightly ingest wrote NOTHING".
 *
 * It bisects the rejected batch until the surviving rows land; a one-row
 * statement that still collides is counted as a natural-key skip (never silently
 * dropped, never rethrown as a run failure).
 */
export async function upsertBatchResilient(batch: readonly SamCsvBidRow[]): Promise<BatchOutcome> {
  if (batch.length === 0) return { inserted: 0, updated: 0, unchanged: 0, skippedNaturalKey: 0 };
  try {
    return await upsertBatch(batch);
  } catch (e) {
    if (!isNaturalKeyViolation(e)) throw e;
    if (batch.length === 1) {
      console.warn(
        `   ⚠️ ${NATURAL_KEY_INDEX} refused a SINGLE row the guard did not predict ` +
          `(${batch[0]!.external_id}) — counted as a natural-key skip`,
      );
      return { inserted: 0, updated: 0, unchanged: 0, skippedNaturalKey: 1 };
    }
    const mid = Math.ceil(batch.length / 2);
    console.warn(
      `   ⚠️ batch of ${batch.length} rejected by ${NATURAL_KEY_INDEX} — bisecting to isolate the collider`,
    );
    const left = await upsertBatchResilient(batch.slice(0, mid));
    const right = await upsertBatchResilient(batch.slice(mid));
    return combineOutcome(left, right);
  }
}

/**
 * CLOSE OUT (spec §Close-out). One statement, three honest predicates:
 *   - the deadline has passed (the counter already refuses these), or
 *   - the notice is absent from tonight's file AND was stored before the extract
 *     was generated (so a same-day 4h-sync bid is never closed), or
 *   - (never) a deadline-less row — that is "not open", not "closed".
 * Scoped to SAM-family `sam-<32hex>` rows only; no other source is touched.
 */
export async function closeOutSamCsvRows(args: {
  tonightIds: readonly string[];
  extractTime: string;
}): Promise<number> {
  const q = sql();
  const idList = args.tonightIds.filter((id) => /^sam-[0-9a-f]{32}$/.test(id));
  // The id set is embedded as a validated literal array (hardcoded-shape ids,
  // never user input) because it is 10k+ values — far past a sane parameter list.
  const arrayLiteral = idList.length ? `ARRAY[${idList.map((i) => `'${i}'`).join(",")}]::text[]` : "ARRAY[]::text[]";
  const closed = (await q.query(
    `UPDATE bids SET closed_at = NOW(), updated_at = NOW()
     WHERE source = '${SAM_CSV_SOURCE}'
       AND external_id ~ '^sam-[0-9a-f]{32}$'
       AND closed_at IS NULL
       AND due_date IS NOT NULL
       AND (
             due_date::date < NOW()::date
             OR (created_at < $1::timestamptz AND NOT (external_id = ANY(${arrayLiteral})))
           )
     RETURNING id`,
    [args.extractTime],
  )) as { id: number }[];
  return closed.length;
}

export async function runSamCsvIngest(
  input: AsyncIterable<string | Uint8Array>,
  opts: { reportOnly?: boolean; extractTime?: string; now?: Date } = {},
): Promise<IngestSummary> {
  const now = opts.now ?? new Date();
  const reportOnly = opts.reportOnly ?? process.env.SAM_CSV_REPORT_ONLY === "1";
  const extractTime = opts.extractTime ?? process.env.SAM_CSV_EXTRACT_TIME ?? now.toISOString();

  const { rows, csvRows, skipped, naturalKeyDuplicates, naturalKeyGroups } = await readSamCsv(input);
  console.log(
    `📥 SAM CSV: ${csvRows} data row(s) read; ${rows.length} live opportunity(ies) kept; skipped ${JSON.stringify(skipped)}`,
  );
  if (naturalKeyDuplicates > 0) {
    console.log(
      `🔑 in-stream natural-key dedupe: ${naturalKeyDuplicates} kept row(s) collapsed ` +
        `(${naturalKeyGroups} tuple(s) held more than one NoticeId — the 5-column UNIQUE ` +
        `index's own tuple, so those rows could never both be stored)`,
    );
  }

  const live = await liveCounterStates();
  const projection = projectStates(live.states, rows);
  console.log(
    `📊 counter population now: ${live.totalOpen} row(s) across ${projection.before.length} state(s)`,
  );

  // ── TOTALSTATES IS OBSERVED, NEVER GATED (owner 2026-10-19) ─────────────
  // The counter's state set follows the REAL data: 50 today, 51 the moment real
  // Maine notices enter the live counter, and back DOWN again if the rows behind
  // a state close out. So the run reads the counter's own state set before the
  // write and again after it (its own query, no projection), and reports any
  // move in either direction — prominently, by alert — while ALWAYS carrying on:
  // a stalled import is worse than a count moving by one, so nothing below can
  // fail, throw or skip the write because of this.
  const stats = keptRowCounterStats(rows, now);
  console.log(
    `📊 kept rows: ${stats.counted} enter the counter (${stats.withPopState} carry a PopState, ` +
      `${stats.withoutPopState} publish none; ${stats.refusedLowContent} refused as low-content; ` +
      `${stats.countedTodayOnly} expire later today, counted by the counter's date rule only)`,
  );
  const beforeCounts = live.counts;
  if (reportOnly) {
    console.log("🧪 report-only: parsed, gated and reported — nothing written");
    return {
      csvRows,
      kept: rows.length,
      skipped,
      batches: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      skippedNaturalKey: 0,
      naturalKeyDuplicates,
      closed: 0,
      projectedStates: projection,
      reportOnly: true,
    };
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let skippedNaturalKey = 0;
  let batches = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const r = await upsertBatchResilient(batch);
    inserted += r.inserted;
    updated += r.updated;
    unchanged += r.unchanged;
    skippedNaturalKey += r.skippedNaturalKey;
    batches++;
    if (batches % 5 === 0) {
      console.log(
        `   … ${batches} batch(es): +${inserted} new, ~${updated} changed, =${unchanged} identical, ` +
          `⊘${skippedNaturalKey} natural-key collision(s)`,
      );
    }
  }

  const closed = await closeOutSamCsvRows({
    tonightIds: rows.map((r) => r.external_id),
    extractTime,
  });

  console.log(
    `✅ SAM CSV ingest done — ${inserted} new, ${updated} refreshed, ${unchanged} identical, ` +
      `${skippedNaturalKey} skipped (natural-key collision with an existing row), ${closed} closed out`,
  );
  // THE STATE-SET OBSERVATION, on the counter's OWN two reads (both directions).
  try {
    const after = await liveCounterStates();
    const change = describeStateSetChange(Object.keys(beforeCounts), Object.keys(after.counts));
    const deltas = stateOpenCountDeltas(beforeCounts, after.counts);
    if (!change.changed) {
      console.log(
        `✅ counter state set UNCHANGED (${change.after.length} jurisdiction(s), ` +
          `${after.totalOpen} open row(s)) — no alert needed`,
      );
    } else {
      const report = counterStateChangeReport(change, deltas, stats);
      for (const line of report.lines) console.log(line);
      const alert = await alertCounterStateChange(report);
      console.log(
        `📣 counter state-set change alerted (email=${alert.emailed}${
          alert.artifact ? `, artifact=${alert.artifact}` : ""
        }) — the import CONTINUES`,
      );
    }
  } catch (e) {
    // An observation failure is never an import failure: log it and finish.
    console.warn(
      `[sam-csv-ingest] counter state observation failed (the write above stands): ${(e as Error).message}`,
    );
  }
  return {
    csvRows,
    kept: rows.length,
    skipped,
    batches,
    inserted,
    updated,
    unchanged,
    skippedNaturalKey,
    naturalKeyDuplicates,
    closed,
    projectedStates: projection,
    reportOnly: false,
  };
}

/** stdin as an async iterable of chunks (the `curl | …` half of the contract). */
async function* stdinChunks(): AsyncIterable<Uint8Array> {
  const stdin = process.stdin;
  for await (const chunk of stdin) {
    yield chunk as Uint8Array;
  }
}

if (import.meta.main) {
  try {
    const summary = await runSamCsvIngest(stdinChunks());
    console.log(`🏁 sam-csv-ingest finished: ${JSON.stringify(summary)}`);
    process.exit(0);
  } catch (e) {
    console.error(`💥 sam-csv-ingest failed: ${(e as Error).message}`);
    process.exit(1);
  }
}
