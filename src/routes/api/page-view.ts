import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";

/**
 * POST /api/page-view
 *
 * Self-hosted, lightweight page-view analytics. Records one row per page load
 * (anonymous and authenticated alike — deliberately no auth, so the whole
 * funnel is visible). Called fire-and-forget from the root layout on every
 * route change; the client dedupes same-path hits to once per 5 minutes.
 *
 * Body:  { path: string, referrer?: string }
 * Headers used: user-agent, x-forwarded-for / cf-connecting-ip / x-real-ip
 *
 * This endpoint must NEVER throw a 5xx or block rendering. Every failure is
 * swallowed and reported as `{ ok: true }` so tracking can never break a page.
 *
 * The table is created lazily with an idempotent DDL guard (same pattern as
 * the dashboard's ALTER TABLE guards) — no migration step required. Indexes
 * are created with IF NOT EXISTS so re-runs are no-ops.
 *
 * NOTE: like sync-bids.ts / sync-far.ts, keep this module free of node
 * builtins — it only uses global fetch + neon, so it stays compatible with
 * the client-bundle protection.
 */

function getClientIp(request: Request): string | null {
  // Vercel/proxy deployments put the real client IP in x-forwarded-for;
  // cf-connecting-ip / x-real-ip cover Cloudflare and nginx proxies.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const ip =
    request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip");
  return ip ? ip.slice(0, 64) : null;
}

/** Idempotent DDL guard — creates the table + index on first use. */
async function ensurePageViewsTable(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS page_views (
    id SERIAL PRIMARY KEY,
    path TEXT NOT NULL,
    user_agent TEXT,
    ip TEXT,
    referrer TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views (created_at)`;
}

/**
 * Returns true when the user-agent looks like a bot/crawler/spider/scraper.
 * Case-insensitive substring match against a curated denylist — intentionally
 * conservative (false negatives cost a row; false positives cost a real view).
 */
function isBot(userAgent: string | null): boolean {
  if (!userAgent) return false; // empty UA could be curl/wget — still signal, so keep
  const ua = userAgent.toLowerCase();
  const botPatterns = [
    "bot", "crawler", "spider", "scraper", "headless",
    "chrome-lighthouse", "lighthouse",
    "ahrefs", "semrush", "mozdot", "rogerbot", "mj12bot", "dotbot",
    "baiduspider", "yandex", "sogou", "exabot", "facebot",
    "python-requests", "python-urllib", "go-http-client", "node-fetch",
    "axios", "okhttp", "wget", "curl",
    "petalbot", "barkrowler", "blexbot", "grapeshot",
    "twitterbot", "slack", "discord", "whatsapp",
    "ia_archiver", "checks.panopta", "uptime",
    "google-ping", "google-read-aloud",
  ];
  return botPatterns.some((pattern) => ua.includes(pattern));
}

async function handler({ request }: { request: Request }) {
  try {
    // Skip known bots/crawlers — don't pollute page view counts
    const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 512) || null;
    if (isBot(userAgent)) {
      return Response.json({ ok: true, bot: true });
    }

    // Parse the body defensively — a malformed payload must not 500.
    let path = "/";
    let referrer: string | null = null;
    try {
      const body = (await request.json()) as { path?: unknown; referrer?: unknown };
      if (typeof body.path === "string" && body.path.length > 0) {
        path = body.path.slice(0, 2048);
      }
      if (typeof body.referrer === "string" && body.referrer.length > 0) {
        referrer = body.referrer.slice(0, 2048);
      }
    } catch {
      // No/invalid JSON — record the hit with the default path.
    }

    const ip = getClientIp(request);

    const insert = () =>
      sql()`INSERT INTO page_views (path, user_agent, ip, referrer)
        VALUES (${path}, ${userAgent}, ${ip}, ${referrer})`;

    try {
      await ensurePageViewsTable();
      await insert();
    } catch {
      // First-ever creation can race with a concurrent request; recreate and
      // retry once before giving up.
      await ensurePageViewsTable();
      await insert();
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[page-view] tracking failed:", err);
    // Swallow everything — analytics must never break the user experience.
    return Response.json({ ok: true, skipped: true });
  }
}

export const Route = createFileRoute("/api/page-view")({
  server: { handlers: { POST: handler } },
});
