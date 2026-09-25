/**
 * Contrax — SUBCONTRACTING preview, DATA LAYER: the store (SERVER-ONLY).
 *
 * The Postgres half of the preview: the one statement that writes a sweep's notices
 * AND its sync-run row, the error-run writer, and the small read surface the
 * verification scripts (and the follow-up UI) need. Nothing here is imported by
 * client code, and nothing here touches the Radar / Grants / pricing surfaces.
 *
 * ATOMICITY. The whole per-source write is ONE statement: a single
 * `WITH … jsonb_to_recordset(…) … INSERT … ON CONFLICT … RETURNING` CTE whose final
 * SELECT also inserts the sync-run row. One statement is one implicit transaction, so
 * either every notice AND the run row land, or nothing does. The runner never issues
 * this statement at all when the crawl failed, which is what makes a failed sweep
 * write nothing (not even a stale flip).
 *
 * IDENTITY is (source_id, external_id) — the SUBNet slug. A notice SBA amends in
 * place keeps its slug and is UPDATED here; the same board title published twice
 * (`…-landscaping` / `…-landscaping-0`) is two slugs and therefore two rows.
 *
 * NO-OP DISCIPLINE. The upsert only fires `WHERE t.fingerprint IS DISTINCT FROM
 * EXCLUDED.fingerprint`, so an unchanged sweep writes no row content at all; the
 * separate `refreshed` CTE touches `last_seen_at`/`last_verified_at` only for rows
 * whose timestamp actually changes. `created_at` and `first_seen_at` are never
 * rewritten by an update.
 *
 * STALE SWEEP. Any row of this source that a COMPLETE sweep did not see is hidden in
 * the same transaction: `closed` when its own published closing date has passed,
 * otherwise `unverified`. The date used is the RUN's Eastern day, passed in from the
 * runner, so the SQL never disagrees with the TypeScript classifier about "today".
 */
import { sql } from "~/db";
import type {
  SubcontractNoticeRow,
  SubcontractSource,
  SubcontractStatus,
} from "~/lib/subcontracts/connector";

// ── Write surface ────────────────────────────────────────────────────────────

/**
 * WHY THERE IS NO `detail_fetched` COLUMN. The notice object carries a `detailFetched`
 * boolean, but it is a PARSE-TIME fact about the row being built, not a stored one: the
 * table records it by construction as `raw->'detail'` — JSON null when the sweep built
 * the row without a detail page, an object when it fetched and merged one. A column
 * would be a second source of truth for the same fact (and would need a NOT NULL default
 * that lies about rows written before it existed). The runner reads the index snapshot
 * (`raw->'index'`) to decide whether to fetch a detail page at all, and the merged
 * result is what lands in `raw`; so `raw->'detail' IS NULL` is the one honest answer to
 * "did this row come from a detail page", kept next to the evidence itself.
 */

/** One notice, flattened for the JSON payload the CTE consumes. */
function payloadRow(row: SubcontractNoticeRow, finishedAt: string) {
  return {
    external_id: row.externalId,
    natural_key: row.naturalKey,
    title: row.title,
    prime: row.prime,
    prime_uei: null,
    prime_division: row.primeDivision,
    website: row.website,
    scope: row.scope,
    summary: row.summary,
    trades: row.trades,
    certs_solicited: row.certsSolicited,
    naics: row.naics,
    naics_code: row.naicsCode,
    naics_title: row.naicsTitle,
    place_of_performance: row.placeOfPerformance,
    state_code: row.stateCode,
    closing_date: row.closingDate,
    performance_start_date: row.performanceStartDate,
    contact_name: row.contactName,
    contact_email: row.contactEmail,
    contact_phone: row.contactPhone,
    source_url: row.sourceUrl,
    detail_url: row.detailUrl,
    attachments: row.attachments,
    status: row.status,
    status_reason: row.statusReason,
    source_updated_at: row.sourceUpdatedAt,
    fingerprint: row.fingerprint,
    raw: row.raw,
    last_seen_at: finishedAt,
  };
}

/**
 * External ids travel as a comma-separated list (the repo's convention —
 * `string_to_array` rather than a driver-dependent array parameter). That is only
 * safe because an external id is a SUBNet slug; a value carrying a comma, brace or
 * newline would silently corrupt the list, so it is rejected loudly instead.
 */
export function externalIdCsv(ids: readonly string[]): string {
  const bad = ids.find((id) => /[,\n\r{}]/.test(id));
  if (bad !== undefined) {
    throw new Error(
      `external id ${JSON.stringify(bad)} contains a separator character (comma, brace or newline) — refusing to build a list that could silently mis-attribute rows`,
    );
  }
  return ids.join(",");
}

export interface SubcontractSyncCounts {
  seen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  /** Rows in the open set this sweep produced. */
  open: number;
  /** Rows hidden because their published closing date has passed. */
  closed: number;
  /** Rows hidden because no closing date is published (or the source stopped publishing them). */
  unverified: number;
  /** Notices whose detail page this sweep fetched. */
  detailsFetched: number;
  detailsSkipped: number;
  pagesFetched: number;
  requests: number;
  /** How the index sweep ended (the pager's own stop signal). */
  stoppedBecause: string;
  /** Duplicate slugs the crawl collapsed. */
  collisions: number;
  durationMs: number;
}

export interface SubcontractSyncWrite {
  sourceKey: string;
  /** The `subcontract_sources.id` this sweep wrote. */
  sourceId: string;
  startedAt: string;
  finishedAt: string;
  /** The RUN's Eastern day ('YYYY-MM-DD') — the stale sweep's clock. */
  todayEastern: string;
  counts: SubcontractSyncCounts;
  /** Only rows that are new or whose content changed. */
  rows: readonly SubcontractNoticeRow[];
  /** Every external id this COMPLETE sweep saw (changed + unchanged). */
  seenExternalIds: readonly string[];
  /** The subset whose content did not change (timestamp refresh only). */
  unchangedExternalIds: readonly string[];
}

export interface SubcontractSyncWriteResult {
  runId: string;
  /** Rows the statement actually inserted or updated (the DB's own answer). */
  touched: number;
  /** Unchanged rows whose last_seen_at/last_verified_at the statement refreshed. */
  refreshed: number;
  /** Rows this sweep no longer saw, hidden as closed/unverified. */
  staled: number;
  staledClosed: number;
  staledUnverified: number;
  finishedAt: string;
}

const COMMIT_SWEEP_SQL = (
  payload: string,
  sourceId: string,
  sourceKey: string,
  seenCsv: string,
  unchangedCsv: string,
  todayEastern: string,
  startedAt: string,
  finishedAt: string,
  counts: SubcontractSyncCounts,
) => {
  const db = sql();
  const countsJson = JSON.stringify(counts);
  return db`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        external_id text, natural_key text, title text, prime text, prime_uei text,
        prime_division text, website text, scope text, summary text, trades jsonb,
        certs_solicited jsonb, naics text, naics_code text, naics_title text,
        place_of_performance text, state_code text, closing_date text,
        performance_start_date text, contact_name text, contact_email text,
        contact_phone text, source_url text, detail_url text, attachments jsonb,
        status text, status_reason text, source_updated_at text, fingerprint text,
        raw jsonb, last_seen_at text
      )
    ), written AS (
      INSERT INTO subcontract_opportunities AS t (
        source_id, external_id, natural_key, title, prime, prime_uei, prime_division,
        website, scope, summary, trades, certs_solicited, naics, naics_code, naics_title,
        place_of_performance, state_code, closing_date, performance_start_date,
        contact_name, contact_email, contact_phone, source_url, detail_url, attachments,
        status, status_reason, source_updated_at, first_seen_at, last_seen_at,
        last_verified_at, fingerprint, raw, created_at, updated_at
      )
      SELECT
        ${sourceId}::uuid, external_id, natural_key, title, prime, prime_uei, prime_division,
        website, scope, summary,
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(trades)), '{}'::text[]),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(certs_solicited)), '{}'::text[]),
        naics, naics_code, naics_title,
        place_of_performance, state_code,
        NULLIF(closing_date, '')::date,
        NULLIF(performance_start_date, '')::date,
        contact_name, contact_email, contact_phone, source_url, detail_url, attachments,
        status, status_reason,
        NULLIF(source_updated_at, '')::timestamptz,
        ${finishedAt}::timestamptz,
        COALESCE(NULLIF(last_seen_at, '')::timestamptz, ${finishedAt}::timestamptz),
        COALESCE(NULLIF(last_seen_at, '')::timestamptz, ${finishedAt}::timestamptz),
        fingerprint, raw,
        ${finishedAt}::timestamptz, ${finishedAt}::timestamptz
      FROM input
      ON CONFLICT (source_id, external_id) DO UPDATE SET
        natural_key = EXCLUDED.natural_key,
        title = EXCLUDED.title,
        prime = EXCLUDED.prime,
        prime_division = EXCLUDED.prime_division,
        website = EXCLUDED.website,
        scope = EXCLUDED.scope,
        summary = EXCLUDED.summary,
        trades = EXCLUDED.trades,
        certs_solicited = EXCLUDED.certs_solicited,
        naics = EXCLUDED.naics,
        naics_code = EXCLUDED.naics_code,
        naics_title = EXCLUDED.naics_title,
        place_of_performance = EXCLUDED.place_of_performance,
        state_code = EXCLUDED.state_code,
        closing_date = EXCLUDED.closing_date,
        performance_start_date = EXCLUDED.performance_start_date,
        contact_name = EXCLUDED.contact_name,
        contact_email = EXCLUDED.contact_email,
        contact_phone = EXCLUDED.contact_phone,
        source_url = EXCLUDED.source_url,
        detail_url = EXCLUDED.detail_url,
        attachments = EXCLUDED.attachments,
        status = EXCLUDED.status,
        status_reason = EXCLUDED.status_reason,
        source_updated_at = EXCLUDED.source_updated_at,
        last_seen_at = EXCLUDED.last_seen_at,
        last_verified_at = EXCLUDED.last_verified_at,
        fingerprint = EXCLUDED.fingerprint,
        raw = EXCLUDED.raw,
        updated_at = EXCLUDED.updated_at
      WHERE t.fingerprint IS DISTINCT FROM EXCLUDED.fingerprint
      RETURNING 1 AS written
    ), refreshed AS (
      UPDATE subcontract_opportunities t
      SET last_seen_at = ${finishedAt}::timestamptz,
          last_verified_at = ${finishedAt}::timestamptz
      WHERE t.source_id = ${sourceId}::uuid
        AND t.external_id = ANY(string_to_array(${unchangedCsv}::text, ','))
        AND (t.last_seen_at IS DISTINCT FROM ${finishedAt}::timestamptz
             OR t.last_verified_at IS DISTINCT FROM ${finishedAt}::timestamptz)
      RETURNING 1 AS refreshed
    ), staled AS (
      UPDATE subcontract_opportunities t
      SET status = CASE
            WHEN t.closing_date IS NOT NULL AND t.closing_date < ${todayEastern}::date THEN 'closed'
            ELSE 'unverified'
          END,
          status_reason = CASE
            WHEN t.closing_date IS NOT NULL AND t.closing_date < ${todayEastern}::date
              THEN 'the source no longer publishes this notice and its published closing date has passed — marked closed rather than left looking open'
            ELSE 'the source no longer publishes this notice (a complete run did not see it) and no passed closing date confirms closure — hidden from the open set as unverified'
          END,
          updated_at = ${finishedAt}::timestamptz
      WHERE t.source_id = ${sourceId}::uuid
        AND NOT (t.external_id = ANY(string_to_array(${seenCsv}::text, ',')))
        AND t.status IS DISTINCT FROM
            (CASE
               WHEN t.closing_date IS NOT NULL AND t.closing_date < ${todayEastern}::date THEN 'closed'
               ELSE 'unverified'
             END)
      RETURNING t.status AS status
    ), run AS (
      INSERT INTO subcontract_sync_runs (
        source_key, status, stage, counts, message, started_at, finished_at
      ) VALUES (
        ${sourceKey}, 'ok', 'store', ${countsJson}::jsonb, NULL,
        ${startedAt}::timestamptz, ${finishedAt}::timestamptz
      )
      RETURNING id, finished_at
    )
    SELECT
      (SELECT count(*)::int FROM written) AS touched,
      (SELECT count(*)::int FROM refreshed) AS refreshed,
      (SELECT count(*)::int FROM staled) AS staled,
      (SELECT count(*)::int FROM staled WHERE status = 'closed') AS staled_closed,
      (SELECT count(*)::int FROM staled WHERE status = 'unverified') AS staled_unverified,
      (SELECT id::text FROM run) AS run_id,
      (SELECT finished_at FROM run) AS finished_at
  `;
};

/** Commits one sweep: the changed notices + the timestamp refresh + the stale sweep + the ok run row. */
export async function commitSubcontractSync(
  entry: SubcontractSyncWrite,
): Promise<SubcontractSyncWriteResult> {
  const payload = JSON.stringify(entry.rows.map((row) => payloadRow(row, entry.finishedAt)));
  const seenCsv = externalIdCsv(entry.seenExternalIds);
  const unchangedCsv = externalIdCsv(entry.unchangedExternalIds);
  const rows = (await COMMIT_SWEEP_SQL(
    payload,
    entry.sourceId,
    entry.sourceKey,
    seenCsv,
    unchangedCsv,
    entry.todayEastern,
    entry.startedAt,
    entry.finishedAt,
    entry.counts,
  )) as {
    touched: number;
    refreshed: number;
    staled: number;
    staled_closed: number;
    staled_unverified: number;
    run_id: string;
    finished_at: unknown;
  }[];
  const row = rows[0];
  if (!row?.run_id) throw new Error("subcontract sweep commit returned no run row");
  return {
    runId: String(row.run_id),
    touched: Number(row.touched ?? 0),
    refreshed: Number(row.refreshed ?? 0),
    staled: Number(row.staled ?? 0),
    staledClosed: Number(row.staled_closed ?? 0),
    staledUnverified: Number(row.staled_unverified ?? 0),
    finishedAt: new Date(row.finished_at as string).toISOString(),
  };
}

/**
 * Records a FAILED sweep. Called only when the commit statement was never issued, so
 * the error row is the run's only trace and the notices table holds nothing from it.
 */
export async function recordFailedSubcontractSync(opts: {
  sourceKey: string;
  startedAt: string;
  finishedAt: string;
  stage: string;
  message: string;
  counts?: Partial<SubcontractSyncCounts>;
}): Promise<string> {
  const db = sql();
  const rows = (await db`
    INSERT INTO subcontract_sync_runs (
      source_key, status, stage, counts, message, started_at, finished_at
    ) VALUES (
      ${opts.sourceKey}, 'error', ${opts.stage},
      ${JSON.stringify(opts.counts ?? {})}::jsonb, ${opts.message},
      ${opts.startedAt}::timestamptz, ${opts.finishedAt}::timestamptz
    )
    RETURNING id::text AS id
  `) as { id: string }[];
  return String(rows[0]?.id ?? "");
}

/** What one stored notice looks like to a sweep's read-only pre-read. */
export interface StoredNoticeSnapshot {
  /** The fingerprint of the stored row (detail-inclusive). */
  fingerprint: string;
  /**
   * The stored `raw->'index'` snapshot: the index row a previous complete sweep parsed,
   * verbatim. This is what the detail-fetch decision compares against, because it is the
   * only thing that can tell an UNCHANGED notice from one SBA amended in place.
   */
  index: unknown;
}

/**
 * external_id → { fingerprint, index snapshot } for one SOURCE. The amendment pre-read.
 * READ-ONLY. `raw->'index'` is NULL for a row written before the index snapshot existed
 * (or by hand); such a row simply fails the content comparison and its detail page is
 * refetched — fetch-safe, never data-losing.
 */
export async function readNoticeSnapshots(
  sourceKey: string,
): Promise<Map<string, StoredNoticeSnapshot>> {
  const db = sql();
  const rows = (await db`
    SELECT o.external_id, o.fingerprint, o.raw->'index' AS index_snapshot
    FROM subcontract_opportunities o
    JOIN subcontract_sources s ON s.id = o.source_id
    WHERE s.source_key = ${sourceKey}
  `) as { external_id: string; fingerprint: string; index_snapshot: unknown }[];
  return new Map(
    rows.map((r) => [
      r.external_id,
      { fingerprint: r.fingerprint, index: r.index_snapshot ?? null },
    ]),
  );
}

/**
 * Resolves a source to its row, creating or refreshing it as needed, and returns the
 * row id. Idempotent and no-op-free: an unchanged source rewrites nothing.
 */
export async function ensureSubcontractSource(source: SubcontractSource): Promise<string> {
  const db = sql();
  const rows = (await db`
    WITH inserted AS (
      INSERT INTO subcontract_sources AS t
        (source_key, name, agency, official_url, official_host, kind, cadence, coverage_tier, note, updated_at)
      VALUES (
        ${source.sourceKey}, ${source.name}, ${source.agency}, ${source.officialUrl},
        ${source.officialHost}, ${source.kind}, ${source.cadence}, ${source.coverageTier},
        ${source.note}, NOW()
      )
      ON CONFLICT (source_key) DO UPDATE SET
        name = EXCLUDED.name,
        agency = EXCLUDED.agency,
        official_url = EXCLUDED.official_url,
        official_host = EXCLUDED.official_host,
        kind = EXCLUDED.kind,
        cadence = EXCLUDED.cadence,
        coverage_tier = EXCLUDED.coverage_tier,
        note = EXCLUDED.note,
        updated_at = EXCLUDED.updated_at
      WHERE t.name IS DISTINCT FROM EXCLUDED.name
         OR t.agency IS DISTINCT FROM EXCLUDED.agency
         OR t.official_url IS DISTINCT FROM EXCLUDED.official_url
         OR t.official_host IS DISTINCT FROM EXCLUDED.official_host
         OR t.kind IS DISTINCT FROM EXCLUDED.kind
         OR t.cadence IS DISTINCT FROM EXCLUDED.cadence
         OR t.coverage_tier IS DISTINCT FROM EXCLUDED.coverage_tier
         OR t.note IS DISTINCT FROM EXCLUDED.note
      RETURNING id
    ), existing AS (
      SELECT id FROM subcontract_sources WHERE source_key = ${source.sourceKey}
    )
    SELECT COALESCE((SELECT id FROM inserted), (SELECT id FROM existing))::text AS id
  `) as { id: string | null }[];
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not resolve the source row for ${source.sourceKey}`);
  return String(id);
}

// ── Read surface (verification + the follow-up UI) ───────────────────────────

export interface SubcontractSyncRunRow {
  id: string;
  sourceKey: string;
  status: "ok" | "error";
  stage: string | null;
  counts: Record<string, unknown>;
  message: string | null;
  startedAt: string;
  finishedAt: string;
}

/** The most recent sweep's run row (any status) — the honest "last checked" source. */
export async function latestSubcontractSync(
  sourceKey: string,
): Promise<SubcontractSyncRunRow | null> {
  const db = sql();
  const rows = (await db`
    SELECT id::text AS id, source_key, status, stage, counts, message, started_at, finished_at
    FROM subcontract_sync_runs
    WHERE source_key = ${sourceKey}
    ORDER BY started_at DESC
    LIMIT 1
  `) as {
    id: string;
    source_key: string;
    status: "ok" | "error";
    stage: string | null;
    counts: Record<string, unknown>;
    message: string | null;
    started_at: string;
    finished_at: string;
  }[];
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    sourceKey: row.source_key,
    status: row.status,
    stage: row.stage,
    counts: row.counts ?? {},
    message: row.message,
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: new Date(row.finished_at).toISOString(),
  };
}

export interface SubcontractStatusCount {
  status: SubcontractStatus;
  count: number;
}

/** Stored row counts by status. The count labels come from HERE, never from a cache. */
export async function subcontractStatusCounts(
  sourceKey: string,
): Promise<SubcontractStatusCount[]> {
  const db = sql();
  const rows = (await db`
    SELECT o.status, count(*)::int AS count
    FROM subcontract_opportunities o
    JOIN subcontract_sources s ON s.id = o.source_id
    WHERE s.source_key = ${sourceKey}
    GROUP BY o.status
    ORDER BY o.status
  `) as { status: SubcontractStatus; count: number }[];
  return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
}
