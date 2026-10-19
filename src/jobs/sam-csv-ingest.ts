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
  describeStateSetChange,
  isAwardOrJustificationType,
  isOpenDeadline,
  parseDeadline,
  parseSamCsvRecord,
  projectStateCounts,
  projectStates,
  SAM_CSV_SOURCE,
  stateCodeFromLocation,
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
  return { rows, csvRows, skipped, duplicateIds };
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
 * One batch upsert. Returns how many rows were genuinely inserted, refreshed and
 * skipped-as-identical — the `xmax = 0` trick the runner uses, plus the no-op
 * guard's own silence for unchanged rows.
 */
export async function upsertBatch(
  batch: readonly SamCsvBidRow[],
): Promise<{ inserted: number; updated: number; unchanged: number }> {
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

  // Cross-source guard, VERBATIM from the runner (src/jobs/runner.ts): several
  // SAM-family passes return the SAME notice (`sam_naics_561720` already stores
  // `sam-<id>` for janitorial notices), and the natural-key UNIQUE index would
  // reject the insert outright. The self-exclusion keeps this job's OWN rows
  // reachable by the conflict clause so they can be refreshed.
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
      WHERE lower(btrim(b.title)) = lower(btrim(v.title))
        AND lower(btrim(b.agency)) = lower(btrim(v.agency))
        AND NOT (b.source = v.source AND b.external_id = v.external_id)
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
  const updated = returned.length - inserted;
  return { inserted, updated, unchanged: batch.length - returned.length };
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

  const { rows, csvRows, skipped } = await readSamCsv(input);
  console.log(
    `📥 SAM CSV: ${csvRows} data row(s) read; ${rows.length} live opportunity(ies) kept; skipped ${JSON.stringify(skipped)}`,
  );

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
      closed: 0,
      projectedStates: projection,
      reportOnly: true,
    };
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let batches = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const r = await upsertBatch(batch);
    inserted += r.inserted;
    updated += r.updated;
    unchanged += r.unchanged;
    batches++;
    if (batches % 5 === 0) {
      console.log(
        `   … ${batches} batch(es): +${inserted} new, ~${updated} changed, =${unchanged} identical`,
      );
    }
  }

  const closed = await closeOutSamCsvRows({
    tonightIds: rows.map((r) => r.external_id),
    extractTime,
  });

  console.log(
    `✅ SAM CSV ingest done — ${inserted} new, ${updated} refreshed, ${unchanged} identical, ${closed} closed out`,
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
