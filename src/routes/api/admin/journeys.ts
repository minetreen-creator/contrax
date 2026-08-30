import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { qaFunnelExclusionSQL } from "~/lib/qa-exclusion";

/**
 * GET /api/admin/journeys?days=30
 *
 * Admin-only "Visitor Journeys" board (owner, 2026-09-01). Rebuilds one row per
 * real person/session from the self-hosted analytics (funnel_events + page_views),
 * each expanding into a timestamped timeline. Returns:
 *
 *   funnel   — a unified funnel: Qualified visit → Radar completed → Signup
 *              completed → Activated → Paid, with counts + drop-off % at each stage.
 *              "Qualified visit" = a real (non-bot, non-QA) human visitor.
 *              "Activated" = the user performed a first successful AI Brief,
 *              saved bid, match-score action, or alert creation (any of the
 *              activation event names in ACTIVATION_EVENTS below).
 *   journeys — one object per visitor_id: label (recognizable, NO raw plaintext
 *              PII), first-touch source, landing page, radar/signup/activated/paid
 *              flags, last activity + timestamp, and the ordered event timeline.
 *
 * DATA-HYGIENE: masks PII. Anonymous visitors → "Anonymous <last4>"; linked
 * users → "local-part@…" (local-part + masked domain). No full emails on the
 * board. The timeline is rebuilt ONLY from stored rows — never fabricated.
 *
 * EXCLUSIONS (owner rule, 2026-08-28): applies the shared BOT_EXCLUSION_SQL
 * predicate and the @test.contrax QA-email exclusion so QA / admin / test /
 * bot traffic never appears on the board or in the funnel counts.
 */

const ACTIVATION_EVENTS = [
  "rfp_brief_result", // first successful AI Brief
  "save_success", // saved a bid
  "score_result", // match-score result shown
  "score_submit", // match-score submitted
  "alert_created", // bid alert created (recorded server-side at sync)
] as const;

/** Signup-progress events, ordered from earliest intent to success. */
const SIGNUP_EVENTS = {
  viewed: ["signup_view", "signup_view_with_score"],
  started: ["signup_start", "signup_submit"],
} as const;

const RADAR_COMPLETE = "radar_scan_complete";

/** Human-readable timeline labels for known funnel events. */
const EVENT_LABELS: Record<string, string> = {
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

interface TimelineItem {
  t: string; // ISO timestamp
  label: string;
  kind: "page" | "event";
}
interface Journey {
  visitor_id: string;
  label: string; // masked, recognizable identifier (NO full PII)
  source: string | null;
  landing_page: string | null;
  radar: boolean;
  signup: "Not started" | "Viewed" | "Started" | "Abandoned" | "Success";
  activated: boolean;
  paid: boolean;
  last_activity: string | null; // ISO
  events: TimelineItem[];
}
interface FunnelStage {
  stage: "qualified" | "radar" | "signup" | "activated" | "paid";
  label: string;
  count: number;
  dropOffPct: number | null; // % lost from previous stage
}
interface JourneysResult {
  rangeDays: number;
  from: string;
  to: string;
  funnel: FunnelStage[];
  journeys: Journey[];
}

const EMPTY: JourneysResult = {
  rangeDays: 30,
  from: "",
  to: "",
  funnel: [],
  journeys: [],
};

/** last-4 of a visitor id for the recognizable "Anonymous <last4>" label. */
function last4(id: string): string {
  return id.replace(/[^0-9a-zA-Z]/g, "").slice(-4).toLowerCase() || "????";
}

/** Masked, recognizable identity — never a full email. */
function buildLabel(userEmail: string | null | undefined, visitorId: string): string {
  const email = userEmail?.trim().toLowerCase();
  if (email && email.includes("@")) {
    const [local] = email.split("@");
    // "ali@…" style — recognizable local-part, masked domain (no full email).
    return `${local}@…`;
  }
  return `Anonymous ${last4(visitorId)}`;
}

function pageLabel(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (clean === "/") return "Homepage viewed";
  return `Viewed ${clean}`;
}

/** Signup status from the raw event-name set, with abandonment semantics. */
function signupStatus(events: Set<string>): Journey["signup"] {
  if (events.has("signup_success")) return "Success";
  const started = SIGNUP_EVENTS.started.some((e) => events.has(e));
  const viewed = SIGNUP_EVENTS.viewed.some((e) => events.has(e));
  if (started) return "Abandoned"; // started but never succeeded
  if (viewed) return "Viewed";
  return "Not started";
}

function pct(n: number, d: number): number | null {
  if (d === 0) return null;
  return Math.round((1 - n / d) * 1000) / 10;
}

async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

  const url = new URL(request.url);
  const daysParam = parseInt(url.searchParams.get("days") || "30", 10);
  const rangeDays = Number.isFinite(daysParam) ? Math.min(365, Math.max(1, daysParam)) : 30;
  const now = new Date();
  const from = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);
  const fromIso = from.toISOString();

  // Shared bot/QA exclusion fragment, inlined into WHERE clauses.
  const humanFilter = `AND NOT COALESCE((${BOT_EXCLUSION_SQL}), false)`;
  const qaFilter = `AND ${qaFunnelExclusionSQL("")}`;

  try {
    // N.B. funnel_events/page_views tables are created lazily; guard quietly so
    // a first deploy with no tables returns an honest empty result.
    try {
      await sql()`SELECT 1 FROM funnel_events LIMIT 1`;
      await sql()`SELECT 1 FROM page_views LIMIT 1`;
    } catch {
      return Response.json({ ...EMPTY, rangeDays, from: fromIso, to: now.toISOString() });
    }

    // All qualifying rows (human, non-QA) within the window, from both tables.
    const pageRows: any[] = await sql()`
      SELECT visitor_id, created_at, path, source, user_id, user_email
      FROM page_views
      WHERE visitor_id IS NOT NULL AND visitor_id <> ''
        AND created_at >= ${fromIso}
        ${sql().unsafe(humanFilter)}
        ${sql().unsafe(qaFilter)}
      ORDER BY created_at ASC`;
    const eventRows: any[] = await sql()`
      SELECT visitor_id, created_at, event_name, path, source, user_id, user_email
      FROM funnel_events
      WHERE visitor_id IS NOT NULL AND visitor_id <> ''
        AND created_at >= ${fromIso}
        ${sql().unsafe(humanFilter)}
        ${sql().unsafe(qaFilter)}
      ORDER BY created_at ASC`;

    // Group by visitor.
    const byVisitor = new Map<string, Journey>();
    const linkedUsers = new Map<string, string>(); // visitor_id -> email (backfilled)
    const visitorUserMap = new Map<string, string>(); // visitor_id -> user_id (backfilled)
    const seenEvents = new Map<string, Set<string>>();
    const paidMap = new Map<string, number>(); // user_id(->string) -> 1 if active

    pageRows.forEach((r) => {
      const vid = r.visitor_id;
      if (!byVisitor.has(vid)) {
        byVisitor.set(vid, {
          visitor_id: vid,
          label: "Anonymous",
          source: null,
          landing_page: null,
          radar: false,
          signup: "Not started",
          activated: false,
          paid: false,
          last_activity: null,
          events: [],
        });
      }
      const j = byVisitor.get(vid)!;
      if (j.landing_page === null && r.path && r.path !== "/") j.landing_page = r.path;
      if (r.source) j.source = j.source ?? r.source;
      // first row is earliest (sorted ASC) — set landing/source on first page
      if (r.user_email) linkedUsers.set(vid, r.user_email);
      if (r.user_id) linkedUsers.set(vid, linkedUsers.get(vid) ?? "");
      j.events.push({
        t: new Date(r.created_at).toISOString(),
        label: r.path === "/" ? "Homepage viewed" : pageLabel(r.path),
        kind: "page",
      });
    });

    eventRows.forEach((r) => {
      const vid = r.visitor_id;
      if (!byVisitor.has(vid)) {
        byVisitor.set(vid, {
          visitor_id: vid,
          label: "Anonymous",
          source: null,
          landing_page: null,
          radar: false,
          signup: "Not started",
          activated: false,
          paid: false,
          last_activity: null,
          events: [],
        });
      }
      const j = byVisitor.get(vid)!;
      if (r.source) j.source = j.source ?? r.source;
      if (r.user_email) linkedUsers.set(vid, r.user_email);
      if (r.user_id) visitorUserMap.set(vid, String(r.user_id));
      if (!seenEvents.has(vid)) seenEvents.set(vid, new Set());
      seenEvents.get(vid)!.add(r.event_name);
      const label =
        EVENT_LABELS[r.event_name] ?? r.event_name.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
      j.events.push({
        t: new Date(r.created_at).toISOString(),
        label,
        kind: "event",
      });
    });

    // Resolve paid status from the users table for any linked user in the window.
    const paidUserIds = [...new Set([...visitorUserMap.values()])].filter(Boolean);
    if (paidUserIds.length > 0) {
      const usersRows: any[] = await sql()`
        SELECT id, subscription_status FROM users WHERE id = ANY(${paidUserIds})`;
      for (const ur of usersRows) {
        paidMap.set(String(ur.id), ur.subscription_status === "active" ? 1 : 0);
      }
    }

    // Finalize each journey.
    const journeys: Journey[] = [];
    for (const [vid, j] of byVisitor) {
      j.events.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
      if (j.events.length > 0) j.last_activity = j.events[j.events.length - 1].t;
      const events = seenEvents.get(vid) ?? new Set<string>();
      j.radar = events.has(RADAR_COMPLETE);
      j.signup = signupStatus(events);
      j.activated = ACTIVATION_EVENTS.some((e) => events.has(e));
      j.label = buildLabel(linkedUsers.get(vid), vid);
      // paid only meaningful for linked users (subscription_status='active').
      const uid = visitorUserMap.get(vid);
      j.paid = uid != null && uid.length > 0 && paidMap.get(uid) === 1;
      if (!j.source) j.source = null;
      journeys.push(j);
    }
    // Newest activity first.
    journeys.sort((a, b) => (b.last_activity ?? "").localeCompare(a.last_activity ?? ""));

    // Unified funnel.
    const total = journeys.length;
    const radar = journeys.filter((j) => j.radar).length;
    const signup = journeys.filter((j) => j.signup === "Success").length;
    const activated = journeys.filter((j) => j.activated).length;
    const paid = journeys.filter((j) => j.paid).length;
    const funnel: FunnelStage[] = [
      { stage: "qualified", label: "Qualified visit", count: total, dropOffPct: null },
      { stage: "radar", label: "Radar completed", count: radar, dropOffPct: pct(radar, total) },
      { stage: "signup", label: "Signup completed", count: signup, dropOffPct: pct(signup, radar) },
      { stage: "activated", label: "Activated", count: activated, dropOffPct: pct(activated, signup) },
      { stage: "paid", label: "Paid", count: paid, dropOffPct: pct(paid, activated) },
    ];

    return Response.json({
      rangeDays,
      from: fromIso,
      to: now.toISOString(),
      funnel,
      journeys,
    });
  } catch (err) {
    console.error("[api/admin/journeys] error:", err);
    return Response.json(EMPTY);
  }
}

export const Route = createFileRoute("/api/admin/journeys")({
  server: { handlers: { GET: handler } },
});
