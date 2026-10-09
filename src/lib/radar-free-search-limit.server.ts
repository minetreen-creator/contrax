/** Radar preview counters. Anonymous: one search across IP/browser dimensions.
 * Basic: two searches per authenticated account, independent of IP/browser.
 * Paid entitlement bypasses this gate. Legacy anonymous hashes retain usage.
 * Store outages retain the existing fail-open policy. */
import { createHash } from "node:crypto";
import { FREE_RADAR_PREVIEW_SCANS, FREE_ACCOUNT_RADAR_SCANS } from "~/lib/radar-config";
import { sql } from "~/db";

/** Free anonymous Radar searches. Owner-set anonymous cap (1). */
export const FREE_RADAR_SEARCH_LIMIT = FREE_RADAR_PREVIEW_SCANS;

/** Dimension prefixes (the same style as ~/lib/free-score-limit.server). */
export const RADAR_SEARCH_IP_PREFIX = "ip:";
export const RADAR_SEARCH_VISITOR_PREFIX = "visitor:";

/** Same shape rule the visitor cookie is validated with elsewhere. */
const VISITOR_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * The stored-key namespace. Unchanged from the IP-only era so the rows already
 * in `radar_preview_usage` keep counting for the address dimension.
 */
export const RADAR_SEARCH_HASH_PREFIX = "radar-preview-v1:";

/**
 * Storage key for one dimension: sha256 of the prefixed identity. PURE.
 * (`ip:<ip>` hashed here is byte-identical to what the pre-2026-10-08 code
 * wrote for the same address — that is the no-reset property above.)
 */
export function radarSearchKeyHash(key: string): string {
  return createHash("sha256").update(RADAR_SEARCH_HASH_PREFIX + key).digest("hex");
}

/**
 * The counter keys one anonymous scan is counted under. PURE.
 * Only dimensions that exist are returned (missing IP / missing visitor id →
 * that dimension is skipped), and the result is deduped.
 */
export function radarSearchKeys(
  ip: string | null | undefined,
  visitorId: string | null | undefined,
): string[] {
  const keys: string[] = [];
  const cleanIp = typeof ip === "string" ? ip.trim() : "";
  if (cleanIp) keys.push(`${RADAR_SEARCH_IP_PREFIX}${cleanIp}`);
  const cleanVisitor = typeof visitorId === "string" ? visitorId.trim() : "";
  if (cleanVisitor && VISITOR_ID_RE.test(cleanVisitor)) {
    keys.push(`${RADAR_SEARCH_VISITOR_PREFIX}${cleanVisitor}`);
  }
  return [...new Set(keys)];
}

/** Injectable counter backend — the real one is Neon, tests pass a fake. */
export interface RadarSearchStore {
  /** Used searches for a key. MUST resolve (never reject) — 0 when unknown. */
  getUsed(key: string): Promise<number>;
  /** Add one search to a key. MUST be a no-op on failure. */
  increment(key: string): Promise<void>;
}

export interface RadarSearchGate {
  allowed: boolean;
  /** Highest count across the dimensions in play (the one that blocks first). */
  used: number;
  limit: number;
}

/**
 * Decide whether an anonymous scan may run. Counts EVERY dimension and blocks
 * when the most-advanced one is exhausted. Fail-open: no keys → allowed; a
 * store that throws or returns junk for a key → that key reads as 0.
 */
export async function evaluateRadarSearchGate(
  keys: readonly string[],
  store: RadarSearchStore,
  limit: number = FREE_RADAR_SEARCH_LIMIT,
): Promise<RadarSearchGate> {
  if (!keys.length) return { allowed: true, used: 0, limit };
  let used = 0;
  for (const key of keys) {
    let count = 0;
    try {
      count = await store.getUsed(key);
    } catch (err) {
      // Never deny on an unreadable counter.
      console.error("[radar-free-search] search read failed (fail-open):", err);
      count = 0;
    }
    if (!Number.isFinite(count) || count < 0) count = 0;
    if (count > used) used = count;
  }
  return { allowed: used < limit, used, limit };
}

/**
 * Spend one search in EVERY dimension (called only after a SUCCESSFUL scan).
 * Each key is independent: one failing write never skips the other, and no
 * failure is ever surfaced to the caller.
 */
export async function consumeRadarSearchCredits(
  keys: readonly string[],
  store: RadarSearchStore,
): Promise<void> {
  for (const key of keys) {
    try {
      await store.increment(key);
    } catch (err) {
      console.error("[radar-free-search] search increment failed (non-fatal):", err);
    }
  }
}

// ── Neon-backed store ────────────────────────────────────────────────────────
/** Idempotent DDL guard — memoized like src/lib/free-score-limit.server. */
let tableReady = false;
async function ensureRadarPreviewUsageTable(): Promise<boolean> {
  if (tableReady) return true;
  try {
    await sql()`CREATE TABLE IF NOT EXISTS radar_preview_usage (
      identity_hash TEXT PRIMARY KEY,
      used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    // Column added by the 2026-10-07 rollout; kept verbatim (additive,
    // idempotent) so a fresh table works on the first scan.
    await sql()`ALTER TABLE radar_preview_usage ADD COLUMN IF NOT EXISTS scans INTEGER NOT NULL DEFAULT 1`;
    tableReady = true;
    return true;
  } catch (err) {
    // Fail-open: an unreadable/unwritable counter must never deny anyone.
    console.error("[radar-free-search] radar_preview_usage ensure failed (fail-open):", err);
    return false;
  }
}

/**
 * The production store. Reads/writes ONE row per dimension in the pre-existing
 * `radar_preview_usage` table, keyed by the sha256 of the prefixed identity.
 */
export const neonRadarSearchStore: RadarSearchStore = {
  async getUsed(key: string): Promise<number> {
    try {
      if (!(await ensureRadarPreviewUsageTable())) return 0;
      const hash = radarSearchKeyHash(key);
      const rows = await sql()`SELECT scans FROM radar_preview_usage WHERE identity_hash = ${hash}`;
      return rows.length > 0 ? Number(rows[0].scans) || 0 : 0;
    } catch (err) {
      // DB failure must never block a scan — fail open (treat as 0 used).
      console.error("[radar-free-search] search lookup failed (fail-open):", err);
      return 0;
    }
  },
  async increment(key: string): Promise<void> {
    try {
      if (!(await ensureRadarPreviewUsageTable())) return;
      const hash = radarSearchKeyHash(key);
      await sql()`INSERT INTO radar_preview_usage (identity_hash, scans) VALUES (${hash}, 1)
        ON CONFLICT (identity_hash) DO UPDATE SET scans = radar_preview_usage.scans + 1, used_at = NOW()`;
    } catch (err) {
      // A failed counter write must never fail a successful scan.
      console.error("[radar-free-search] search increment failed (non-fatal):", err);
    }
  },
};

/**
 * The whole pre-check for one anonymous scan, wrapped so that a surprise (a
 * broken store, a malformed key) still resolves to ALLOWED. This is the only
 * entry point runRadarScan calls on the attempt path.
 */
export async function checkAnonymousRadarSearch(
  ip: string | null | undefined,
  visitorId: string | null | undefined,
  store: RadarSearchStore = neonRadarSearchStore,
): Promise<RadarSearchGate> {
  try {
    const keys = radarSearchKeys(ip, visitorId);
    return await evaluateRadarSearchGate(keys, store);
  } catch (err) {
    console.error("[radar-free-search] gate failed (fail-open):", err);
    return { allowed: true, used: 0, limit: FREE_RADAR_SEARCH_LIMIT };
  }
}

/**
 * Spend one free search in both dimensions after a SUCCESSFUL scan that
 * returned real results. Never throws.
 */
export async function consumeAnonymousRadarSearch(
  ip: string | null | undefined,
  visitorId: string | null | undefined,
  store: RadarSearchStore = neonRadarSearchStore,
): Promise<void> {
  try {
    await consumeRadarSearchCredits(radarSearchKeys(ip, visitorId), store);
  } catch (err) {
    console.error("[radar-free-search] consume failed (non-fatal):", err);
  }
}

/** The account ID must come from server authentication, never request input. */
export function radarSearchBudget(ip: string | null, visitorId: string | null, accountId: number | null) {
  return accountId
    ? { keys: [`account:${accountId}`], limit: FREE_ACCOUNT_RADAR_SCANS }
    : { keys: radarSearchKeys(ip, visitorId), limit: FREE_RADAR_SEARCH_LIMIT };
}

/** Conditional upsert prevents parallel successful requests releasing extra
 * previews. A losing multi-dimension request can conservatively consume a
 * remaining dimension, but never grants more matches than its allowance. */
async function claimRadarSearchKey(key: string, limit: number): Promise<boolean> {
  if (!(await ensureRadarPreviewUsageTable())) return true;
  const hash = radarSearchKeyHash(key);
  const rows = await sql()`INSERT INTO radar_preview_usage (identity_hash, scans)
    VALUES (${hash}, 1)
    ON CONFLICT (identity_hash) DO UPDATE
    SET scans = radar_preview_usage.scans + 1, used_at = NOW()
    WHERE radar_preview_usage.scans < ${limit}
    RETURNING scans`;
  return rows.length > 0;
}

export async function claimRadarSearchBudget(
  keys: readonly string[],
  limit: number,
  claim: (key: string, limit: number) => Promise<boolean> = claimRadarSearchKey,
): Promise<boolean> {
  if (!keys.length) return true;
  try {
    let allowed = true;
    for (const key of keys) if (!(await claim(key, limit))) allowed = false;
    return allowed;
  } catch (error) {
    console.error("[radar-free-search] claim failed (fail-open):", error);
    return true;
  }
}
