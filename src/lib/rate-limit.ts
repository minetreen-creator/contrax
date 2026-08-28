/**
 * Minimal DB-backed rate limiter for public POST endpoints — guards against
 * credential stuffing, account-creation floods, password-reset spam, and bot
 * POSTing without adding infrastructure or breaking legitimate flows.
 *
 * WHY DB-BACKED instead of in-memory:
 *  - This app runs on Vercel serverless, which can scale to many concurrent
 *    instances and cold-starts arbitrarily. A per-instance in-memory Map would
 *    be a fragmented enforcement point, reset on every cold start, and trivially
 *    bypassed by spreading attempts across instances. That is exactly the
 *    credential-stuffing surface we must protect, so an in-memory-only limiter
 *    is NOT an acceptable single enforcement point here.
 *  - A single atomic UPSERT in Neon (the app's existing Postgres) is
 *    deterministic, restart-safe, and correct across ALL instances. At this
 *    app's traffic level (a few visitors/day; auth attempts far lower) the one
 *    extra indexed upsert per guarded attempt is negligible.
 *
 * FAIL-OPEN guarantee: every DB error is swallowed and the request is allowed,
 * so a Neon blip or missing table can NEVER lock a real user out.
 */
import { sql } from "~/db";
import { getClientIp } from "~/lib/request-ip";

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS rate_limits (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    window_start BIGINT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (scope, key, window_start)
  )
`;

let initialized = false;

async function ensureTable(): Promise<boolean> {
  if (initialized) return true;
  try {
    const db = sql();
    await db`${db.unsafe(CREATE_TABLE)}`;
    initialized = true;
    return true;
  } catch (e) {
    console.error("[rate-limit] ensureTable failed (fail-open):", e);
    return false;
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number | null;
}

const ALLOWED: RateLimitResult = { allowed: true, retryAfterSec: null };

/**
 * Fixed-window counter backed by Neon. Returns allowed=false (and a
 * retry-after) once `count` exceeds `limit` within the current `windowSec`
 * bucket. The increment happens BEFORE the check, so a failed-login scanner
 * burns its quota immediately on the very attempt that would breach it.
 */
export async function checkRateLimit(opts: {
  scope: string;
  key: string;
  limit: number;
  windowSec: number;
}): Promise<RateLimitResult> {
  const { scope, key, limit, windowSec } = opts;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSec) * windowSec;
  try {
    if (!(await ensureTable())) return ALLOWED; // fail-open
    const rows = (await sql()`
      INSERT INTO rate_limits (scope, key, window_start, count)
      VALUES (${scope}, ${key.slice(0, 256)}, ${windowStart}, 1)
      ON CONFLICT (scope, key, window_start)
      DO UPDATE SET count = rate_limits.count + 1, updated_at = NOW()
      RETURNING count
    `) as Array<{ count: number }>;
    const count = Number(rows?.[0]?.count ?? 0);
    if (count > limit) {
      return { allowed: false, retryAfterSec: Math.max(1, windowStart + windowSec - now) };
    }
    // Opportunistic prune of stale windows keeps the table bounded (~1/64
    // of requests). Never fatal.
    if ((count & 0x3f) === 0) {
      try {
        await sql()`DELETE FROM rate_limits WHERE window_start < ${now - 3 * 86400}`;
      } catch {
        /* non-fatal */
      }
    }
    return ALLOWED;
  } catch (e) {
    console.error("[rate-limit] check failed (fail-open):", e);
    return ALLOWED;
  }
}

/** IP-based check. Missing/unresolvable IP → allowed (fail-open, mirrors isBlockedIp). */
export async function checkIpLimit(
  request: Request,
  scope: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const ip = getClientIp(request);
  if (!ip) return ALLOWED;
  return checkRateLimit({ scope, key: `ip:${ip}`, limit, windowSec });
}

/** Email/account-based check (lower/additional cap on top of the IP cap). */
export async function checkEmailLimit(
  email: string,
  scope: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  if (!email) return ALLOWED;
  return checkRateLimit({ scope, key: `acct:${email.toLowerCase().trim()}`, limit, windowSec });
}

/**
 * Builds the uniform 429 response for the protected endpoints. The message is
 * deliberately generic and IDENTICAL across all cases (IP vs account, existing
 * vs non-existent email) so an attacker cannot tell whether an account exists.
 */
export function rateLimitedResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({ error: "Too many attempts. Please try again later." }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(result.retryAfterSec ?? 60),
      },
    },
  );
}
