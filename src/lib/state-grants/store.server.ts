/**
 * Contrax Grants — State Grants store (SERVER-ONLY).
 *
 * The Postgres half of the state rollout: the transaction that writes a source's
 * opportunities AND its sync-run row, the error-run writer, the sources registry,
 * and the READ surface part 2 (the search API + coverage page) builds on. Nothing
 * here is imported by client code, and nothing here is used by the federal
 * /grants experience.
 *
 * ATOMICITY. The whole per-source write is ONE statement: a single
 * `WITH … jsonb_to_recordset(…) … INSERT … ON CONFLICT … RETURNING` CTE whose
 * final SELECT also inserts the sync-run row. One statement is one implicit
 * transaction, so either every opportunity AND the run row land, or nothing
 * does — there is no window in which a half-written corpus can be read. (The
 * runner never issues this statement at all when fetch/parse/classify failed,
 * which is what makes a failed run write nothing.)
 *
 * IDENTITY. A row is keyed by (source_id, external_id) — the SOURCE, never the
 * state (owner correction 1, 2026-09-19). Two agencies in one state publishing
 * the same short program id are two rows.
 *
 * FRESHNESS / NO FALSELY-OPEN ROWS. The same statement does three things in one
 * transaction:
 *   - upserts the rows whose CONTENT changed (a row whose fingerprint is
 *     unchanged is left completely untouched: same created_at AND same
 *     fetched_at, so there is no no-op churn — the same CU discipline as the
 *     scheduled syncs elsewhere in this repo);
 *   - refreshes `last_seen_at` for every row this COMPLETE run saw, unchanged
 *     rows included (that is what last_seen_at means: "the source still
 *     publishes this");
 *   - flips every OTHER row of the same source that is not already `unverified`
 *     to `unverified` — a record the source stopped publishing is never left
 *     sitting there looking open (owner correction 3, 2026-09-19).
 * A run that fails writes nothing at all (not even a stale flip), which is why
 * the stale sweep is safe: it only ever runs on a complete parse of the source.
 */
import { sql } from "~/db";
import type { GrantOpportunity, StateGrantStatus } from "~/lib/state-grants/connector";
import type { StateGrantSource } from "~/lib/state-grants/sources";
import type { StateGrantRegistryStatus, StateRegistryEntry } from "~/lib/state-grants/registry";

// ── Write surface ───────────────────────────────────────────────────────────

/**
 * One opportunity, flattened for the JSON payload the CTE consumes. The source
 * id/state code are NOT in the row: they are parameters of the run (one source,
 * one state), so a payload can never attribute a record to another source.
 */
function payloadRow(o: GrantOpportunity, fetchedAt: string) {
  return {
    external_id: o.externalId,
    title: o.title,
    agency: o.agency,
    summary: o.summary,
    status: o.status,
    posted_date: o.postedDate,
    close_date: o.closeDate,
    estimated_close_date: o.estimatedCloseDate,
    eligible_applicants: o.eligibleApplicants,
    eligible_geography: o.eligibleGeography,
    categories: o.categories,
    award_range: o.awardRange,
    award_min_amount: o.awardMinAmount === null ? null : String(o.awardMinAmount),
    award_max_amount: o.awardMaxAmount === null ? null : String(o.awardMaxAmount),
    total_funding: o.totalFunding,
    matching_requirement: o.matchingRequirement,
    url: o.url,
    source_url: o.sourceUrl,
    fingerprint: o.fingerprint,
    source_updated_at: o.sourceUpdatedAt,
    raw: o.raw,
    last_seen_at: fetchedAt,
  };
}

/**
 * External ids travel to the database as a comma-separated list (the repo's
 * convention — `string_to_array` rather than a driver-dependent array
 * parameter). That is only safe because an external id is a source slug; a value
 * carrying a comma, brace or newline would silently corrupt the list, so it is
 * rejected loudly instead.
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

export interface StateSyncWrite {
  stateCode: string;
  /** The `state_grant_sources.id` this run wrote (resolved from the connector). */
  sourceId: string;
  startedAt: string;
  finishedAt: string;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  /** The rows to upsert — only rows that are new or actually changed. */
  opportunities: readonly GrantOpportunity[];
  /** Every external id this COMPLETE run saw (changed + unchanged). */
  seenExternalIds: readonly string[];
  /** The subset of seen ids whose content did not change (last_seen refresh). */
  unchangedExternalIds: readonly string[];
}

export interface StateSyncWriteResult {
  runId: string;
  /** Rows the statement actually inserted or updated (the DB's own answer). */
  touched: number;
  /** Unchanged rows whose last_seen_at the statement refreshed. */
  refreshed: number;
  /** Rows the source no longer publishes, flipped to `unverified`. */
  staled: number;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  finishedAt: string;
}

/**
 * The one statement that commits a source's run. Returns the run row's id, how
 * many opportunity rows the statement really touched, how many unchanged rows it
 * refreshed, and how many vanished rows it flipped to `unverified`, so the caller
 * can cross-check its own pre-read instead of trusting it.
 */
const COMMIT_RUN_SQL = (
  payload: string,
  stateCode: string,
  sourceId: string,
  seenCsv: string,
  unchangedCsv: string,
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
        external_id text, title text, agency text, summary text, status text,
        posted_date text, close_date text, estimated_close_date text,
        eligible_applicants text, eligible_geography text, categories jsonb,
        award_range text, award_min_amount text, award_max_amount text,
        total_funding text, matching_requirement text,
        url text, source_url text, fingerprint text, source_updated_at text,
        raw jsonb, last_seen_at text
      )
    ), written AS (
      INSERT INTO state_grant_opportunities AS t (
        source_id, state_code, external_id, title, agency, summary, status,
        posted_date, close_date, estimated_close_date,
        eligible_applicants, eligible_geography, categories, award_range,
        award_min_amount, award_max_amount, total_funding, matching_requirement,
        url, source_url, fingerprint, source_updated_at, raw, fetched_at,
        last_seen_at, updated_at
      )
      SELECT
        ${sourceId}::uuid, ${stateCode}, external_id, title, agency, summary, status,
        NULLIF(posted_date, '')::date,
        NULLIF(close_date, '')::date,
        NULLIF(estimated_close_date, '')::date,
        eligible_applicants, eligible_geography,
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(categories)), '{}'::text[]),
        award_range,
        NULLIF(award_min_amount, '')::numeric,
        NULLIF(award_max_amount, '')::numeric,
        total_funding, matching_requirement,
        url, source_url, fingerprint,
        NULLIF(source_updated_at, '')::timestamptz,
        raw,
        COALESCE(NULLIF(last_seen_at, '')::timestamptz, ${finishedAt}::timestamptz),
        ${finishedAt}::timestamptz,
        ${finishedAt}::timestamptz
      FROM input
      ON CONFLICT (source_id, external_id) DO UPDATE SET
        state_code = EXCLUDED.state_code,
        title = EXCLUDED.title,
        agency = EXCLUDED.agency,
        summary = EXCLUDED.summary,
        status = EXCLUDED.status,
        posted_date = EXCLUDED.posted_date,
        close_date = EXCLUDED.close_date,
        estimated_close_date = EXCLUDED.estimated_close_date,
        eligible_applicants = EXCLUDED.eligible_applicants,
        eligible_geography = EXCLUDED.eligible_geography,
        categories = EXCLUDED.categories,
        award_range = EXCLUDED.award_range,
        award_min_amount = EXCLUDED.award_min_amount,
        award_max_amount = EXCLUDED.award_max_amount,
        total_funding = EXCLUDED.total_funding,
        matching_requirement = EXCLUDED.matching_requirement,
        url = EXCLUDED.url,
        source_url = EXCLUDED.source_url,
        fingerprint = EXCLUDED.fingerprint,
        source_updated_at = EXCLUDED.source_updated_at,
        raw = EXCLUDED.raw,
        last_seen_at = EXCLUDED.last_seen_at,
        updated_at = EXCLUDED.updated_at
      WHERE t.fingerprint IS DISTINCT FROM EXCLUDED.fingerprint
      RETURNING 1 AS written
    ), refreshed AS (
      UPDATE state_grant_opportunities t
      SET last_seen_at = ${finishedAt}::timestamptz
      WHERE t.source_id = ${sourceId}::uuid
        AND t.external_id = ANY(string_to_array(${unchangedCsv}::text, ','))
        AND t.last_seen_at IS DISTINCT FROM ${finishedAt}::timestamptz
      RETURNING 1 AS refreshed
    ), staled AS (
      UPDATE state_grant_opportunities t
      SET status = 'unverified',
          updated_at = ${finishedAt}::timestamptz
      WHERE t.source_id = ${sourceId}::uuid
        AND NOT (t.external_id = ANY(string_to_array(${seenCsv}::text, ',')))
        AND t.status IS DISTINCT FROM 'unverified'
      RETURNING 1 AS staled
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
      (SELECT count(*)::int FROM refreshed) AS refreshed,
      (SELECT count(*)::int FROM staled) AS staled,
      (SELECT id::text FROM run) AS run_id,
      (SELECT finished_at FROM run) AS finished_at
  `;
};

/** Commits one source's successful run (opportunities + the ok run row). */
export async function commitStateSync(entry: StateSyncWrite): Promise<StateSyncWriteResult> {
  const payload = JSON.stringify(
    entry.opportunities.map((o) => payloadRow(o, entry.finishedAt)),
  );
  const seenCsv = externalIdCsv(entry.seenExternalIds);
  const unchangedCsv = externalIdCsv(entry.unchangedExternalIds);
  const rows = (await COMMIT_RUN_SQL(
    payload,
    entry.stateCode,
    entry.sourceId,
    seenCsv,
    unchangedCsv,
    entry.startedAt,
    entry.finishedAt,
    entry.fetchedCount,
    entry.insertedCount,
    entry.updatedCount,
  )) as {
    touched: number;
    refreshed: number;
    staled: number;
    run_id: string;
    finished_at: unknown;
  }[];
  const row = rows[0];
  if (!row?.run_id) {
    throw new Error("state sync commit returned no run row");
  }
  return {
    runId: String(row.run_id),
    touched: Number(row.touched ?? 0),
    refreshed: Number(row.refreshed ?? 0),
    staled: Number(row.staled ?? 0),
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

/** external_id → fingerprint for one SOURCE. The amendment pre-read. */
export async function readFingerprints(sourceId: string): Promise<Map<string, string>> {
  const db = sql();
  const rows = (await db`
    SELECT external_id, fingerprint
    FROM state_grant_opportunities
    WHERE source_id = ${sourceId}::uuid
  `) as { external_id: string; fingerprint: string }[];
  return new Map(rows.map((r) => [r.external_id, r.fingerprint]));
}

// ── Source registry (owner correction 1, 2026-09-19) ────────────────────────

/**
 * Resolves a connector's source to its row, creating or refreshing it as needed,
 * and returns the row id. This is how a run knows which source it is writing:
 * the id comes from the CONNECTOR (code), never from a payload.
 *
 * Idempotent and no-op-free: an unchanged source rewrites nothing.
 */
export async function ensureStateSource(source: StateGrantSource): Promise<string> {
  const db = sql();
  const rows = (await db`
    WITH inserted AS (
      INSERT INTO state_grant_sources AS t
        (source_key, state_code, name, agency, official_url, official_host, updated_at)
      VALUES (
        ${source.sourceKey}, ${source.stateCode}, ${source.name}, ${source.agency},
        ${source.officialUrl}, ${source.officialHost}, NOW()
      )
      ON CONFLICT (source_key) DO UPDATE SET
        state_code = EXCLUDED.state_code,
        name = EXCLUDED.name,
        agency = EXCLUDED.agency,
        official_url = EXCLUDED.official_url,
        official_host = EXCLUDED.official_host,
        updated_at = EXCLUDED.updated_at
      WHERE t.state_code IS DISTINCT FROM EXCLUDED.state_code
         OR t.name IS DISTINCT FROM EXCLUDED.name
         OR t.agency IS DISTINCT FROM EXCLUDED.agency
         OR t.official_url IS DISTINCT FROM EXCLUDED.official_url
         OR t.official_host IS DISTINCT FROM EXCLUDED.official_host
      RETURNING id
    ), existing AS (
      SELECT id FROM state_grant_sources WHERE source_key = ${source.sourceKey}
    )
    SELECT COALESCE((SELECT id FROM inserted), (SELECT id FROM existing))::text AS id
  `) as { id: string | null }[];
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not resolve the source row for ${source.sourceKey}`);
  return String(id);
}

/**
 * Mirrors the code-level source list into state_grant_sources. Returns how many
 * rows it CREATED (existing rows are refreshed in place only when a value really
 * changed — see ensureStateSource), so a second run against an up-to-date table
 * creates nothing.
 */
export async function syncStateSources(sources: readonly StateGrantSource[]): Promise<number> {
  const db = sql();
  let created = 0;
  for (const source of sources) {
    const before = (await db`
      SELECT id::text AS id FROM state_grant_sources WHERE source_key = ${source.sourceKey}
    `) as { id: string }[];
    await ensureStateSource(source);
    if (before.length === 0) created += 1;
  }
  return created;
}

export interface StateSourceRow {
  id: string;
  sourceKey: string;
  stateCode: string;
  name: string;
  agency: string;
  officialUrl: string;
  officialHost: string;
  updatedAt: string;
}

export async function readStateSources(stateCode: string | null = null): Promise<StateSourceRow[]> {
  const db = sql();
  const rows = (await db`
    SELECT id::text AS id, source_key, state_code, name, agency, official_url, official_host, updated_at
    FROM state_grant_sources
    WHERE (${stateCode}::text IS NULL OR state_code = ${stateCode}::text)
    ORDER BY state_code, name
  `) as {
    id: string;
    source_key: string;
    state_code: string;
    name: string;
    agency: string;
    official_url: string;
    official_host: string;
    updated_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    sourceKey: r.source_key,
    stateCode: r.state_code,
    name: r.name,
    agency: r.agency,
    officialUrl: r.official_url,
    officialHost: r.official_host,
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
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
  status: StateGrantRegistryStatus;
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
    status: StateGrantRegistryStatus;
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
  sourceId: string;
  sourceKey: string;
  stateCode: string;
  externalId: string;
  title: string;
  agency: string | null;
  summary: string | null;
  status: StateGrantStatus;
  postedDate: string | null;
  closeDate: string | null;
  estimatedCloseDate: string | null;
  eligibleApplicants: string;
  eligibleGeography: string;
  categories: string[];
  awardRange: string;
  awardMinAmount: number | null;
  awardMaxAmount: number | null;
  totalFunding: string;
  matchingRequirement: string;
  url: string;
  sourceUrl: string;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
  lastSeenAt: string | null;
  updatedAt: string;
}

export interface StateGrantQuery {
  /** One state, or several (the coverage page's "covered states" filter). */
  stateCode?: string | null;
  stateCodes?: readonly string[] | null;
  /** One source, or several (a state with several sources). */
  sourceKey?: string | null;
  sourceKeys?: readonly string[] | null;
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
  o.id::text AS id, o.source_id::text AS source_id, s.source_key AS source_key,
  o.state_code, o.external_id, o.title, o.agency, o.summary, o.status,
  to_char(o.posted_date, 'YYYY-MM-DD') AS posted_date,
  to_char(o.close_date, 'YYYY-MM-DD') AS close_date,
  to_char(o.estimated_close_date, 'YYYY-MM-DD') AS estimated_close_date,
  o.eligible_applicants, o.eligible_geography, o.categories, o.award_range,
  o.award_min_amount::text AS award_min_amount, o.award_max_amount::text AS award_max_amount,
  o.total_funding, o.matching_requirement,
  o.url, o.source_url, o.source_updated_at, o.fetched_at, o.last_seen_at, o.updated_at`;

interface RawStateGrantRow {
  id: string;
  source_id: string;
  source_key: string | null;
  state_code: string;
  external_id: string;
  title: string;
  agency: string | null;
  summary: string | null;
  status: StateGrantStatus;
  posted_date: string | null;
  close_date: string | null;
  estimated_close_date: string | null;
  eligible_applicants: string;
  eligible_geography: string;
  categories: string[] | string | null;
  award_range: string;
  award_min_amount: string | null;
  award_max_amount: string | null;
  total_funding: string;
  matching_requirement: string;
  url: string;
  source_url: string;
  source_updated_at: string | null;
  fetched_at: string;
  last_seen_at: string | null;
  updated_at: string;
}

/** Postgres `text[]` as either a JS array or a `{a,b}` literal — both handled. */
function textArray(value: string[] | string | null): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  const inner = value.replace(/^\{|\}$/g, "");
  if (!inner) return [];
  return inner.split(",").map((v) => v.replace(/^"|"$/g, ""));
}

function numeric(value: string | null): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapRow(r: RawStateGrantRow): StateGrantRow {
  return {
    id: r.id,
    sourceId: r.source_id,
    sourceKey: r.source_key ?? "",
    stateCode: r.state_code,
    externalId: r.external_id,
    title: r.title,
    agency: r.agency,
    summary: r.summary,
    status: r.status,
    postedDate: r.posted_date,
    closeDate: r.close_date,
    estimatedCloseDate: r.estimated_close_date,
    eligibleApplicants: r.eligible_applicants,
    eligibleGeography: r.eligible_geography,
    categories: textArray(r.categories),
    awardRange: r.award_range,
    awardMinAmount: numeric(r.award_min_amount),
    awardMaxAmount: numeric(r.award_max_amount),
    totalFunding: r.total_funding,
    matchingRequirement: r.matching_requirement,
    url: r.url,
    sourceUrl: r.source_url,
    sourceUpdatedAt: r.source_updated_at ? new Date(r.source_updated_at).toISOString() : null,
    fetchedAt: new Date(r.fetched_at).toISOString(),
    lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/**
 * Searches stored state opportunities. Every filter is an optional bound
 * parameter (`IS NULL OR …`), so there are no dynamically assembled SQL strings
 * and nothing a caller passes can change the statement's shape.
 *
 * Ordering is the product's canonical one (STATE_GRANT_STATUS_ORDER): open, then
 * upcoming, then rolling, then closed, then unverified, and within a status the
 * nearest closing date first (rows with no closing date last, never first).
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
  const sourceKey = query.sourceKey ?? null;
  const sourceKeys =
    query.sourceKeys && query.sourceKeys.length > 0
      ? query.sourceKeys.map((s) => s.trim()).filter(Boolean).join(",")
      : null;
  const status = query.status ?? null;
  const term = query.term && query.term.trim() ? likeTerm(query.term.trim()) : null;
  const db = sql();

  const rows = (await db`
    SELECT ${db.unsafe(ROW_COLUMNS)}
    FROM state_grant_opportunities o
    LEFT JOIN state_grant_sources s ON s.id = o.source_id
    WHERE (${stateCode}::text IS NULL OR o.state_code = ${stateCode}::text)
      AND (${stateCodes}::text IS NULL OR o.state_code = ANY(string_to_array(${stateCodes}::text, ',')))
      AND (${sourceKey}::text IS NULL OR s.source_key = ${sourceKey}::text)
      AND (${sourceKeys}::text IS NULL OR s.source_key = ANY(string_to_array(${sourceKeys}::text, ',')))
      AND (${status}::text IS NULL OR o.status = ${status}::text)
      AND (
        ${term}::text IS NULL
        OR o.title ILIKE ${term}::text
        OR COALESCE(o.agency, '') ILIKE ${term}::text
        OR COALESCE(o.summary, '') ILIKE ${term}::text
      )
    ORDER BY
      CASE o.status WHEN 'open' THEN 0 WHEN 'upcoming' THEN 1 WHEN 'rolling' THEN 2 WHEN 'closed' THEN 3 ELSE 4 END,
      o.close_date ASC NULLS LAST,
      o.title ASC
    LIMIT ${limit} OFFSET ${offset}
  `) as RawStateGrantRow[];

  const countRows = (await db`
    SELECT count(*)::int AS total
    FROM state_grant_opportunities o
    LEFT JOIN state_grant_sources s ON s.id = o.source_id
    WHERE (${stateCode}::text IS NULL OR o.state_code = ${stateCode}::text)
      AND (${stateCodes}::text IS NULL OR o.state_code = ANY(string_to_array(${stateCodes}::text, ',')))
      AND (${sourceKey}::text IS NULL OR s.source_key = ${sourceKey}::text)
      AND (${sourceKeys}::text IS NULL OR s.source_key = ANY(string_to_array(${sourceKeys}::text, ',')))
      AND (${status}::text IS NULL OR o.status = ${status}::text)
      AND (
        ${term}::text IS NULL
        OR o.title ILIKE ${term}::text
        OR COALESCE(o.agency, '') ILIKE ${term}::text
        OR COALESCE(o.summary, '') ILIKE ${term}::text
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
  const counts = { open: 0, upcoming: 0, rolling: 0, closed: 0, unverified: 0, total: 0 };
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
