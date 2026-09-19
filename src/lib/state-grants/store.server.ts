/**
 * Contrax Grants — State Grants store (SERVER-ONLY).
 *
 * The Postgres half of the state rollout: the transaction that writes a state's
 * opportunities AND its sync-run row, the error-run writer, and the READ surface
 * part 2 (the search API + coverage page) builds on. Nothing here is imported by
 * client code, and nothing here is used by the federal /grants experience.
 *
 * ATOMICITY. The whole per-state write is ONE statement: a single
 * `WITH … jsonb_to_recordset(…) … INSERT … ON CONFLICT … RETURNING` CTE whose
 * final SELECT also inserts the sync-run row. One statement is one implicit
 * transaction, so either every opportunity AND the run row land, or nothing
 * does — there is no window in which a half-written corpus can be read. (The
 * runner never issues this statement at all when fetch/parse/classify failed,
 * which is what makes a failed run write nothing.)
 *
 * IDEMPOTENCE + NO-OP WRITES. The upsert carries
 * `WHERE t.fingerprint IS DISTINCT FROM EXCLUDED.fingerprint`, so a re-run whose
 * content is unchanged updates NOTHING — the row keeps its original created_at
 * *and* its original fetched_at, and Neon does not pay for a rewrite. That is the
 * same CU discipline applied elsewhere in this repo (see the no-op-upsert work
 * on the scheduled syncs).
 */
import { sql } from "~/db";
import type { GrantOpportunity, StateGrantStatus } from "~/lib/state-grants/connector";
import type { StateRegistryEntry } from "~/lib/state-grants/registry";

// ── Write surface ───────────────────────────────────────────────────────────

/** One opportunity, flattened for the JSON payload the CTE consumes. */
function payloadRow(o: GrantOpportunity, fetchedAt: string) {
  return {
    state_code: o.stateCode,
    external_id: o.externalId,
    title: o.title,
    agency: o.agency,
    summary: o.summary,
    status: o.status,
    posted_date: o.postedDate,
    close_date: o.closeDate,
    estimated_close_date: o.estimatedCloseDate,
    url: o.url,
    source_url: o.sourceUrl,
    fingerprint: o.fingerprint,
    source_updated_at: o.sourceUpdatedAt,
    raw: o.raw,
    fetched_at: fetchedAt,
  };
}

export interface StateSyncWrite {
  stateCode: string;
  startedAt: string;
  finishedAt: string;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  /** The rows to upsert — only rows that are new or actually changed. */
  opportunities: readonly GrantOpportunity[];
}

export interface StateSyncWriteResult {
  runId: string;
  /** Rows the statement actually inserted or updated (the DB's own answer). */
  touched: number;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  finishedAt: string;
}

/**
 * The one statement that commits a state's run. Returns the run row's id and how
 * many opportunity rows the statement really touched, so the caller can cross
 * check its own pre-read instead of trusting it.
 */
const COMMIT_RUN_SQL = (
  payload: string,
  stateCode: string,
  startedAt: string,
  finishedAt: string,
  fetchedCount: number,
  insertedCount: number,
  updatedCount: number,
) => {
  const db = sql();
  return db`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        state_code text, external_id text, title text, agency text, summary text,
        status text, posted_date text, close_date text, estimated_close_date text,
        url text, source_url text, fingerprint text, source_updated_at text,
        raw jsonb, fetched_at text
      )
    ), written AS (
      INSERT INTO state_grant_opportunities AS t (
        state_code, external_id, title, agency, summary, status, posted_date,
        close_date, estimated_close_date, url, source_url, fingerprint,
        source_updated_at, raw, fetched_at, updated_at
      )
      SELECT
        state_code, external_id, title, agency, summary, status,
        NULLIF(posted_date, '')::date,
        NULLIF(close_date, '')::date,
        NULLIF(estimated_close_date, '')::date,
        url, source_url, fingerprint,
        NULLIF(source_updated_at, '')::timestamptz,
        raw,
        COALESCE(NULLIF(fetched_at, '')::timestamptz, ${finishedAt}::timestamptz),
        ${finishedAt}::timestamptz
      FROM input
      ON CONFLICT (state_code, external_id) DO UPDATE SET
        title = EXCLUDED.title,
        agency = EXCLUDED.agency,
        summary = EXCLUDED.summary,
        status = EXCLUDED.status,
        posted_date = EXCLUDED.posted_date,
        close_date = EXCLUDED.close_date,
        estimated_close_date = EXCLUDED.estimated_close_date,
        url = EXCLUDED.url,
        source_url = EXCLUDED.source_url,
        fingerprint = EXCLUDED.fingerprint,
        source_updated_at = EXCLUDED.source_updated_at,
        raw = EXCLUDED.raw,
        fetched_at = EXCLUDED.fetched_at,
        updated_at = EXCLUDED.updated_at
      WHERE t.fingerprint IS DISTINCT FROM EXCLUDED.fingerprint
      RETURNING 1 AS written
    ), run AS (
      INSERT INTO state_grant_sync_runs (
        state_code, started_at, finished_at, status,
        fetched_count, inserted_count, updated_count, error
      ) VALUES (
        ${stateCode}, ${startedAt}::timestamptz, ${finishedAt}::timestamptz, 'ok',
        ${fetchedCount}, ${insertedCount}, ${updatedCount}, NULL
      )
      RETURNING id, finished_at
    )
    SELECT
      (SELECT count(*)::int FROM written) AS touched,
      (SELECT id::text FROM run) AS run_id,
      (SELECT finished_at FROM run) AS finished_at
  `;
};

/** Commits one state's successful run (opportunities + the ok run row). */
export async function commitStateSync(entry: StateSyncWrite): Promise<StateSyncWriteResult> {
  const payload = JSON.stringify(
    entry.opportunities.map((o) => payloadRow(o, entry.finishedAt)),
  );
  const rows = (await COMMIT_RUN_SQL(
    payload,
    entry.stateCode,
    entry.startedAt,
    entry.finishedAt,
    entry.fetchedCount,
    entry.insertedCount,
    entry.updatedCount,
  )) as { touched: number; run_id: string; finished_at: unknown }[];
  const row = rows[0];
  if (!row?.run_id) {
    throw new Error("state sync commit returned no run row");
  }
  return {
    runId: String(row.run_id),
    touched: Number(row.touched ?? 0),
    fetchedCount: entry.fetchedCount,
    insertedCount: entry.insertedCount,
    updatedCount: entry.updatedCount,
    finishedAt: new Date(row.finished_at as string).toISOString(),
  };
}

/**
 * Records a FAILED state run. Called only after the commit statement was never
 * issued (or after it rolled back), so the error row is the run's only trace and
 * the opportunity table holds nothing from it.
 */
export async function recordFailedStateSync(opts: {
  stateCode: string;
  startedAt: string;
  finishedAt: string;
  stage: string;
  message: string;
}): Promise<string> {
  const db = sql();
  const rows = (await db`
    INSERT INTO state_grant_sync_runs (
      state_code, started_at, finished_at, status,
      fetched_count, inserted_count, updated_count, error
    ) VALUES (
      ${opts.stateCode}, ${opts.startedAt}::timestamptz, ${opts.finishedAt}::timestamptz, 'error',
      0, 0, 0,
      ${JSON.stringify({ stage: opts.stage, message: opts.message })}::jsonb
    )
    RETURNING id::text AS id
  `) as { id: string }[];
  return String(rows[0]?.id ?? "");
}

/** external_id → fingerprint for one state. The amendment pre-read. */
export async function readFingerprints(stateCode: string): Promise<Map<string, string>> {
  const db = sql();
  const rows = (await db`
    SELECT external_id, fingerprint
    FROM state_grant_opportunities
    WHERE state_code = ${stateCode}
  `) as { external_id: string; fingerprint: string }[];
  return new Map(rows.map((r) => [r.external_id, r.fingerprint]));
}

// ── Registry mirror ─────────────────────────────────────────────────────────

/**
 * Mirrors the CODE-level registry into state_grant_registry. Upsert-only: an
 * existing row is rewritten only when its derived status, connector or name
 * changed, so re-running this is free of no-op writes.
 */
export async function syncStateRegistry(entries: readonly StateRegistryEntry[]): Promise<number> {
  const db = sql();
  const payload = JSON.stringify(
    entries.map((e) => ({
      state_code: e.stateCode,
      name: e.name,
      status: e.status,
      connector_id: e.connectorId,
    })),
  );
  const rows = (await db`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        state_code text, name text, status text, connector_id text
      )
    ), upserted AS (
      INSERT INTO state_grant_registry AS t (state_code, name, status, connector_id, updated_at)
      SELECT state_code, name, status, connector_id, NOW() FROM input
      ON CONFLICT (state_code) DO UPDATE SET
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        connector_id = EXCLUDED.connector_id,
        updated_at = EXCLUDED.updated_at
      WHERE t.name IS DISTINCT FROM EXCLUDED.name
         OR t.status IS DISTINCT FROM EXCLUDED.status
         OR t.connector_id IS DISTINCT FROM EXCLUDED.connector_id
      RETURNING 1 AS written
    )
    SELECT count(*)::int AS written FROM upserted
  `) as { written: number }[];
  return Number(rows[0]?.written ?? 0);
}

export interface StateRegistryRow {
  stateCode: string;
  name: string;
  status: "unavailable" | "connected";
  connectorId: string | null;
  updatedAt: string;
}

export async function readStateRegistry(): Promise<StateRegistryRow[]> {
  const db = sql();
  const rows = (await db`
    SELECT state_code, name, status, connector_id, updated_at
    FROM state_grant_registry
    ORDER BY name
  `) as {
    state_code: string;
    name: string;
    status: "unavailable" | "connected";
    connector_id: string | null;
    updated_at: string;
  }[];
  return rows.map((r) => ({
    stateCode: r.state_code,
    name: r.name,
    status: r.status,
    connectorId: r.connector_id,
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}

// ── Read surface (the part 2 query door) ────────────────────────────────────

export interface StateGrantRow {
  id: string;
  stateCode: string;
  externalId: string;
  title: string;
  agency: string | null;
  summary: string | null;
  status: StateGrantStatus;
  postedDate: string | null;
  closeDate: string | null;
  estimatedCloseDate: string | null;
  url: string;
  sourceUrl: string;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
  updatedAt: string;
}

export interface StateGrantQuery {
  /** One state, or several (the coverage page's "connected states" filter). */
  stateCode?: string | null;
  stateCodes?: readonly string[] | null;
  status?: StateGrantStatus | null;
  /** Free text matched against title, agency and summary (ILIKE, escaped). */
  term?: string | null;
  limit?: number;
  offset?: number;
}

export const DEFAULT_QUERY_LIMIT = 25;
export const MAX_QUERY_LIMIT = 100;

/** Escapes ILIKE wildcards so a term can never widen its own match. */
function likeTerm(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const ROW_COLUMNS = `
  id::text AS id, state_code, external_id, title, agency, summary, status,
  to_char(posted_date, 'YYYY-MM-DD') AS posted_date,
  to_char(close_date, 'YYYY-MM-DD') AS close_date,
  to_char(estimated_close_date, 'YYYY-MM-DD') AS estimated_close_date,
  url, source_url, source_updated_at, fetched_at, updated_at`;

interface RawStateGrantRow {
  id: string;
  state_code: string;
  external_id: string;
  title: string;
  agency: string | null;
  summary: string | null;
  status: StateGrantStatus;
  posted_date: string | null;
  close_date: string | null;
  estimated_close_date: string | null;
  url: string;
  source_url: string;
  source_updated_at: string | null;
  fetched_at: string;
  updated_at: string;
}

function mapRow(r: RawStateGrantRow): StateGrantRow {
  return {
    id: r.id,
    stateCode: r.state_code,
    externalId: r.external_id,
    title: r.title,
    agency: r.agency,
    summary: r.summary,
    status: r.status,
    postedDate: r.posted_date,
    closeDate: r.close_date,
    estimatedCloseDate: r.estimated_close_date,
    url: r.url,
    sourceUrl: r.source_url,
    sourceUpdatedAt: r.source_updated_at ? new Date(r.source_updated_at).toISOString() : null,
    fetchedAt: new Date(r.fetched_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/**
 * Searches stored state opportunities. Every filter is an optional bound
 * parameter (`IS NULL OR …`), so there are no dynamically assembled SQL strings
 * and nothing a caller passes can change the statement's shape.
 *
 * Ordering is the product's canonical one: open first, then forecast, then
 * closed, and within a status the nearest closing date first (rows with no
 * closing date last, never first).
 */
export async function queryStateGrants(
  query: StateGrantQuery = {},
): Promise<{ results: StateGrantRow[]; totalCount: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(1, Math.floor(query.limit ?? DEFAULT_QUERY_LIMIT)), MAX_QUERY_LIMIT);
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const stateCode = query.stateCode ?? null;
  // A comma-joined list rather than a JS array parameter: string_to_array keeps
  // the statement identical across drivers, with no array-serialisation guess.
  const stateCodes =
    query.stateCodes && query.stateCodes.length > 0
      ? query.stateCodes.map((s) => s.trim().toUpperCase()).filter(Boolean).join(",")
      : null;
  const status = query.status ?? null;
  const term = query.term && query.term.trim() ? likeTerm(query.term.trim()) : null;
  const db = sql();

  const rows = (await db`
    SELECT ${db.unsafe(ROW_COLUMNS)}
    FROM state_grant_opportunities
    WHERE (${stateCode}::text IS NULL OR state_code = ${stateCode}::text)
      AND (${stateCodes}::text IS NULL OR state_code = ANY(string_to_array(${stateCodes}::text, ',')))
      AND (${status}::text IS NULL OR status = ${status}::text)
      AND (
        ${term}::text IS NULL
        OR title ILIKE ${term}::text
        OR COALESCE(agency, '') ILIKE ${term}::text
        OR COALESCE(summary, '') ILIKE ${term}::text
      )
    ORDER BY
      CASE status WHEN 'open' THEN 0 WHEN 'forecast' THEN 1 ELSE 2 END,
      close_date ASC NULLS LAST,
      title ASC
    LIMIT ${limit} OFFSET ${offset}
  `) as RawStateGrantRow[];

  const countRows = (await db`
    SELECT count(*)::int AS total
    FROM state_grant_opportunities
    WHERE (${stateCode}::text IS NULL OR state_code = ${stateCode}::text)
      AND (${stateCodes}::text IS NULL OR state_code = ANY(string_to_array(${stateCodes}::text, ',')))
      AND (${status}::text IS NULL OR status = ${status}::text)
      AND (
        ${term}::text IS NULL
        OR title ILIKE ${term}::text
        OR COALESCE(agency, '') ILIKE ${term}::text
        OR COALESCE(summary, '') ILIKE ${term}::text
      )
  `) as { total: number }[];

  return {
    results: rows.map(mapRow),
    totalCount: Number(countRows[0]?.total ?? 0),
    limit,
    offset,
  };
}

/** Total matching rows for a query (the page-count half of pagination). */
export async function countStateGrants(query: StateGrantQuery = {}): Promise<number> {
  const { totalCount } = await queryStateGrants({ ...query, limit: 1, offset: 0 });
  return totalCount;
}

/** Honest per-status counts, optionally scoped to one state. */
export async function stateGrantStatusCounts(
  stateCode: string | null = null,
): Promise<Record<StateGrantStatus, number> & { total: number }> {
  const db = sql();
  const rows = (await db`
    SELECT status, count(*)::int AS n
    FROM state_grant_opportunities
    WHERE (${stateCode}::text IS NULL OR state_code = ${stateCode}::text)
    GROUP BY status
  `) as { status: StateGrantStatus; n: number }[];
  const counts = { open: 0, forecast: 0, closed: 0, total: 0 };
  for (const row of rows) {
    counts[row.status] = Number(row.n);
    counts.total += Number(row.n);
  }
  return counts;
}

// ── Sync-run history ────────────────────────────────────────────────────────

export interface StateSyncRunRow {
  id: string;
  stateCode: string;
  startedAt: string;
  finishedAt: string | null;
  status: "ok" | "error";
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  error: Record<string, unknown> | null;
}

/** Recent runs, newest first — the "is this state healthy?" read. */
export async function listStateSyncRuns(
  stateCode: string | null = null,
  limit = 20,
): Promise<StateSyncRunRow[]> {
  const db = sql();
  const rows = (await db`
    SELECT id::text AS id, state_code, started_at, finished_at, status,
           fetched_count, inserted_count, updated_count, error
    FROM state_grant_sync_runs
    WHERE (${stateCode}::text IS NULL OR state_code = ${stateCode}::text)
    ORDER BY started_at DESC
    LIMIT ${Math.min(Math.max(1, Math.floor(limit)), 200)}
  `) as {
    id: string;
    state_code: string;
    started_at: string;
    finished_at: string | null;
    status: "ok" | "error";
    fetched_count: number;
    inserted_count: number;
    updated_count: number;
    error: Record<string, unknown> | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    stateCode: r.state_code,
    startedAt: new Date(r.started_at).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    status: r.status,
    fetchedCount: Number(r.fetched_count),
    insertedCount: Number(r.inserted_count),
    updatedCount: Number(r.updated_count),
    error: r.error ?? null,
  }));
}
