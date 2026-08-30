import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { resolveAttribution, type Attribution } from "~/lib/attribution";
import { parseClientContext } from "~/lib/client-context";

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
 * Body:  { event: string, label?: string, path?: string, visitor_id?: string, visit_id?: string }
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
    source TEXT,
    medium TEXT,
    campaign TEXT,
    click_id TEXT,
    visitor_id TEXT,
    visit_id TEXT,
    user_id TEXT,
    user_email TEXT,
    city TEXT,
    region TEXT,
    device_type TEXT,
    browser_label TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  // Lazy ALTER guards (idempotent) so pre-existing production tables gain the
  // attribution columns on first hit after deploy — no migration step required.
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS source TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS medium TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS campaign TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS click_id TEXT`;
  // Persistent per-visitor / per-session ids (PR: visit_id tracking). Lazy so
  // pre-existing tables gain them on first hit after deploy — no migration step.
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS visitor_id TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS visit_id TEXT`;
  // Per-user identity (lazy, additive) — ties the post-login lifecycle (and the
  // backfilled anonymous journey) of a funnel to a real account. Optional +
  // nullable so inserts never fail without them.
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS user_id TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS user_email TEXT`;
  // Geo + device context (lazy, additive) — nullable so pre-existing rows and
  // header-less requests remain valid. Never a raw IP or full UA.
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS city TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS region TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS device_type TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS browser_label TEXT`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_funnel_events_created_at ON funnel_events (created_at)`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_funnel_events_event_name ON funnel_events (event_name)`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_funnel_events_source ON funnel_events (source)`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_funnel_events_visitor_id ON funnel_events (visitor_id)`;
  // Identity backfill depends on fast visitor_id lookups (UPDATE ... WHERE
  // visitor_id = $n) at 50k+ rows — keep this index in the lazy migration.
  await sql()`CREATE INDEX IF NOT EXISTS idx_funnel_events_vid ON funnel_events (visitor_id)`;
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
  let visitorId: string | null = null;
  let visitId: string | null = null;
  let userId: string | null = null;
  let userEmail: string | null = null;
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
        visitor_id?: unknown;
        visit_id?: unknown;
        user_id?: unknown;
        user_email?: unknown;
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
      // Persistent visitor + session ids are OPTIONAL: a missing/malformed
      // value must never fail the insert. Sanitize to 64 chars.
      if (typeof body.visitor_id === "string" && body.visitor_id.trim().length > 0) {
        visitorId = body.visitor_id.trim().slice(0, 64);
      }
      if (typeof body.visit_id === "string" && body.visit_id.trim().length > 0) {
        visitId = body.visit_id.trim().slice(0, 64);
      }
      // Logged-in identity is OPTIONAL: anonymous visitors send nothing, and a
      // missing/malformed value must never fail the insert. Sanitize id to 64
      // chars and email to 254 chars.
      if (typeof body.user_id === "string" && body.user_id.trim().length > 0) {
        userId = body.user_id.trim().slice(0, 64);
      }
      if (typeof body.user_email === "string" && body.user_email.trim().length > 0) {
        userEmail = body.user_email.trim().slice(0, 254);
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

    // Geo + device context on the beacon (city/region/device/browser only — never
    // a raw IP or full UA). Fail-open: absent/invalid headers → null fields.
    const ctx = parseClientContext(request);

    // First-touch acquisition attribution, resolved in precedence order:
    // cookie (contrax_attr) → request query params → referer. The client's
    // AttributionCookie (src/routes/__root.tsx) sets contrax_attr before funnel
    // events fire, so the cookie is the canonical carrier here; query params and
    // the referer header cover the cookie-blocker fallback.
    const attr: Attribution = resolveAttribution({
      cookie: request.headers.get("cookie"),
      search: new URL(request.url).search,
      referer: request.headers.get("referer"),
    });

    const insert = () =>
      sql()`INSERT INTO funnel_events (event_name, label, path, user_agent, ip, referrer, source, medium, campaign, click_id, visitor_id, visit_id, user_id, user_email, city, region, device_type, browser_label)
        VALUES (${event}, ${label}, ${path}, ${userAgent}, ${ip}, ${referrer}, ${attr.source}, ${attr.medium}, ${attr.campaign}, ${attr.click_id}, ${visitorId}, ${visitId}, ${userId}, ${userEmail}, ${ctx.city}, ${ctx.region}, ${ctx.device_type}, ${ctx.browser_label})`;

    try {
      await ensureFunnelEventsTable();
      // Dedupe identical events within ~1s (same event + visitor + path) at
      // write time so the Visitor Journeys timeline isn't noisy with e.g.
      // double-firing beacons. Only dedupes when a persistent visitor_id is
      // present (anonymous without an id can't be grouped meaningfully). This
      // is a time-windowed collapse, NOT a permanent unique constraint, so a
      // legitimate repeat action hours later still records.
      if (visitorId) {
        const dup = await sql()`
          SELECT 1 FROM funnel_events
          WHERE event_name = ${event}
            AND visitor_id = ${visitorId}
            AND COALESCE(path, '') = ${path ?? ""}
            AND created_at >= NOW() - INTERVAL '1 second'
          LIMIT 1`;
        if (dup.length > 0) {
          return Response.json({ ok: true, deduped: true });
        }
      }
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
