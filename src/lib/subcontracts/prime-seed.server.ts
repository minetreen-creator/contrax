/**
 * Contrax — SUBCONTRACTING preview: the PRIME-DIRECTORY SEED (SERVER-ONLY)
 * (owner directive 2026-09-25, BUILD-PLAN §6.1 S2 / §6.2 `subcontract_primes`).
 *
 * WHAT IT DOES. Reads the saved FY24 SBA directory XLSX, maps it (row grain) and collapses
 * it (company grain) in `prime-directory.ts`, resolves the `sba-prime-directory` source
 * row, and UPSERTS one row per company into `subcontract_primes` on the table's own
 * identity, `UNIQUE (source_id, uei)`.
 *
 * IDEMPOTENT + ADDITIVE. Re-running with the same file rewrites NOTHING (`WHERE` every
 * content column differs, so the second run's `touched` is 0), and the statement only ever
 * inserts/updates rows of this one source — no other table is touched, nothing is deleted.
 * A company that disappears from a later FY file is NOT removed automatically: the loader
 * is additive by design, and the FY is carried by `fy` so a stale row stays visibly FY24.
 *
 * FAIL-CLOSED. A missing file, an unreadable workbook, a missing column, or zero mapped
 * companies all abort BEFORE any statement is issued — never a silent empty import.
 *
 * KNOWN LIMITATION, stated rather than papered over: the unique key is (source, uei), so a
 * FUTURE annual file loaded under the SAME source row would overwrite that UEI's row
 * (including its `fy`). Per-year coexistence would need a per-year `source_key` (e.g.
 * `sba-fy25-directory`) or a wider unique key — a schema/identity decision for the lead,
 * not something this loader may invent. Loading FY24 first is correct and safe.
 */
import { readFileSync } from "node:fs";
import { sql } from "~/db";
import { PRIME_DIRECTORY_SOURCE } from "~/lib/subcontracts/connector";
import {
  aggregatePrimes,
  primeAwardRows,
  type PrimeAggregationAccounting,
  type PrimeRowAccounting,
  type PrimeSeedRow,
} from "~/lib/subcontracts/prime-directory";
import { readXlsxSheet } from "~/lib/subcontracts/xlsx";
import { ensureSubcontractSource } from "~/lib/subcontracts/store.server";

/** Rows per statement. The payload is JSON over Neon's HTTP driver; 500 keeps it small. */
export const PRIME_SEED_BATCH_SIZE = 500;

export interface PrimeSeedOptions {
  /** Path to the FY24 XLSX. Required — there is no default inside the library. */
  file?: string;
  /** Already-read workbook bytes (tests / a caller that fetched it itself). */
  bytes?: Uint8Array;
  /** Map + aggregate + report, write NOTHING and resolve no source row. */
  dryRun?: boolean;
  /** Clock for `fetched_at` (tests). */
  now?: Date;
}

export interface PrimeSeedResult {
  file: string | null;
  sourceKey: string;
  sourceId: string | null;
  fy: string;
  /** Companies mapped from the workbook, before the write. */
  companies: number;
  awards: number;
  rowAccounting: PrimeRowAccounting;
  aggregation: PrimeAggregationAccounting;
  inserted: number;
  updated: number;
  /** Rows the statement actually wrote (inserted + updated). */
  touched: number;
  /** Distinct plan types as stored, straight from the DB after the run. */
  storedPlanTypes: Record<string, number> | null;
  dryRun: boolean;
  durationMs: number;
}

export class PrimeSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrimeSeedError";
  }
}

/** Reads the workbook, or throws with the path it tried (never an empty corpus). */
export function readPrimeDirectoryWorkbook(file: string): Uint8Array {
  try {
    return readFileSync(file);
  } catch (e) {
    throw new PrimeSeedError(
      `cannot read the FY24 SBA prime-directory workbook at ${file} (${
        e instanceof Error ? e.message : String(e)
      }) — pass --file <path>; the saved evidence file is shared/subcontracting-preview-2026-09-25/evidence/fy24.xlsx and the canonical page is ${PRIME_DIRECTORY_SOURCE.officialUrl}`,
    );
  }
}

/**
 * `subcontract_primes` upsert for one batch. `RETURNING (xmax = 0) AS inserted` is how the
 * statement reports inserts vs updates without a second query (a row this statement inserted
 * has xmax = 0; a row it updated carries the previous transaction id).
 */
async function upsertPrimeBatch(
  sourceId: string,
  rows: readonly PrimeSeedRow[],
  fetchedAt: string,
): Promise<{ inserted: number; updated: number }> {
  const db = sql();
  // The payload keys are the SQL column names (jsonb_to_recordset matches by name) — the
  // mapping is explicit so a renamed TypeScript field can never silently insert a NULL.
  const payload = JSON.stringify(
    rows.map((row) => ({
      uei: row.uei,
      legal_name: row.legalName,
      ultimate_parent_name: row.ultimateParentName,
      ultimate_parent_uei: row.ultimateParentUei,
      naics: row.naics,
      industries: row.industries,
      vendor_state: row.vendorState,
      pop_states: row.popStates,
      agencies: row.agencies,
      award_rows: row.awardRows,
      value: row.value,
      latest_pop_start: row.latestPopStart,
      subcontract_plan_type: row.subcontractPlanType,
      fy: row.fy,
      source_url: row.sourceUrl,
    })),
  );
  const result = (await db`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        uei text, legal_name text, ultimate_parent_name text, ultimate_parent_uei text,
        naics jsonb, industries jsonb, vendor_state text, pop_states jsonb, agencies jsonb,
        award_rows int, value numeric, latest_pop_start text, subcontract_plan_type text,
        fy text, source_url text
      )
    ), written AS (
      INSERT INTO subcontract_primes AS t (
        source_id, uei, legal_name, ultimate_parent_name, ultimate_parent_uei, naics,
        industries, vendor_state, pop_states, agencies, award_rows, value, latest_pop_start,
        subcontract_plan_type, fy, source_url, fetched_at
      )
      SELECT
        ${sourceId}::uuid, uei, legal_name, ultimate_parent_name, ultimate_parent_uei,
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(naics)), '{}'::text[]),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(industries)), '{}'::text[]),
        vendor_state,
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(pop_states)), '{}'::text[]),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(agencies)), '{}'::text[]),
        award_rows, value, NULLIF(latest_pop_start, '')::date, subcontract_plan_type, fy,
        source_url, ${fetchedAt}::timestamptz
      FROM input
      ON CONFLICT (source_id, uei) DO UPDATE SET
        legal_name = EXCLUDED.legal_name,
        ultimate_parent_name = EXCLUDED.ultimate_parent_name,
        ultimate_parent_uei = EXCLUDED.ultimate_parent_uei,
        naics = EXCLUDED.naics,
        industries = EXCLUDED.industries,
        vendor_state = EXCLUDED.vendor_state,
        pop_states = EXCLUDED.pop_states,
        agencies = EXCLUDED.agencies,
        award_rows = EXCLUDED.award_rows,
        value = EXCLUDED.value,
        latest_pop_start = EXCLUDED.latest_pop_start,
        subcontract_plan_type = EXCLUDED.subcontract_plan_type,
        fy = EXCLUDED.fy,
        source_url = EXCLUDED.source_url,
        fetched_at = EXCLUDED.fetched_at
      WHERE t.legal_name IS DISTINCT FROM EXCLUDED.legal_name
         OR t.ultimate_parent_name IS DISTINCT FROM EXCLUDED.ultimate_parent_name
         OR t.ultimate_parent_uei IS DISTINCT FROM EXCLUDED.ultimate_parent_uei
         OR t.naics IS DISTINCT FROM EXCLUDED.naics
         OR t.industries IS DISTINCT FROM EXCLUDED.industries
         OR t.vendor_state IS DISTINCT FROM EXCLUDED.vendor_state
         OR t.pop_states IS DISTINCT FROM EXCLUDED.pop_states
         OR t.agencies IS DISTINCT FROM EXCLUDED.agencies
         OR t.award_rows IS DISTINCT FROM EXCLUDED.award_rows
         OR t.value IS DISTINCT FROM EXCLUDED.value
         OR t.latest_pop_start IS DISTINCT FROM EXCLUDED.latest_pop_start
         OR t.subcontract_plan_type IS DISTINCT FROM EXCLUDED.subcontract_plan_type
         OR t.fy IS DISTINCT FROM EXCLUDED.fy
         OR t.source_url IS DISTINCT FROM EXCLUDED.source_url
      RETURNING (xmax = 0) AS inserted
    )
    SELECT
      (SELECT count(*)::int FROM written WHERE inserted) AS inserted,
      (SELECT count(*)::int FROM written WHERE NOT inserted) AS updated
  `) as { inserted: number; updated: number }[];
  const row = result[0];
  return { inserted: Number(row?.inserted ?? 0), updated: Number(row?.updated ?? 0) };
}

/** The seeded plan-type split, read back from the table (never from the mapper's own count). */
export async function storedPrimePlanTypes(sourceId: string): Promise<Record<string, number>> {
  const db = sql();
  const rows = (await db`
    SELECT COALESCE(subcontract_plan_type, '(none)') AS plan, count(*)::int AS count
    FROM subcontract_primes
    WHERE source_id = ${sourceId}::uuid
    GROUP BY 1
    ORDER BY 2 DESC, 1
  `) as { plan: string; count: number }[];
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.plan] = Number(row.count);
  return counts;
}

/** Runs the FY24 prime-directory seed. Always returns the honest numbers it wrote. */
export async function seedSubcontractPrimes(options: PrimeSeedOptions = {}): Promise<PrimeSeedResult> {
  const startedMs = Date.now();
  const dryRun = options.dryRun === true;
  const bytes = options.bytes ?? (options.file ? readPrimeDirectoryWorkbook(options.file) : null);
  if (bytes === null) {
    throw new PrimeSeedError(
      `no workbook given: pass --file <path> (the saved evidence file is shared/subcontracting-preview-2026-09-25/evidence/fy24.xlsx, the canonical page ${PRIME_DIRECTORY_SOURCE.officialUrl}) — refusing to import an empty prime directory`,
    );
  }
  const sheet = readXlsxSheet(bytes);
  const { rows: awards, accounting: rowAccounting } = primeAwardRows(sheet);
  const { primes, accounting: aggregation } = aggregatePrimes(awards);
  if (primes.length === 0) {
    throw new PrimeSeedError(
      `the workbook mapped to 0 companies (${rowAccounting.rowsRead} data rows read, ${rowAccounting.rowsWithoutUei} without a UEI) — refusing to write an empty prime directory`,
    );
  }
  const base: PrimeSeedResult = {
    file: options.file ?? null,
    sourceKey: PRIME_DIRECTORY_SOURCE.sourceKey,
    sourceId: null,
    fy: primes[0]!.fy,
    companies: primes.length,
    awards: awards.length,
    rowAccounting,
    aggregation,
    inserted: 0,
    updated: 0,
    touched: 0,
    storedPlanTypes: null,
    dryRun,
    durationMs: 0,
  };
  if (dryRun) return { ...base, durationMs: Date.now() - startedMs };

  const sourceId = await ensureSubcontractSource(PRIME_DIRECTORY_SOURCE);
  const fetchedAt = (options.now ?? new Date()).toISOString();
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < primes.length; i += PRIME_SEED_BATCH_SIZE) {
    const batch = primes.slice(i, i + PRIME_SEED_BATCH_SIZE);
    const written = await upsertPrimeBatch(sourceId, batch, fetchedAt);
    inserted += written.inserted;
    updated += written.updated;
  }
  return {
    ...base,
    sourceId,
    inserted,
    updated,
    touched: inserted + updated,
    storedPlanTypes: await storedPrimePlanTypes(sourceId),
    durationMs: Date.now() - startedMs,
  };
}
