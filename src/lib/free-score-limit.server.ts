/**
 * ANONYMOUS FREE-SCORE LIMIT — DUAL DIMENSION (owner directive 2026-10-06).
 *
 * Owner wording: "Count free scans by network address and browser ID, and block
 * when either one runs out. Switching VPN servers would no longer reset the
 * count, and nothing changes for normal visitors."
 *
 * BEFORE (this file's reason for existing): the anonymous allowance on /score
 * (3 free AI win-probability analyses — FREE_SCORE_LIMIT) was counted under a
 * SINGLE dimension, the request's client IP (`score_credits.ip`). A visitor who
 * switched VPN servers / IPs got a brand-new free allowance.
 *
 * NOW: every anonymous analysis is counted under TWO independent keys, in the
 * same `score_credits` table:
 *
 *   - `ip:<client ip>`        — the network address (same derivation as
 *                               /api/event: x-forwarded-for[0] /
 *                               cf-connecting-ip / x-real-ip).
 *   - `visitor:<contrax_vid>` — the SAME long-lived first-party browser id the
 *                               funnel/tracking code already uses
 *                               (src/lib/visitor.ts). No new fingerprint, no
 *                               new id, no new cookie, no new secret.
 *
 * An anonymous analysis is allowed only while BOTH counters are below the
 * limit. The first dimension to run out blocks, and it blocks EXACTLY the way
 * the feature blocked before: the caller throws the unchanged
 * `FREE_LIMIT_REACHED` sentinel, so the client renders its existing
 * "create an account to keep scoring" panel — no new response/status shape.
 *
 * GUARANTEES PRESERVED (owner constraints):
 *   - FAIL-OPEN. A missing/unresolvable IP or a missing/invalid visitor id
 *     simply drops that one dimension (the other still counts); no usable key
 *     at all → allowed; ANY store failure (DB down, DATABASE_URL unset, a
 *     timeout) → allowed. Inability to count must never deny a visitor.
 *   - SAME ALLOWANCE. FREE_SCORE_LIMIT stays 3.
 *   - A NORMAL VISITOR IS UNAFFECTED. One browser behind one address burns the
 *     two counters in lock-step, so the counter, the "X of 3" copy and the
 *     block point are unchanged.
 *   - ONLY A SUCCESSFUL ANALYSIS CONSUMES A CREDIT (unchanged). Failed OpenAI
 *     calls must not eat an allowance, so consumption still happens on the
 *     SUCCESS path in score.tsx — never at the pre-check.
 *   - SIGNED-IN CALLERS ARE NEVER GATED (the account is the unlock).
 *
 * SCHEMA: no migration and no new table. `score_credits` is created lazily
 * (CREATE TABLE IF NOT EXISTS, the same pattern as /api/event, page-view and
 * /api/radar/profile) and its TEXT primary key holds both prefixed keys.
 * NOTE: rows written before this change hold a BARE ip (no prefix). They are
 * left untouched and simply stop matching, so an anonymous visitor's counter
 * restarts at most once — strictly more generous, never a new block.
 */
import { sql } from "~/db";
import { VISITOR_COOKIE_NAME } from "~/lib/visitor";

/** Free anonymous analyses. Unchanged (owner: same allowance as today). */
export const FREE_SCORE_LIMIT = 3;

/** Dimension prefixes written into the shared TEXT key column. */
export const FREE_SCORE_IP_PREFIX = "ip:";
export const FREE_SCORE_VISITOR_PREFIX = "visitor:";

/** Defensive bound on a stored key (the column is TEXT; keys are short). */
const KEY_MAX = 256;

/** Same shape rule the grants anonymous credit uses for the visitor cookie. */
const VISITOR_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Extract the visitor id (`contrax_vid`) from a raw Cookie header. PURE.
 * An absent, empty or malformed value returns "" — which simply drops the
 * browser dimension (fail-open), never denies.
 */
export function visitorIdFromCookieHeader(
  cookieHeader: string | null | undefined,
  cookieName: string = VISITOR_COOKIE_NAME,
): string {
  if (!cookieHeader) return "";
  try {
    for (const part of cookieHeader.split(";")) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      if (part.slice(0, idx).trim() !== cookieName) continue;
      const raw = part.slice(idx + 1).trim();
      if (!raw) return "";
      let value = raw;
      try {
        value = decodeURIComponent(raw);
      } catch {
        /* keep the raw value — a bad encoding must not deny anyone */
      }
      value = value.trim().slice(0, 64);
      return VISITOR_ID_RE.test(value) ? value : "";
    }
  } catch {
    /* never throw on a hostile cookie header */
  }
  return "";
}

/**
 * The credit keys an anonymous analysis is counted under. PURE.
 * Only dimensions that exist are returned (missing IP / missing visitor id →
 * that dimension is skipped), and the result is deduped.
 */
export function freeScoreKeys(
  ip: string | null | undefined,
  visitorId: string | null | undefined,
): string[] {
  const keys: string[] = [];
  const cleanIp = typeof ip === "string" ? ip.trim() : "";
  if (cleanIp) keys.push(`${FREE_SCORE_IP_PREFIX}${cleanIp}`.slice(0, KEY_MAX));
  const cleanVisitor = typeof visitorId === "string" ? visitorId.trim() : "";
  if (cleanVisitor) {
    keys.push(`${FREE_SCORE_VISITOR_PREFIX}${cleanVisitor}`.slice(0, KEY_MAX));
  }
  return [...new Set(keys)];
}

/** Injectable counter backend — the real one is Neon, tests pass a fake. */
export interface FreeScoreCreditStore {
  /** Used credits for a key. MUST resolve (never reject) — 0 when unknown. */
  getUsed(key: string): Promise<number>;
  /** Add one credit to a key. MUST be a no-op on failure. */
  increment(key: string): Promise<void>;
}

export interface FreeScoreGate {
  allowed: boolean;
  /** Highest count across the dimensions in play (the one that blocks first). */
  used: number;
  limit: number;
}

/**
 * Decide whether an anonymous analysis may run. Counts EVERY dimension and
 * blocks when the most-advanced one is exhausted. Fail-open: no keys → allowed;
 * a store that throws or returns junk for a key → that key reads as 0.
 */
export async function evaluateFreeScoreGate(
  keys: readonly string[],
  store: FreeScoreCreditStore,
  limit: number = FREE_SCORE_LIMIT,
): Promise<FreeScoreGate> {
  if (!keys.length) return { allowed: true, used: 0, limit };
  let used = 0;
  for (const key of keys) {
    let count = 0;
    try {
      count = await store.getUsed(key);
    } catch (err) {
      // Never deny on an unreadable counter.
      console.error("[free-score-limit] credit read failed (fail-open):", err);
      count = 0;
    }
    if (!Number.isFinite(count) || count < 0) count = 0;
    if (count > used) used = count;
  }
  return { allowed: used < limit, used, limit };
}

/**
 * Spend one credit in EVERY dimension (called only after a SUCCESSFUL
 * analysis). Each key is independent: one failing write never skips the other,
 * and no failure is ever surfaced to the caller.
 */
export async function consumeFreeScoreCredits(
  keys: readonly string[],
  store: FreeScoreCreditStore,
): Promise<void> {
  for (const key of keys) {
    try {
      await store.increment(key);
    } catch (err) {
      console.error("[free-score-limit] credit increment failed (non-fatal):", err);
    }
  }
}

// ── Neon-backed store ────────────────────────────────────────────────────────
/** Idempotent DDL guard — memoized like src/lib/rate-limit.ts. */
let tableReady = false;
async function ensureScoreCreditsTable(): Promise<boolean> {
  if (tableReady) return true;
  try {
    await sql()`CREATE TABLE IF NOT EXISTS score_credits (
      ip TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
    tableReady = true;
    return true;
  } catch (err) {
    // Fail-open: an unreadable/unwritable counter must never deny anyone.
    console.error("[free-score-limit] score_credits ensure failed (fail-open):", err);
    return false;
  }
}

/**
 * The production store. The column is still NAMED `ip` (pre-existing DDL, kept
 * verbatim so prod needs no migration) but it holds a DIMENSION-PREFIXED key:
 * `ip:<address>` or `visitor:<contrax_vid>`.
 */
export const neonFreeScoreStore: FreeScoreCreditStore = {
  async getUsed(key: string): Promise<number> {
    try {
      if (!(await ensureScoreCreditsTable())) return 0;
      const rows = await sql()`SELECT count FROM score_credits WHERE ip = ${key}`;
      return rows.length > 0 ? Number(rows[0].count) || 0 : 0;
    } catch (err) {
      // DB failure must never block scoring — fail open (treat as 0 used).
      console.error("[free-score-limit] credits lookup failed (fail-open):", err);
      return 0;
    }
  },
  async increment(key: string): Promise<void> {
    try {
      if (!(await ensureScoreCreditsTable())) return;
      await sql()`INSERT INTO score_credits (ip, count) VALUES (${key}, 1)
        ON CONFLICT (ip) DO UPDATE SET count = score_credits.count + 1, updated_at = NOW()`;
    } catch (err) {
      // A failed credit write must never fail a successful score.
      console.error("[free-score-limit] credit increment failed (non-fatal):", err);
    }
  },
};

/**
 * The whole pre-check for one anonymous request, wrapped so that a surprise
 * (a broken store, a malformed key) still resolves to ALLOWED. This is the only
 * entry point score.tsx calls on the attempt path.
 */
export async function checkAnonymousFreeScore(
  ip: string | null | undefined,
  visitorId: string | null | undefined,
  store: FreeScoreCreditStore = neonFreeScoreStore,
): Promise<FreeScoreGate> {
  try {
    const keys = freeScoreKeys(ip, visitorId);
    return await evaluateFreeScoreGate(keys, store);
  } catch (err) {
    console.error("[free-score-limit] gate failed (fail-open):", err);
    return { allowed: true, used: 0, limit: FREE_SCORE_LIMIT };
  }
}

/**
 * Spend one credit in both dimensions after a successful anonymous analysis.
 * Never throws.
 */
export async function consumeAnonymousFreeScore(
  ip: string | null | undefined,
  visitorId: string | null | undefined,
  store: FreeScoreCreditStore = neonFreeScoreStore,
): Promise<void> {
  try {
    await consumeFreeScoreCredits(freeScoreKeys(ip, visitorId), store);
  } catch (err) {
    console.error("[free-score-limit] consume failed (non-fatal):", err);
  }
}
