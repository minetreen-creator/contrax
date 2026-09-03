/**
 * Shared visitor-intake handler (Admin Tracker Enrichment, owner 2026-08-31).
 *
 * ONE canonical ingestion path for every visitor signal — page views, custom
 * funnel events (signup, pricing views, Radar activity, brief views, ...) — so
 * the repo converges on a single beacon target while still writing to the
 * EXISTING `funnel_events` + `page_views` tables (no new timeline/event table).
 *
 * Routes:
 *   - POST /api/track-visitor  → canonical endpoint; `kind` is read from the
 *     body ("event" | "page", or `type` as an alias).
 *   - POST /api/event          → thin forwarder calling handleIntake(req, "event")
 *   - POST /api/page-view      → thin forwarder calling handleIntake(req, "page")
 *
 * The forwarders keep every pre-existing safeguard AND response shape, so legacy
 * embeds/beacons that still POST to /api/event or /api/page-view keep working
 * (both URLs still return 200) and the repo's own client helpers converge on
 * /api/track-visitor.
 *
 * Preserved safety rail (identical to the previous two endpoints):
 *   - bot filter (isBot) — bots never reach a write and get `{ ok:true, bot:true }`
 *   - 1s write-time dedupe (event+visitor+path for events, path+visitor for pages)
 *   - first-touch attribution (contrax_attr cookie → query → referer)
 *   - geo/device via parseClientContext (never a raw IP or full UA)
 *   - idempotent DDL guards for all three tables + retry-once + 500-on-loss for
 *     detail-table writes (the 2026-08-13 missing-table incident is visible again)
 *   - defensive body parsing — only a missing mandatory field may skip/4xx-5xx
 *
 * NEW (this PR): a per-visitor SUMMARY cache row in the `visitors` table is
 * upserted at intake for fast admin display. funnel_events + page_views remain
 * the detailed history. The summary's radar/signup/activated mapping mirrors the
 * /admin/journeys live derivation exactly (same event names, same statuses) so
 * the admin display can't drift. Exclusions apply at write too: bot traffic is
 * filtered above, and @test.contrax / admin-email traffic never gets a
 * `visitors` row (read-time exclusions stay as the backstop).
 *
 * NOTE: keep this module free of node builtins (like page-view.ts / sync-bids.ts)
 * — it only uses global fetch + neon, so it stays compatible with the
 * client-bundle protection.
 */
import { sql } from "~/db";
import { resolveAttribution, type Attribution } from "~/lib/attribution";
import { parseClientContext } from "~/lib/client-context";
import { ADMIN_EMAILS } from "~/lib/admin";

export type IntakeKind = "event" | "page";

/** Activation events — identical list to src/routes/api/admin/journeys.ts. */
export const ACTIVATION_EVENTS: readonly string[] = [
  "rfp_brief_result", // first successful AI Brief
  "save_success", // saved a bid
  "score_result", // match-score result shown
  "score_submit", // match-score submitted
  "alert_created", // bid alert created (recorded server-side at sync)
];

/** Signup-progress events — identical lists to journeys.ts. */
export const SIGNUP_VIEWED_EVENTS: readonly string[] = ["signup_view", "signup_view_with_score"];
export const SIGNUP_STARTED_EVENTS: readonly string[] = ["signup_start", "signup_submit"];

export const RADAR_COMPLETE_EVENT = "radar_scan_complete";

/** Human-readable timeline labels for known funnel events (mirrors journeys.ts). */
export const EVENT_LABELS: Record<string, string> = {
  hero_cta_click: "Trial CTA clicked",
  hero_search: "Hero search submitted",
  radar_scan_start: "Radar scan started",
  radar_scan_complete: "Radar scan completed",
  radar_save: "Saved radar match",
  signup_view: "Signup viewed",
  signup_view_with_score: "Signup viewed (with score)",
  signup_start: "Signup started",
  signup_submit: "Signup submitted",
  signup_success: "Signup completed",
  signup_error: "Signup error",
  signup_cta_click: "Signup CTA clicked",
  save_success: "Bid saved",
  save_click: "Save clicked",
  save_limit_wall: "Save limit reached",
  save_signup_wall: "Save signup wall shown",
  score_cta_click: "Match-score CTA clicked",
  score_submit: "Match-score submitted",
  score_result: "Match-score result shown",
  rfp_brief_result: "AI Brief generated",
  rfp_brief_locked: "AI Brief locked (limit)",
  alert_created: "Bid alert created",
  fb_funnel_signup_cta: "FB funnel signup CTA",
  fb_funnel_email_submitted: "FB funnel email captured",
  fb_funnel_cert_selected: "FB funnel cert selected",
  fb_funnel_bid_clicked: "FB funnel bid clicked",
  fb_funnel_reveal_clicked: "FB funnel reveal clicked",
  incumbent_first_free_view: "Incumbent (free) viewed",
  incumbent_gate_view: "Incumbent gate shown",
  radar_login_notify_shown: "Saved-matches banner shown",
  radar_login_notify_save: "Saved-match saved to pipeline",
  pending_draft_created: "Draft created",
  pending_draft_fulfilled: "Draft fulfilled",
  onboarding_match_count: "Onboarding matches shown",
};

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

/**
 * Returns true when the user-agent looks like a bot/crawler/spider/scraper.
 * Case-insensitive substring match against a curated denylist — intentionally
 * conservative (false negatives cost a row; false positives cost a real event).
 * Shared by both intake kinds (previously copied in event.ts + page-view.ts).
 */
export function isBot(userAgent: string | null): boolean {
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
    // GoogleOther — Google's non-SEO crawler (per Google guidance, must not be
    // used for SEO analytics). UA example: "...(compatible; GoogleOther)".
    "googleother",
  ];
  return botPatterns.some((pattern) => ua.includes(pattern));
}

/** DDL guard for the detailed funnel_events history (unchanged from event.ts). */
export async function ensureFunnelEventsTable(): Promise<void> {
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
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS source TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS medium TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS campaign TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS click_id TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS visitor_id TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS visit_id TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS user_id TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS user_email TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS city TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS region TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS device_type TEXT`;
  await sql()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS browser_label TEXT`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_funnel_events_created_at ON funnel_events (created_at)`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_funnel_events_event_name ON funnel_events (event_name)`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_funnel_events_source ON funnel_events (source)`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_funnel_events_visitor_id ON funnel_events (visitor_id)`;
  // Identity backfill depends on fast visitor_id lookups — keep this index.
  await sql()`CREATE INDEX IF NOT EXISTS idx_funnel_events_vid ON funnel_events (visitor_id)`;
}

/** DDL guard for the detailed page_views history (unchanged from page-view.ts). */
export async function ensurePageViewsTable(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS page_views (
    id SERIAL PRIMARY KEY,
    path TEXT NOT NULL,
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
  await sql()`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS source TEXT`;
  await sql()`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS medium TEXT`;
  await sql()`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS campaign TEXT`;
  await sql()`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS click_id TEXT`;
  await sql()`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS visitor_id TEXT`;
  await sql()`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS visit_id TEXT`;
  await sql()`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS user_id TEXT`;
  await sql()`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS user_email TEXT`;
  await sql()`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS city TEXT`;
  await sql()`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS region TEXT`;
  await sql()`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS device_type TEXT`;
  await sql()`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS browser_label TEXT`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views (created_at)`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_page_views_source ON page_views (source)`;
}

/**
 * DDL guard for the per-visitor SUMMARY cache table. Idempotent — safe to call
 * on every intake. Mirrors the .sql migration (db/migrations/021_visitors.sql).
 */
export async function ensureVisitorsTable(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS visitors (
    visitor_id TEXT PRIMARY KEY,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_path TEXT,
    last_path TEXT,
    first_ip TEXT,
    last_ip TEXT,
    city TEXT,
    region TEXT,
    device_type TEXT,
    browser_label TEXT,
    source TEXT,
    radar BOOLEAN NOT NULL DEFAULT FALSE,
    signup TEXT NOT NULL DEFAULT 'Not started',
    activated BOOLEAN NOT NULL DEFAULT FALSE,
    steps INTEGER NOT NULL DEFAULT 0,
    sessions INTEGER NOT NULL DEFAULT 0,
    last_visit_id TEXT,
    last_action TEXT,
    last_action_at TIMESTAMPTZ,
    converted_user_id TEXT,
    converted_at TIMESTAMPTZ,
    saw_pricing BOOLEAN NOT NULL DEFAULT FALSE,
    saw_brief BOOLEAN NOT NULL DEFAULT FALSE
  )`;
  await sql()`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS saw_pricing BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql()`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS saw_brief BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_visitors_last_seen_at ON visitors (last_seen_at)`;
}

/** @test.contrax / admin-email write-time exclusion for the summary row. */
function isTestOrAdminEmail(userEmail: string | null): boolean {
  if (!userEmail) return false;
  const lower = userEmail.trim().toLowerCase();
  if (lower.endsWith("@test.contrax")) return true;
  return ADMIN_EMAILS.has(lower);
}

interface VisitorUpsertInput {
  visitorId: string;
  path: string | null;
  ip: string | null;
  city: string | null;
  region: string | null;
  deviceType: string | null;
  browserLabel: string | null;
  source: string | null;
  eventName: string | null; // null for page views
  visitId: string | null;
  lastAction: string | null;
}

/**
 * Upsert the per-visitor summary row AFTER a detail row was successfully
 * written. The radar/signup/activated/steps/sessions semantics mirror exactly
 * what /admin/journeys derives live from the event set, so the admin display
 * can't drift:
 *
 *   - radar     = ever saw radar_scan_complete
 *   - activated = ever saw one of ACTIVATION_EVENTS
 *   - signup    = Success > Abandoned (started w/o success) > Viewed > Not started,
 *                 with a priority merge so order-of-events can't produce a value
 *                 the live derivation would not
 *   - steps     = count of detail rows actually written (timeline step count)
 *   - sessions  = distinct visit_ids (tracked cheaply via last_visit_id — real
 *                 sessions never reuse an id, so comparing to the last seen id
 *                 is equivalent to a distinct count in practice)
 *   - first_*   = kept on first sight (COALESCE), last_* = latest
 */
async function upsertVisitor(v: VisitorUpsertInput): Promise<void> {
  const {
    visitorId, path, ip, city, region, deviceType, browserLabel, source,
    eventName, visitId, lastAction,
  } = v;

  // Contribution of THIS event to the summary flags.
  const radarContrib = eventName === RADAR_COMPLETE_EVENT;
  const activatedContrib = eventName ? ACTIVATION_EVENTS.includes(eventName) : false;
  // Path-derived behavioral-intent badges (kept on the summary cache so the
  // /admin/journeys fast read-path can render badges without touching the
  // detail tables). Mirrors the live computeBadges() path checks exactly.
  const sawPricingContrib = !!path && path.includes("/pricing");
  const sawBriefContrib = !!path && path.includes("/example-brief");
  let signupContrib: string | null = null;
  if (eventName === "signup_success") signupContrib = "Success";
  // signup_abandon (PR #292 semantics: Success > Abandoned > Viewed > Not
  // started) also maps to Abandoned alongside started-but-no-success.
  else if (eventName && (SIGNUP_STARTED_EVENTS.includes(eventName) || eventName === "signup_abandon"))
    signupContrib = "Abandoned";
  else if (eventName && SIGNUP_VIEWED_EVENTS.includes(eventName)) signupContrib = "Viewed";

  await sql()`INSERT INTO visitors (
      visitor_id, first_seen_at, last_seen_at, first_path, last_path,
      first_ip, last_ip, city, region, device_type, browser_label, source,
      radar, signup, activated, steps, sessions, last_visit_id, last_action, last_action_at,
      saw_pricing, saw_brief
    ) VALUES (
      ${visitorId}, NOW(), NOW(), ${path}, ${path},
      ${ip}, ${ip}, ${city}, ${region}, ${deviceType}, ${browserLabel}, ${source},
      ${radarContrib}, ${signupContrib ?? "Not started"}, ${activatedContrib}, 1,
      ${visitId ? 1 : 0}, ${visitId}, ${lastAction}, NOW(),
      ${sawPricingContrib}, ${sawBriefContrib}
    )
    ON CONFLICT (visitor_id) DO UPDATE SET
      last_seen_at = NOW(),
      last_path = EXCLUDED.last_path,
      last_ip = COALESCE(EXCLUDED.last_ip, visitors.last_ip),
      first_ip = COALESCE(visitors.first_ip, EXCLUDED.first_ip),
      first_path = COALESCE(visitors.first_path, EXCLUDED.first_path),
      city = COALESCE(EXCLUDED.city, visitors.city),
      region = COALESCE(EXCLUDED.region, visitors.region),
      device_type = COALESCE(EXCLUDED.device_type, visitors.device_type),
      browser_label = COALESCE(EXCLUDED.browser_label, visitors.browser_label),
      radar = (visitors.radar OR EXCLUDED.radar),
      activated = (visitors.activated OR EXCLUDED.activated),
      signup = CASE
        WHEN EXCLUDED.signup = 'Success' OR visitors.signup = 'Success' THEN 'Success'
        WHEN EXCLUDED.signup = 'Abandoned' OR visitors.signup = 'Abandoned' THEN 'Abandoned'
        WHEN EXCLUDED.signup = 'Viewed' OR visitors.signup = 'Viewed' THEN 'Viewed'
        ELSE 'Not started'
      END,
      steps = visitors.steps + 1,
      sessions = CASE
        WHEN EXCLUDED.last_visit_id IS NULL THEN visitors.sessions
        WHEN visitors.last_visit_id IS NULL THEN visitors.sessions + 1
        WHEN visitors.last_visit_id = EXCLUDED.last_visit_id THEN visitors.sessions
        ELSE visitors.sessions + 1
      END,
      last_visit_id = COALESCE(EXCLUDED.last_visit_id, visitors.last_visit_id),
      last_action = EXCLUDED.last_action,
      last_action_at = EXCLUDED.last_action_at,
      saw_pricing = (visitors.saw_pricing OR EXCLUDED.saw_pricing),
      saw_brief = (visitors.saw_brief OR EXCLUDED.saw_brief)`;
}

/**
 * Shared intake handler — the single place every beacon (old + new) eventually
 * lands. `kindOverride` pins the kind (used by the legacy forwarders); when it
 * is undefined the kind is read from the body's `kind`/`type` field.
 */
export async function handleIntake(request: Request, kindOverride?: IntakeKind): Promise<Response> {
  // Declared outside the try so failure logs can include context even when
  // parsing or the DB write itself throws.
  let kind: IntakeKind = kindOverride ?? "event";
  let event = "";
  let label: string | null = null;
  let path: string | null = null;
  let referrer: string | null = null;
  let visitorId: string | null = null;
  let visitId: string | null = null;
  let userId: string | null = null;
  let userEmail: string | null = null;
  try {
    // Skip known bots/crawlers — don't pollute funnel event / page counts.
    const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 512) || null;
    if (isBot(userAgent)) {
      return Response.json({ ok: true, bot: true });
    }

    // Parse the body defensively — a malformed payload must not 500.
    try {
      const body = (await request.json()) as {
        kind?: unknown;
        type?: unknown;
        event?: unknown;
        label?: unknown;
        path?: unknown;
        referrer?: unknown;
        visitor_id?: unknown;
        visit_id?: unknown;
        user_id?: unknown;
        user_email?: unknown;
      };
      if (!kindOverride) {
        const k = typeof body.kind === "string" ? body.kind : typeof body.type === "string" ? body.type : "";
        if (k === "event" || k === "page") kind = k;
      }
      if (typeof body.event === "string" && body.event.trim().length > 0) {
        event = body.event.trim().slice(0, 64);
      }
      if (typeof body.label === "string" && body.label.length > 0) {
        label = body.label.slice(0, 128);
      }
      if (typeof body.path === "string" && body.path.length > 0) {
        path = body.path.slice(0, 2048);
      }
      if (typeof body.referrer === "string" && body.referrer.length > 0) {
        referrer = body.referrer.slice(0, 2048);
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
      // missing/malformed value must never fail the insert.
      if (typeof body.user_id === "string" && body.user_id.trim().length > 0) {
        userId = body.user_id.trim().slice(0, 64);
      }
      if (typeof body.user_email === "string" && body.user_email.trim().length > 0) {
        userEmail = body.user_email.trim().slice(0, 254);
      }
    } catch {
      // No/invalid JSON — nothing to record (events skip, pages record "/").
    }

    // Events REQUIRE a usable event name; pages default to "/".
    if (kind === "event" && !event) {
      return Response.json({ ok: true, skipped: true });
    }
    const pagePath = kind === "page" ? (path ?? "/") : (path ?? null);

    const ip = getClientIp(request);

    // Referrer signal — matches the previous per-endpoint behavior exactly:
    // page views prefer the BODY referrer (document.referrer) and fall back to
    // the Referer header (whose own value is the current page); funnel events
    // use the Referer header directly (they don't send a body referrer).
    const headerReferrer = (request.headers.get("referer") ?? "").slice(0, 2048) || null;
    const storedReferrer = kind === "page" ? (referrer ?? headerReferrer) : headerReferrer;

    // Geo + device context on the beacon (city/region/device/browser only —
    // never a raw IP or full UA). Fail-open: absent/invalid headers → nulls.
    const ctx = parseClientContext(request);

    // First-touch acquisition attribution, resolved in precedence order:
    // cookie (contrax_attr) → request query params → referer.
    const attr: Attribution = resolveAttribution({
      cookie: request.headers.get("cookie"),
      search: new URL(request.url).search,
      referer: storedReferrer,
    });

    const lastAction =
      kind === "event"
        ? (EVENT_LABELS[event] ?? event.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()))
        : (pagePath ?? null);

    if (kind === "event") {
      const insert = () =>
        sql()`INSERT INTO funnel_events (event_name, label, path, user_agent, ip, referrer, source, medium, campaign, click_id, visitor_id, visit_id, user_id, user_email, city, region, device_type, browser_label)
          VALUES (${event}, ${label}, ${pagePath}, ${userAgent}, ${ip}, ${storedReferrer}, ${attr.source}, ${attr.medium}, ${attr.campaign}, ${attr.click_id}, ${visitorId}, ${visitId}, ${userId}, ${userEmail}, ${ctx.city}, ${ctx.region}, ${ctx.device_type}, ${ctx.browser_label})`;

      try {
        await ensureFunnelEventsTable();
        // Dedupe identical events within ~1s (same event + visitor + path) at
        // write time. Time-windowed collapse, NOT a permanent constraint.
        if (visitorId) {
          const dup = await sql()`
            SELECT 1 FROM funnel_events
            WHERE event_name = ${event}
              AND visitor_id = ${visitorId}
              AND COALESCE(path, '') = ${pagePath ?? ""}
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
          console.error("[track-visitor] funnel_events write failed after retry:", dbErr, { event, label });
          return Response.json({ ok: false }, { status: 500 });
        }
      }
    } else {
      const insert = () =>
        sql()`INSERT INTO page_views (path, user_agent, ip, referrer, source, medium, campaign, click_id, visitor_id, visit_id, user_id, user_email, city, region, device_type, browser_label)
          VALUES (${pagePath}, ${userAgent}, ${ip}, ${storedReferrer}, ${attr.source}, ${attr.medium}, ${attr.campaign}, ${attr.click_id}, ${visitorId}, ${visitId}, ${userId}, ${userEmail}, ${ctx.city}, ${ctx.region}, ${ctx.device_type}, ${ctx.browser_label})`;

      try {
        await ensurePageViewsTable();
        // Dedupe identical page views within ~1s (same path + visitor).
        if (visitorId) {
          const dup = await sql()`
            SELECT 1 FROM page_views
            WHERE path = ${pagePath}
              AND visitor_id = ${visitorId}
              AND created_at >= NOW() - INTERVAL '1 second'
            LIMIT 1`;
          if (dup.length > 0) {
            return Response.json({ ok: true, deduped: true });
          }
        }
        await insert();
      } catch {
        await ensurePageViewsTable();
        await insert();
      }
    }

    // ── Per-visitor summary cache (best-effort, must NEVER fail the request) ──
    // Exclusions apply at write too: no visitors row for bot (filtered above),
    // @test.contrax, or admin-email traffic. Deduped beacons return early above,
    // so a summary row is only upserted when a real detail row was written —
    // steps/sessions therefore mirror the board's timeline counts exactly.
    if (visitorId && !isTestOrAdminEmail(userEmail)) {
      try {
        await ensureVisitorsTable();
        await upsertVisitor({
          visitorId,
          path: pagePath,
          ip,
          city: ctx.city,
          region: ctx.region,
          deviceType: ctx.device_type,
          browserLabel: ctx.browser_label,
          source: attr.source,
          eventName: kind === "event" ? event : null,
          visitId,
          lastAction,
        });
      } catch (summaryErr) {
        // The summary row is an accelerator — a failure here must not surface
        // as an error or drop the already-written detail row.
        console.error("[track-visitor] visitors summary upsert failed (non-fatal):", summaryErr);
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    // Unexpected failure — events keep the strict visible 500 (never crashes
    // the request; the client ignores it); page views swallow it, as before.
    console.error(`[track-visitor] tracking failed (kind=${kind}):`, err, { event, label, path });
    if (kind === "event") {
      return Response.json({ ok: false }, { status: 500 });
    }
    return Response.json({ ok: true, skipped: true });
  }
}