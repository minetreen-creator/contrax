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
  PRIMES_NAICS_OPTION_CAP,
  SUBNET_SOURCE_LABEL,
  SUBNET_SOURCE_URL,
  UNAVAILABLE_NEVER_SYNCED_REASON,
  UNAVAILABLE_STORE_REASON,
  UNAVAILABLE_TABLES_REASON,
  UNAVAILABLE_EXPLANATION,
  excludedNoClosingDateText,
  normalizeStamp,
  tallyByState,
  tallyByTrade,
  toNoticeView,
  toPrimeView,
  type CountBucket,
  type PrimesPayload,
  type PrimesQuery,
  type PrimesResponse,
  type StoredNoticeRow,
  type StoredPrimeRow,
  type SubcontractsCoverage,
  type SubcontractsPayload,
  type SubcontractsResponse,
  type SubcontractsUnavailable,
} from "~/lib/subcontracts/read";
import { SUBNET_SOURCE, PRIME_DIRECTORY_SOURCE } from "~/lib/subcontracts/connector";

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

/** The filter option lists, read from the stored FY24 file (never invented). */
async function readPrimeOptions(): Promise<{
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
    WHERE s.source_key = ${PRIME_DIRECTORY_SOURCE.sourceKey}
    GROUP BY n
    ORDER BY count DESC, key ASC
    LIMIT ${PRIMES_NAICS_OPTION_CAP + 1}
  `) as CountBucket[];
  const states = (await db`
    SELECT p.vendor_state AS key, count(*)::int AS count
    FROM subcontract_primes p
    JOIN subcontract_sources s ON s.id = p.source_id
    WHERE s.source_key = ${PRIME_DIRECTORY_SOURCE.sourceKey} AND p.vendor_state IS NOT NULL
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
 * GET /api/subcontracts/primes — server-side filtered + paged read of the annual
 * FY24 directory. `naics` matches the CODE half of the stored `"541330: …"` values;
 * `state` matches the stored uppercase state name. Both filters bind as `NULL` when
 * absent (one statement, no fragment composition — see the note in the SQL), so a
 * missing filter can never be mistaken for a filter value.
 */
export async function readPrimesPayload(
  query: PrimesQuery,
  now: Date = new Date(),
): Promise<PrimesResponse> {
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

  try {
    const db = sql();
    const offset = (query.page - 1) * query.limit;
    const [rawRows, rawTotals, options] = await Promise.all([
      db`
        SELECT
          p.legal_name, p.uei, p.vendor_state, p.naics, p.industries, p.agencies,
          p.award_rows, p.latest_pop_start, p.subcontract_plan_type, p.fy, p.source_url
        FROM subcontract_primes p
        JOIN subcontract_sources s ON s.id = p.source_id
        WHERE s.source_key = ${PRIME_DIRECTORY_SOURCE.sourceKey}
          AND (${query.state}::text IS NULL OR upper(p.vendor_state) = ${query.state}::text)
          AND (
            ${query.naics}::text IS NULL
            OR EXISTS (
              SELECT 1 FROM unnest(p.naics) AS n WHERE split_part(n, ':', 1) = ${query.naics}::text
            )
          )
        ORDER BY p.legal_name ASC
        LIMIT ${query.limit} OFFSET ${offset}
      `,
      db`
        SELECT
          count(*)::int AS directory_total,
          count(*) FILTER (
            WHERE (${query.state}::text IS NULL OR upper(p.vendor_state) = ${query.state}::text)
              AND (
                ${query.naics}::text IS NULL
                OR EXISTS (
                  SELECT 1 FROM unnest(p.naics) AS n WHERE split_part(n, ':', 1) = ${query.naics}::text
                )
              )
          )::int AS matched
        FROM subcontract_primes p
        JOIN subcontract_sources s ON s.id = p.source_id
        WHERE s.source_key = ${PRIME_DIRECTORY_SOURCE.sourceKey}
      `,
      readPrimeOptions(),
    ]);

    const rows = (rawRows ?? []) as StoredPrimeRow[];
    // `matched` applies the SAME predicate as the row query (absent filter ⇒ no
    // restriction), so the label above the list and the list itself cannot disagree.
    const total = ((rawTotals ?? []) as { directory_total: number; matched: number }[])[0];
    const filtered = Number(total?.matched ?? 0);

    const payload: PrimesPayload = {
      rows: rows.map(toPrimeView),
      counts: { filtered, directoryTotal: Number(total?.directory_total ?? 0) },
      fy: rows[0]?.fy?.trim() || PRIME_DIRECTORY_FY,
      sourceUrl: PRIME_DIRECTORY_SOURCE_URL,
      page: query.page,
      limit: query.limit,
      hasMore: offset + rows.length < filtered,
      options,
      generatedAt: now.toISOString(),
    };
    return payload;
  } catch (err) {
    console.error("[subcontracts-primes] read failed:", err);
    return unavailable(UNAVAILABLE_STORE_REASON);
  }
}
