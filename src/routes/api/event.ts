import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";

/**
 * POST /api/event
 *
 * Self-hosted funnel event tracking. Records one row per custom conversion
 * event (hero CTA clicks, score submissions, signup attempts/successes) so the
 * admin dashboard can show where the funnel drops off. Anonymous and
 * authenticated alike — deliberately no auth, so the whole funnel is visible.
 * Called fire-and-forget from the client `trackEvent()` helper
 * (src/lib/track.ts); the endpoint must NEVER crash a request or block
 * rendering — the client ignores the response either way.
 *
 * Body:  { event: string, label?: string, path?: string }
 * Headers used: user-agent, x-forwarded-for / cf-connecting-ip / x-real-ip
 *
 * Success: 200 `{ ok: true }` (bots: `{ ok: true, bot: true }`, no usable
 * event name: `{ ok: true, skipped: true }`). DB write failure after the
 * DDL-guard retry: 500 `{ ok: false }` — the client's fire-and-forget
 * trackEvent() ignores it, but a QA script or curl can now SEE the failure
 * (2026-08-13 incident: the table was missing in production and every event
 * returned a silent 200 while zero rows were written).
 *
 * The table is created lazily with an idempotent DDL guard (same pattern as
 * page-view.ts and the dashboard's ALTER TABLE guards) — no migration step
 * required. Indexes are created with IF NOT EXISTS so re-runs are no-ops.
 *
 * NOTE: like page-view.ts / sync-bids.ts, keep this module free of node
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

/** Idempotent DDL guard — creates the table + indexes on first use. */
async function ensureFunnelEventsTable(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS funnel_events (
    id SERIAL PRIMARY KEY,
    event_name TEXT NOT NULL,
    label TEXT,
    path TEXT,
    user_agent TEXT,
    ip TEXT,
    referrer TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_funnel_events_created_at ON funnel_events (created_at)`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_funnel_events_event_name ON funnel_events (event_name)`;
}

/**
 * Returns true when the user-agent looks like a bot/crawler/spider/scraper.
 * Case-insensitive substring match against a curated denylist — intentionally
 * conservative (false negatives cost a row; false positives cost a real event).
 * Deliberately copied from page-view.ts (not imported) to keep route files
 * self-contained and avoid cross-route coupling.
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
  // Tracked event metadata — declared outside the try so the failure logs
  // below can include the event name/label even when parsing or the DB write
  // itself throws.
  let event = "";
  let label: string | null = null;
  let path: string | null = null;
  try {
    // Skip known bots/crawlers — don't pollute funnel event counts.
    const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 512) || null;
    if (isBot(userAgent)) {
      return Response.json({ ok: true, bot: true });
    }

    // Parse the body defensively — a malformed payload must not 500.
    try {
      const body = (await request.json()) as {
        event?: unknown;
        label?: unknown;
        path?: unknown;
      };
      if (typeof body.event === "string" && body.event.trim().length > 0) {
        event = body.event.trim().slice(0, 64);
      }
      if (typeof body.label === "string" && body.label.length > 0) {
        label = body.label.slice(0, 128);
      }
      if (typeof body.path === "string" && body.path.length > 0) {
        path = body.path.slice(0, 256);
      }
    } catch {
      // No/invalid JSON — nothing to record.
    }

    // `event` is required; drop rows with no usable event name.
    if (!event) {
      return Response.json({ ok: true, skipped: true });
    }

    const referrer = (request.headers.get("referer") ?? "").slice(0, 2048) || null;
    const ip = getClientIp(request);

    const insert = () =>
      sql()`INSERT INTO funnel_events (event_name, label, path, user_agent, ip, referrer)
        VALUES (${event}, ${label}, ${path}, ${userAgent}, ${ip}, ${referrer})`;

    try {
      await ensureFunnelEventsTable();
      await insert();
    } catch {
      // First-ever creation can race with a concurrent request; recreate and
      // retry once before giving up.
      try {
        await ensureFunnelEventsTable();
        await insert();
      } catch (dbErr) {
        // DDL guard + INSERT failed after the retry — this row was NOT
        // recorded. Surface a 500 so the loss is detectable (curl / QA /
        // admin log), instead of the silent 200 that hid the 2026-08-13
        // missing-table incident. The client's fire-and-forget trackEvent()
        // ignores the response, so this can't break tracking.
        console.error("[event] DB write failed after retry:", dbErr, { event, label });
        return Response.json({ ok: false }, { status: 500 });
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    // Unexpected failure — must never crash the request, but must be visible.
    console.error("[event] tracking failed:", err, { event, label });
    return Response.json({ ok: false }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/event")({
  server: { handlers: { POST: handler } },
});
