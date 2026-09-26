/**
 * Contrax — SUBCONTRACTING preview, READ side: the Postgres half
 * (owner directive 2026-09-25, BUILD-PLAN.md §6.3/§6.4).
 *
 * READ-ONLY BY CONSTRUCTION: every statement in this module is a SELECT. There is
 * no writer here, no migration, no cache table and no external request — the page
 * reads what the sweeper stored and nothing else. The shaping rules (labels,
 * counts, "not specified" fallbacks, query validation) live in the pure module
 * `read.ts`; this file only decides WHICH rows are read.
 *
 * FAIL-CLOSED, IN THREE DISTINCT SENSES:
 *   1. MISSING TABLES. Presence is probed with `to_regclass`, which returns NULL
 *      instead of erroring for a table that does not exist — so a database without
 *      migration 050 is detected deliberately, not by catching an exception whose
 *      message we would then be guessing at. The result is an explicit
 *      `unavailable` payload with a reason string. It is NEVER an empty list: an
 *      empty list would read as "there are no subcontracting notices", a claim this
 *      deployment cannot support from a store it cannot read.
 *   2. NO COMPLETED SWEEP. A store that exists but has never completed a sweep has
 *      no checked open set, so it too is `unavailable` — not "0 open notices".
 *   3. STORE ERRORS. Any thrown error (no connection string, network, SQL) becomes
 *      the same explicit `unavailable` shape; the error itself is logged, never put
 *      in front of a visitor.
 *
 * A ZERO COUNT, BY CONTRAST, NEVER STANDS ALONE: it is only ever reported next to
 * `lastSyncAt` (the successful sweep's finish time), which is what makes "0 open
 * notices" a statement about a real, timestamped check.
 */
import { sql } from "~/db";
import {
  PRIME_DIRECTORY_FY,
  PRIME_DIRECTORY_SOURCE_URL,
  GSA_PRIME_DIRECTORY_FY,
  GSA_PRIME_DIRECTORY_SOURCE_URL,
  PRIMES_DEFAULT_SOURCE,
  PRIMES_NAICS_OPTION_CAP,
  SUBNET_SOURCE_LABEL,
  SUBNET_SOURCE_URL,
  UNAVAILABLE_GSA_NEVER_SYNCED_REASON,
  UNAVAILABLE_NEVER_SYNCED_REASON,
  UNAVAILABLE_STORE_REASON,
  UNAVAILABLE_TABLES_REASON,
  UNAVAILABLE_EXPLANATION,
  excludedNoClosingDateText,
  gsaNonNaicsText,
  normalizeDay,
  normalizeStamp,
  tallyByState,
  tallyByTrade,
  toNoticeView,
  toPrimeView,
  validatePrimesQuery,
  validatePrimesSource,
  type CountBucket,
  type PrimesPayload,
  type PrimesQuery,
  type PrimesReadResponse,
  type PrimesSourceId,
  type StoredNoticeRow,
  type StoredPrimeRow,
  type SubcontractsCoverage,
  type SubcontractsPayload,
  type SubcontractsResponse,
  type SubcontractsUnavailable,
} from "~/lib/subcontracts/read";
import {
  SUBNET_SOURCE,
  PRIME_DIRECTORY_SOURCE,
  GSA_PRIME_DIRECTORY_SOURCE,
} from "~/lib/subcontracts/connector";

type CoverageTier = SubcontractsCoverage["tier"];

function unavailable(reason: string): SubcontractsUnavailable {
  return {
    unavailable: { reason, explanation: UNAVAILABLE_EXPLANATION, sourceUrl: SUBNET_SOURCE_URL },
  };
}

function isTier(value: unknown): value is CoverageTier {
  return (
    value === "unavailable" || value === "limited" || value === "curated" || value === "connected"
  );
}

/** The four tables one migration creates; a partial set is not a state we describe. */
interface TablePresence {
  opportunities: boolean;
  sources: boolean;
  runs: boolean;
  primes: boolean;
}

export async function subcontractTablesPresent(): Promise<TablePresence> {
  const db = sql();
  const rows = (await db`
    SELECT
      to_regclass('public.subcontract_opportunities') IS NOT NULL AS opportunities,
      to_regclass('public.subcontract_sources') IS NOT NULL AS sources,
      to_regclass('public.subcontract_sync_runs') IS NOT NULL AS runs,
      to_regclass('public.subcontract_primes') IS NOT NULL AS primes
  `) as TablePresence[];
  const row = rows[0];
  return {
    opportunities: Boolean(row?.opportunities),
    sources: Boolean(row?.sources),
    runs: Boolean(row?.runs),
    primes: Boolean(row?.primes),
  };
}

/** The latest SUCCESSFUL sweep's finish time — the only honest freshness for the page. */
export async function latestOkSweepFinishedAt(sourceKey: string): Promise<string | null> {
  const db = sql();
  const rows = (await db`
    SELECT finished_at
    FROM subcontract_sync_runs
    WHERE source_key = ${sourceKey} AND status = 'ok'
    ORDER BY finished_at DESC
    LIMIT 1
  `) as { finished_at: string | Date }[];
  return rows[0] ? normalizeStamp(rows[0].finished_at) : null;
}

/** The stored OPEN notices, with the closing date ascending (soonest first). */
export async function readOpenNotices(sourceKey: string): Promise<StoredNoticeRow[]> {
  const db = sql();
  return (await db`
    SELECT
      o.external_id, o.title, o.prime, o.prime_division, o.website, o.scope, o.summary,
      o.trades, o.certs_solicited, o.naics_code, o.naics_title, o.place_of_performance,
      o.state_code, o.closing_date, o.performance_start_date, o.contact_name,
      o.contact_email, o.source_url, o.detail_url, o.status, o.last_verified_at
    FROM subcontract_opportunities o
    JOIN subcontract_sources s ON s.id = o.source_id
    WHERE s.source_key = ${sourceKey} AND o.status = 'open'
    ORDER BY o.closing_date ASC NULLS LAST, o.title ASC
  `) as StoredNoticeRow[];
}

/** Rows the open list EXCLUDES because the source stated no closing date. */
export async function countUnverified(sourceKey: string): Promise<number> {
  const db = sql();
  const rows = (await db`
    SELECT count(*)::int AS count
    FROM subcontract_opportunities o
    JOIN subcontract_sources s ON s.id = o.source_id
    WHERE s.source_key = ${sourceKey} AND o.status = 'unverified'
  `) as { count: number }[];
  return Number(rows[0]?.count ?? 0);
}

/** The tier the registry gives the SUBNet source (the four-step ladder). */
export async function readSourceTier(sourceKey: string, fallback: CoverageTier): Promise<CoverageTier> {
  const db = sql();
  const rows = (await db`
    SELECT coverage_tier FROM subcontract_sources WHERE source_key = ${sourceKey}
  `) as { coverage_tier: string }[];
  const tier = rows[0]?.coverage_tier;
  return isTier(tier) ? tier : fallback;
}

/** The annual prime directory's stored size + fiscal year (for the separate section). */
export async function readPrimeDirectoryTotals(): Promise<{ total: number; fy: string }> {
  const db = sql();
  const rows = (await db`
    SELECT count(*)::int AS total, max(p.fy) AS fy
    FROM subcontract_primes p
    JOIN subcontract_sources s ON s.id = p.source_id
    WHERE s.source_key = ${PRIME_DIRECTORY_SOURCE.sourceKey}
  `) as { total: number; fy: string | null }[];
  return {
    total: Number(rows[0]?.total ?? 0),
    // An empty table has no stored fiscal year to echo; the constant is the file the
    // seed loads, and it is only ever shown next to the (zero) stored row count.
    fy: rows[0]?.fy?.trim() || PRIME_DIRECTORY_FY,
  };
}

/** The filter option lists, read from the stored file for ONE source (never invented). */
async function readPrimeOptions(sourceKey: string): Promise<{
  naics: CountBucket[];
  states: CountBucket[];
  naicsTruncated: boolean;
}> {
  const db = sql();
  const naics = (await db`
    SELECT n AS key, count(*)::int AS count
    FROM subcontract_primes p
    JOIN subcontract_sources s ON s.id = p.source_id,
    unnest(p.naics) AS n
    WHERE s.source_key = ${sourceKey}
    GROUP BY n
    ORDER BY count DESC, key ASC
    LIMIT ${PRIMES_NAICS_OPTION_CAP + 1}
  `) as CountBucket[];
  const states = (await db`
    SELECT p.vendor_state AS key, count(*)::int AS count
    FROM subcontract_primes p
    JOIN subcontract_sources s ON s.id = p.source_id
    WHERE s.source_key = ${sourceKey} AND p.vendor_state IS NOT NULL
    GROUP BY p.vendor_state
    ORDER BY count DESC, key ASC
  `) as CountBucket[];
  return {
    naics: naics.slice(0, PRIMES_NAICS_OPTION_CAP).map((row) => ({ key: row.key, count: Number(row.count) })),
    states: states.map((row) => ({ key: row.key, count: Number(row.count) })),
    naicsTruncated: naics.length > PRIMES_NAICS_OPTION_CAP,
  };
}

/**
 * GET /api/subcontracts — the page's one read. Returns the open notices, the counts
 * derived from those same rows, the coverage block, and the annual prime-directory
 * totals. The prime ROWS are deliberately not shipped here: 2,917 companies belong
 * to the paged `/api/subcontracts/primes` call, not to every page load.
 */
export async function readSubcontractsPayload(now: Date = new Date()): Promise<SubcontractsResponse> {
  let presence: TablePresence;
  try {
    presence = await subcontractTablesPresent();
  } catch (err) {
    console.error("[subcontracts-read] store unreachable:", err);
    return unavailable(UNAVAILABLE_STORE_REASON);
  }
  if (!presence.opportunities || !presence.sources || !presence.runs || !presence.primes) {
    console.warn("[subcontracts-read] subcontract tables missing:", presence);
    return unavailable(UNAVAILABLE_TABLES_REASON);
  }

  try {
    const lastSyncAt = await latestOkSweepFinishedAt(SUBNET_SOURCE.sourceKey);
    if (!lastSyncAt) return unavailable(UNAVAILABLE_NEVER_SYNCED_REASON);

    const [storedRows, missingClosingDateCount, tier, primeTotals] = await Promise.all([
      readOpenNotices(SUBNET_SOURCE.sourceKey),
      countUnverified(SUBNET_SOURCE.sourceKey),
      readSourceTier(SUBNET_SOURCE.sourceKey, SUBNET_SOURCE.coverageTier),
      readPrimeDirectoryTotals(),
    ]);

    // The fallback freshness: the newest row-level fetch time we stored. Both are
    // OUR fetch times; `lastSyncAt` is the sweep's own finish, which is the label
    // the page prints.
    const lastCheckedAt =
      storedRows
        .map((row) => normalizeStamp(row.last_verified_at))
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;

    const payload: SubcontractsPayload = {
      rows: storedRows.map(toNoticeView),
      counts: {
        total: storedRows.length,
        byState: tallyByState(storedRows),
        byTrade: tallyByTrade(storedRows),
      },
      coverage: {
        source: SUBNET_SOURCE_LABEL,
        tier,
        lastSyncAt,
        lastCheckedAt,
        missingClosingDateCount,
        excludedText: excludedNoClosingDateText(missingClosingDateCount),
      },
      primeDirectory: {
        fy: primeTotals.fy,
        sourceUrl: PRIME_DIRECTORY_SOURCE_URL,
        counts: { total: primeTotals.total },
      },
      generatedAt: now.toISOString(),
    };
    return payload;
  } catch (err) {
    console.error("[subcontracts-read] read failed:", err);
    return unavailable(UNAVAILABLE_STORE_REASON);
  }
}

/**
 * GET /api/subcontracts/primes — server-side filtered + paged read of a prime DIRECTORY.
 *
 * `source` selects WHICH directory: `sba` (default — the annual FY24 file, whose SQL and
 * response are unchanged) or `gsa` (the GSA contractor directory, migration 051). The
 * filters are identical for both: `naics` matches the CODE half of a stored NAICS value
 * (`"541330: TITLE"` for SBA, a bare `"541330"` for GSA), `state` matches the stored
 * uppercase state name. Both filters bind as `NULL` when absent (one statement, no
 * fragment composition), so a missing filter can never be mistaken for a filter value.
 *
 * THE TWO READS USE DIFFERENT STATEMENTS ON PURPOSE. The SBA statement is the shipped
 * one, untouched, and never references a migration-051 column: a deployment whose database
 * has 050 but not yet 051 keeps serving the SBA directory exactly as before. The GSA
 * statement reads the four new columns (including `naics_raw`, the verbatim cell of a row
 * whose code is NOT a valid six-digit code — evidence, never displayed), so before 051 it
 * fails into the SAME fail-closed unavailable state rather than reporting a wrong or
 * partial list.
 *
 * THE GSA SOURCE ALSO REQUIRES A RECORDED CHECK. Its section prints "last checked by
 * Contrax" plus a REAL timestamp, so with no completed run recorded there is no honest
 * line to print — the read returns `unavailable` (never an empty list).
 */
export async function readPrimesPayload(
  query: PrimesQuery,
  sourceId: PrimesSourceId = PRIMES_DEFAULT_SOURCE,
  now: Date = new Date(),
): Promise<PrimesReadResponse> {
  // PARSE/VALIDATE FIRST — before the table check, before any SQL. A NaN/absent/out-of-
  // range parameter used to bind straight into LIMIT/OFFSET, where Postgres rejects it
  // and the catch below reported the store as unreachable: a bad REQUEST answered with a
  // claim about the DATABASE. Invalid input now returns the documented 400 body and the
  // store is never touched (see validatePrimesQuery).
  const validated = validatePrimesQuery(query);
  if (!validated.ok) return { ok: false, error: validated.error };
  const validatedSource = validatePrimesSource(sourceId);
  if (!validatedSource.ok) return { ok: false, error: validatedSource.error };
  const source = validatedSource.value;
  const parsed = validated.value;

  let presence: TablePresence;
  try {
    presence = await subcontractTablesPresent();
  } catch (err) {
    console.error("[subcontracts-primes] store unreachable:", err);
    return unavailable(UNAVAILABLE_STORE_REASON);
  }
  if (!presence.primes || !presence.sources) {
    console.warn("[subcontracts-primes] subcontract tables missing:", presence);
    return unavailable(UNAVAILABLE_TABLES_REASON);
  }

  const sourceKey =
    source === "gsa" ? GSA_PRIME_DIRECTORY_SOURCE.sourceKey : PRIME_DIRECTORY_SOURCE.sourceKey;
  const sourceUrl =
    source === "gsa" ? GSA_PRIME_DIRECTORY_SOURCE_URL : PRIME_DIRECTORY_SOURCE_URL;

  try {
    let lastCheckedAt: string | null = null;
    let sourceFile: string | null = null;
    if (source === "gsa") {
      // The honest freshness: only a COMPLETED check counts, and without one there is no
      // timestamp to print and no row set that was ever verified.
      const latest = await latestCompletedRun(sourceKey);
      if (!latest) return unavailable(UNAVAILABLE_GSA_NEVER_SYNCED_REASON);
      lastCheckedAt = latest.finishedAt;
      sourceFile = latest.fileName;
    }

    const db = sql();
    const offset = (parsed.page - 1) * parsed.limit;
    const optionsPromise = readPrimeOptions(sourceKey);
    const [rawRows, rawTotals, options] = await Promise.all([
      source === "gsa"
        ? db`
            SELECT
              p.legal_name, p.uei, p.vendor_state, p.naics, p.industries, p.agencies,
              p.award_rows, p.latest_pop_start, p.subcontract_plan_type, p.fy, p.source_url,
              p.vendor_address, p.products_services, p.source_file_date, p.naics_raw
            FROM subcontract_primes p
            JOIN subcontract_sources s ON s.id = p.source_id
            WHERE s.source_key = ${sourceKey}
              AND (${parsed.state}::text IS NULL OR upper(p.vendor_state) = ${parsed.state}::text)
              AND (
                ${parsed.naics}::text IS NULL
                OR EXISTS (
                  SELECT 1 FROM unnest(p.naics) AS n WHERE split_part(n, ':', 1) = ${parsed.naics}::text
                )
              )
            ORDER BY p.legal_name ASC
            LIMIT ${parsed.limit} OFFSET ${offset}
          `
        : db`
            SELECT
              p.legal_name, p.uei, p.vendor_state, p.naics, p.industries, p.agencies,
              p.award_rows, p.latest_pop_start, p.subcontract_plan_type, p.fy, p.source_url
            FROM subcontract_primes p
            JOIN subcontract_sources s ON s.id = p.source_id
            WHERE s.source_key = ${sourceKey}
              AND (${parsed.state}::text IS NULL OR upper(p.vendor_state) = ${parsed.state}::text)
              AND (
                ${parsed.naics}::text IS NULL
                OR EXISTS (
                  SELECT 1 FROM unnest(p.naics) AS n WHERE split_part(n, ':', 1) = ${parsed.naics}::text
                )
              )
            ORDER BY p.legal_name ASC
            LIMIT ${parsed.limit} OFFSET ${offset}
          `,
      db`
        SELECT
          count(*)::int AS directory_total,
          count(*) FILTER (
            WHERE (${parsed.state}::text IS NULL OR upper(p.vendor_state) = ${parsed.state}::text)
              AND (
                ${parsed.naics}::text IS NULL
                OR EXISTS (
                  SELECT 1 FROM unnest(p.naics) AS n WHERE split_part(n, ':', 1) = ${parsed.naics}::text
                )
              )
          )::int AS matched
        FROM subcontract_primes p
        JOIN subcontract_sources s ON s.id = p.source_id
        WHERE s.source_key = ${sourceKey}
      `,
      optionsPromise,
    ]);

    const rows = (rawRows ?? []) as StoredPrimeRow[];
    // `matched` applies the SAME predicate as the row query (absent filter ⇒ no
    // restriction), so the label above the list and the list itself cannot disagree.
    const total = ((rawTotals ?? []) as { directory_total: number; matched: number }[])[0];
    const filtered = Number(total?.matched ?? 0);

    // The GSA block: a REAL recorded check timestamp, the source's own file evidence, and
    // a LIVE count of the stored rows whose NAICS cell was not a valid code. The honesty
    // line is built from that same number, so the count and the sentence cannot disagree.
    let gsa: PrimesPayload["gsa"];
    if (source === "gsa") {
      const nonNaicsRows = await countNonNaicsRows(sourceKey);
      gsa = {
        lastCheckedAt,
        sourceFileDate: storedSourceFileDate(rows),
        sourceFile,
        nonNaicsRows,
        nonNaicsText: gsaNonNaicsText(nonNaicsRows),
      };
    }

    const payload: PrimesPayload = {
      rows: rows.map(toPrimeView),
      counts: { filtered, directoryTotal: Number(total?.directory_total ?? 0) },
      fy: rows[0]?.fy?.trim() || (source === "gsa" ? GSA_PRIME_DIRECTORY_FY : PRIME_DIRECTORY_FY),
      sourceUrl,
      page: parsed.page,
      limit: parsed.limit,
      hasMore: offset + rows.length < filtered,
      options,
      generatedAt: now.toISOString(),
      source,
      ...(gsa ? { gsa } : {}),
    };
    return payload;
  } catch (err) {
    console.error("[subcontracts-primes] read failed:", err);
    return unavailable(UNAVAILABLE_STORE_REASON);
  }
}

/** The latest COMPLETED run for a source: its finish time and the file it checked. */
async function latestCompletedRun(
  sourceKey: string,
): Promise<{ finishedAt: string; fileName: string | null } | null> {
  const db = sql();
  const rows = (await db`
    SELECT finished_at, counts->>'fileName' AS file_name
    FROM subcontract_sync_runs
    WHERE source_key = ${sourceKey} AND status = 'ok'
    ORDER BY finished_at DESC
    LIMIT 1
  `) as { finished_at: string | Date; file_name: string | null }[];
  const row = rows[0];
  if (!row) return null;
  const finishedAt = normalizeStamp(row.finished_at);
  if (!finishedAt) return null;
  return { finishedAt, fileName: row.file_name?.trim() || null };
}

/** Stored GSA rows whose NAICS cell was not a valid 6-digit code (a LIVE count). */
async function countNonNaicsRows(sourceKey: string): Promise<number> {
  const db = sql();
  const rows = (await db`
    SELECT count(*)::int AS count
    FROM subcontract_primes p
    JOIN subcontract_sources s ON s.id = p.source_id
    WHERE s.source_key = ${sourceKey} AND COALESCE(array_length(p.naics, 1), 0) = 0
  `) as { count: number }[];
  return Number(rows[0]?.count ?? 0);
}

/** The GSA source's own file date as STORED on the rows (evidence, never a claim). */
function storedSourceFileDate(rows: readonly StoredPrimeRow[]): string | null {
  const days = rows
    .map((row) => normalizeDay(row.source_file_date))
    .filter((day): day is string => Boolean(day))
    .sort();
  return days.at(-1) ?? null;
}
