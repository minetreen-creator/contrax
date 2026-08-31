/**
 * Contrax Jarvis — RETRIEVAL READERS (the grounded half of the engine).
 *
 * Each reader is a DETERMINISTIC SQL lookup that pulls REAL, currently-in-DB data
 * into a compact, human-readable context bundle (`lines`) plus a `sources`
 * list describing exactly what was queried. The LLM later composes a natural
 * answer FROM THESE LINES ONLY — it never invents numbers. If a reader returns
 * no rows, `empty` is true and the caller responds honestly instead of calling AI.
 *
 * READ-ONLY: every statement in this file is a SELECT. Jarvis V1 performs ZERO
 * writes from its own path (the single non-SELECT is the shared rate-limit
 * upsert in checkRateLimit, infra reused from src/lib/rate-limit.ts).
 *
 * DATA HYGIENE: every aggregate re-applies the SAME exclusion predicates the
 * admin dashboard uses (bot traffic via BOT_EXCLUSION_SQL, @test.contrax QA
 * accounts via qaFunnelExclusionSQL, internal admin emails via
 * adminFunnelExclusionSQL). PII is masked — no full emails, IPs, or user-agents
 * ever enter the context bundle.
 */

import { sql } from "~/db";
// Phase 7 ADDITIVE: bid titles/agencies are SCRAPED .gov / RFP text — the most
// untrusted content Jarvis touches. Each closing-bid line is sanitized + made
// inert at the source (security.ts) before it can reach a grounding prompt or a
// worker brief. No behavior change for trusted lines.
import { sanitizeUntrusted, inlineUntrusted } from "~/lib/jarvis/security";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { qaFunnelExclusionSQL, adminFunnelExclusionSQL } from "~/lib/qa-exclusion";
import { ADMIN_EMAILS } from "~/lib/admin";

export interface ReaderCtx {
  question: string;
  /** ISO timestamp floor of the window (inclusive). */
  fromIso: string;
  /** Window length in days. */
  days: number;
  now: Date;
}

export interface ReaderResult {
  tool: string;
  /** Human title used by the grounding prompt ("today's activity", etc.). */
  label: string;
  /** One string per retrieved fact — the ONLY data the LLM may cite. */
  lines: string[];
  /** What was queried, for the UI's "grounded in real data" note. */
  sources: string[];
  /** True when nothing at all was retrieved — caller must not call AI. */
  empty: boolean;
}

export type Reader = (ctx: ReaderCtx) => Promise<ReaderResult>;

/** Shared human/bot/QA/admin exclusion fragment for funnel_events + page_views. */
const humanFilter = `NOT COALESCE((${BOT_EXCLUSION_SQL}), false)
  AND ${qaFunnelExclusionSQL("")} AND ${adminFunnelExclusionSQL("")}`;

/** Users-table exclusion (email-domain allowlist style) for users aggregates. */
const userExclusion = `LOWER(COALESCE(email,'')) NOT LIKE '%@test.contrax'
  AND ${[...ADMIN_EMAILS]
    .map((e) => `LOWER(COALESCE(email,'')) <> '${e.toLowerCase()}'`)
    .join(" AND ")}`;

const RADAR_COMPLETE = "radar_scan_complete";
const ACTIVATION_EVENTS = [
  "rfp_brief_result",
  "save_success",
  "score_result",
  "score_submit",
  "alert_created",
];

/** @test.contrax / admin read-side exclusion for converted (linked) visitors. */
function isExcludedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.trim().toLowerCase();
  if (!lower.includes("@")) return false;
  if (lower.endsWith("@test.contrax")) return true;
  return ADMIN_EMAILS.has(lower);
}

function countMsg(n: number | string, noun: string, suffix = ""): string {
  return `${noun}: ${n}${suffix}`;
}

/* ════════════════════════════════════════════════════════════════════════
 * 1) TODAY — "What happened at Contrax today?"
 *    funnel_events / page_views / visitors / users / bids / radar_saves / sync
 * ════════════════════════════════════════════════════════════════════════ */
export const todayReader: Reader = async (ctx) => {
  const { fromIso } = ctx;
  const db = sql();
  const lines: string[] = [];
  const wLabel = `last ${ctx.days}d`;

  const [fe, pv, rad, bids, users] = await Promise.all([
    db`SELECT COUNT(*) AS n FROM funnel_events
        WHERE created_at >= ${fromIso} AND ${db.unsafe(humanFilter)}`,
    db`SELECT COUNT(*) AS n, COUNT(DISTINCT visitor_id) AS v FROM page_views
        WHERE created_at >= ${fromIso} AND ${db.unsafe(humanFilter)}`,
    db`SELECT COUNT(*) AS n FROM radar_saves WHERE created_at >= ${fromIso}`,
    db`SELECT COUNT(*) AS n FROM bids WHERE created_at >= ${fromIso}`,
    db`SELECT COUNT(*) AS n FROM users
        WHERE created_at >= ${fromIso} AND ${db.unsafe(userExclusion)}`,
  ]);

  lines.push(countMsg(Number(fe[0]?.n ?? 0), "tracked funnel events", ` (${wLabel})`));
  lines.push(countMsg(Number(pv[0]?.n ?? 0), "page views", ` (${wLabel})`));
  lines.push(countMsg(Number(pv[0]?.v ?? 0), "unique human visitors", ` (${wLabel})`));
  lines.push(countMsg(Number(rad[0]?.n ?? 0), "saved radar leads", ` (${wLabel})`));
  lines.push(countMsg(Number(bids[0]?.n ?? 0), "new bids synced", ` (${wLabel})`));
  lines.push(countMsg(Number(users[0]?.n ?? 0), "new signups", ` (${wLabel})`));

  // Top funnel events in-window (what people actually did).
  const topEvents = await db`
    SELECT event_name, COUNT(*) AS n FROM funnel_events
      WHERE created_at >= ${fromIso} AND ${db.unsafe(humanFilter)}
      GROUP BY event_name ORDER BY n DESC LIMIT 5`;
  if (topEvents.length) {
    lines.push("Top funnel events: " +
      (topEvents as any[]).map((r) => `${r.event_name} (${r.n})`).join(", "));
  }

  // Latest bid-sync status.
  const syncs = await db`
    SELECT source, fetched, new, created_at FROM sync_logs
      ORDER BY created_at DESC LIMIT 3`;
  if (syncs.length) {
    lines.push("Latest syncs: " +
      (syncs as any[]).map((s) => `${s.source}: +${s.new} new of ${s.fetched} fetched`).join(" | "));
  }

  const empty = Number(fe[0]?.n ?? 0) === 0 && Number(pv[0]?.n ?? 0) === 0 &&
    Number(users[0]?.n ?? 0) === 0 && Number(rad[0]?.n ?? 0) === 0 && Number(bids[0]?.n ?? 0) === 0;

  return {
    tool: "today",
    label: `${wLabel} activity snapshot`,
    lines,
    sources: [
      `funnel_events + page_views (${wLabel}, bot/QA/admin exclusions applied)`,
      `users + bids + radar_saves + sync_logs (${wLabel})`,
    ],
    empty,
  };
};

/* ════════════════════════════════════════════════════════════════════════
 * Unified funnel from the DETAIL tables (funnel_events + users) — grounded in
 * real tracked events regardless of whether the `visitors` summary cache is
 * warm. Stage semantics match the admin Visitor Journeys board:
 *   Qualified → Radar → Signup → Activated → Paid.
 * All exclusions applied. Paid = distinct linked users with an active
 * subscription (users table), QA/admin excluded.
 * ════════════════════════════════════════════════════════════════════════ */
async function computeFunnelLines(db: ReturnType<typeof sql>, fromIso: string): Promise<{
  lines: string[];
  stages: { stage: string; count: number }[];
}> {
  const stage = async (eventNames: string[]): Promise<number> => {
    const r = await db`
      SELECT COUNT(DISTINCT visitor_id) AS n FROM funnel_events
      WHERE visitor_id IS NOT NULL AND visitor_id <> ''
        AND created_at >= ${fromIso}
        AND event_name = ANY(${eventNames})
        AND ${db.unsafe(humanFilter)}`;
    return Number(r[0]?.n ?? 0);
  };
  const qualified = await stage([...ACTIVATION_EVENTS, RADAR_COMPLETE, "signup_view", "signup_view_with_score", "signup_start", "signup_submit", "signup_abandon", "signup_success", "hero_cta_click", "radar_scan_start"]);
  const radar = await stage([RADAR_COMPLETE]);
  const signup = await stage(["signup_success"]);
  const activated = await stage(ACTIVATION_EVENTS);

  // Paid: distinct funnel users linked to an active-subscription account.
  // funnel_events.user_id is stored as TEXT (analytics convention), so compare
  // against users.id as text to avoid "integer = text" type errors.
  const pr = await db`
    SELECT COUNT(DISTINCT fe.user_id) AS n
    FROM funnel_events fe JOIN users u ON u.id::text = fe.user_id
    WHERE fe.user_id IS NOT NULL AND fe.user_id <> '' AND fe.created_at >= ${fromIso}
      AND u.subscription_status = 'active'
      AND ${db.unsafe(humanFilter)}`;
  const paid = Number(pr[0]?.n ?? 0);

  const stages = [
    { stage: "qualified", count: qualified },
    { stage: "radar", count: radar },
    { stage: "signup", count: signup },
    { stage: "activated", count: activated },
    { stage: "paid", count: paid },
  ];
  const drop = (from: number, to: number) => (from === 0 ? null : Math.round((1 - to / from) * 1000) / 10);
  const lines = [
    `Funnel: qualified ${qualified} → radar ${radar} (−${drop(qualified, radar) ?? 0}%) → signup ${signup} (−${drop(radar, signup) ?? 0}%) → activated ${activated} (−${drop(signup, activated) ?? 0}%) → paid ${paid}`,
    `Visitor→signup conversion: ${qualified === 0 ? 0 : Math.round((signup / qualified) * 1000) / 10}%`,
  ];
  return { lines, stages };
}

/* ════════════════════════════════════════════════════════════════════════
 * 2) SIGNUP — "Why aren't people signing up?"
 *    funnel + signup event decomposition + abandonment pattern.
 * ════════════════════════════════════════════════════════════════════════ */
export const signupReader: Reader = async (ctx) => {
  const { fromIso } = ctx;
  const db = sql();
  const lines: string[] = [];
  const fun = await computeFunnelLines(db, fromIso);
  lines.push(...fun.lines);

  const signupEvents = ["signup_view", "signup_view_with_score", "signup_start",
    "signup_submit", "signup_abandon", "signup_success", "signup_error", "signup_cta_click"];
  const ev = await db`
    SELECT event_name, COUNT(*) AS n FROM funnel_events
      WHERE event_name = ANY(${signupEvents}) AND created_at >= ${fromIso}
        AND ${db.unsafe(humanFilter)}
      GROUP BY event_name`;
  const counts = Object.fromEntries((ev as any[]).map((r) => [r.event_name, Number(r.n)]));
  const view = (counts["signup_view"] ?? 0) + (counts["signup_view_with_score"] ?? 0);
  const start = (counts["signup_start"] ?? 0) + (counts["signup_submit"] ?? 0);
  const success = counts["signup_success"] ?? 0;
  const abandoned = counts["signup_abandon"] ?? 0;
  lines.push(`Signup event funnel: viewed ${view} → started ${start} → completed ${success} (abandon beacon ${abandoned}, errors ${counts["signup_error"] ?? 0})`);

  // Abandoned visitors: started signup (or viewed) but never succeeded.
  const abandonedVis = await db`
    SELECT COUNT(*) AS n FROM (
      SELECT visitor_id FROM funnel_events
        WHERE event_name IN ('signup_view','signup_view_with_score','signup_start','signup_submit','signup_abandon')
          AND visitor_id IS NOT NULL AND visitor_id <> '' AND created_at >= ${fromIso} AND ${db.unsafe(humanFilter)}
      EXCEPT
      SELECT visitor_id FROM funnel_events
        WHERE event_name = 'signup_success' AND visitor_id IS NOT NULL AND visitor_id <> ''
          AND created_at >= ${fromIso} AND ${db.unsafe(humanFilter)}
    ) t`;
  lines.push(`Visitors who started signup but never completed: ${Number(abandonedVis[0]?.n ?? 0)}`);

  const empty = view === 0 && success === 0 && fun.stages[0].count === 0;
  return {
    tool: "signup",
    label: "signup funnel",
    lines,
    sources: [`visitors summary cache + funnel_events (${ctx.days}d, exclusions applied)`],
    empty,
  };
};

/* ════════════════════════════════════════════════════════════════════════
 * 3) TOP VISITORS — "Show me the highest-intent visitors."
 *    Top by steps / radar / signup / activated, PII-masked.
 * ════════════════════════════════════════════════════════════════════════ */
export const topVisitorsReader: Reader = async (ctx) => {
  const { fromIso } = ctx;
  const db = sql();
  const vis: any[] = await db`
    SELECT visitor_id, source, radar, signup, activated, steps, last_action, last_action_at, converted_user_id, city, region
    FROM visitors WHERE last_seen_at >= ${fromIso}
    ORDER BY steps DESC NULLS LAST LIMIT 10`;
  if (!vis.length) {
    return { tool: "topVisitors", label: "top visitors", lines: [], sources: ["visitors (n/a)"], empty: true };
  }
  const convertedIds = [...new Set(vis.map((v) => v.converted_user_id).filter((x) => x != null && x !== ""))];
  const emailMap = new Map<string, string>();
  if (convertedIds.length) {
    const ur: any[] = await db`SELECT id, email FROM users WHERE id::text = ANY(${convertedIds})`;
    for (const u of ur) emailMap.set(String(u.id), u.email);
  }
  const lines: string[] = [];
  for (const v of vis) {
    if (v.converted_user_id && isExcludedEmail(emailMap.get(String(v.converted_user_id)))) continue;
    // Masked label: linked user → local-part@… ; anonymous → geo/behavioral. No raw PII.
    const email = v.converted_user_id ? emailMap.get(String(v.converted_user_id)) : null;
    const label = email && email.includes("@")
      ? `${email.split("@")[0]}@…`
      : [v.city, v.region].filter(Boolean).join(", ") || "Direct Lead";
    const flags = [
      v.radar ? "radar" : null,
      v.activated ? "activated" : null,
      v.signup === "Success" ? "signed up" : v.signup !== "Not started" ? `signup:${v.signup}` : null,
    ].filter(Boolean).join(",");
    lines.push(`Vis ${label} (src:${v.source ?? "direct"}) — steps ${v.steps} [${flags || "no intent flags"}] last:${v.last_action ?? "—"}`);
  }
  return {
    tool: "topVisitors",
    label: "highest-intent visitors",
    lines,
    sources: [`visitors summary cache (${ctx.days}d, exclusions applied, PII-masked)`],
    empty: false,
  };
};

/* ════════════════════════════════════════════════════════════════════════
 * 4) CLOSING BIDS — "What HVAC opportunities are closing soon?"
 *    Real bids, due soonest, matching trade keywords / NAICS, with links.
 * ════════════════════════════════════════════════════════════════════════ */
const HVAC_KEYWORDS = ["hvac", "heating", "ventilation", "air conditioning", "cooling", "ac system", "chiller"];

export const closingBidsReader: Reader = async (ctx) => {
  const { question } = ctx;
  const db = sql();
  const lower = question.toLowerCase();
  const isHvac = HVAC_KEYWORDS.some((k) => lower.includes(k));

  let rows: any[];
  if (isHvac) {
    // Keywords are safe constants; quote them as SQL string literals so
    // multi-word terms ("air conditioning") don't break the expression.
    const likeOrs = HVAC_KEYWORDS.map(
      (k) => `LOWER(COALESCE(title,'')||' '||COALESCE(category,'')||' '||COALESCE(description,'')) LIKE '%'||'${k.replace(/'/g, "''")}'||'%'`,
    ).join(" OR ");
    rows = await db`
      SELECT title, agency, due_date, estimated_value, set_aside, naics_code, source_url
      FROM bids
      WHERE due_date >= NOW()
        AND (${db.unsafe(likeOrs)}
          OR COALESCE(naics_code,'') IN ('238220','333415','221112','336390'))
      ORDER BY due_date ASC LIMIT 8`;
  } else {
    rows = await db`
      SELECT title, agency, due_date, estimated_value, set_aside, naics_code, source_url
      FROM bids WHERE due_date >= NOW()
      ORDER BY due_date ASC LIMIT 8`;
  }

  if (!rows.length) {
    return { tool: "closingBids", label: "closing opportunities", lines: [], sources: ["bids (no upcoming due dates)"], empty: true };
  }
  const lines = (rows as any[]).map((b) =>
    inlineUntrusted(
      `“${b.title}” — ${b.agency ?? "n/a"} · due ${new Date(b.due_date).toISOString().slice(0, 10)} · est ${sanitizeUntrusted(b.estimated_value ?? "n/a")} · ${sanitizeUntrusted(b.set_aside ?? "no set-aside")}${b.naics_code ? ` · NAICS ${sanitizeUntrusted(b.naics_code)}` : ""} · ${sanitizeUntrusted(b.source_url ?? "no link")}`,
    ),
  );
  return {
    tool: "closingBids",
    label: isHvac ? "HVAC opportunities closing soon" : "soonest-closing opportunities",
    lines,
    sources: ["bids (future due_date, ordered by due date, upcoming 8)"],
    empty: false,
  };
};

/* ════════════════════════════════════════════════════════════════════════
 * 5) OUTREACH — "How is outreach performing?"
 *    source/medium attribution: visits, leads (radar_saves), signup conversions.
 * ════════════════════════════════════════════════════════════════════════ */
export const outreachReader: Reader = async (ctx) => {
  const { fromIso } = ctx;
  const db = sql();
  const lines: string[] = [];

  const visits = await db`
    SELECT COALESCE(NULLIF(source,''),'direct') AS source, COALESCE(medium,'(none)') AS medium, COUNT(*) AS n
    FROM page_views WHERE created_at >= ${fromIso} AND ${db.unsafe(humanFilter)}
    GROUP BY 1, 2 ORDER BY n DESC LIMIT 8`;
  const convos = await db`
    SELECT COALESCE(NULLIF(source,''),'direct') AS source, COUNT(*) AS n FROM funnel_events
      WHERE event_name = 'signup_success' AND created_at >= ${fromIso} AND ${db.unsafe(humanFilter)}
      GROUP BY 1 ORDER BY n DESC LIMIT 8`;
  const leads = await db`
    SELECT COALESCE(NULLIF(source,''),'direct') AS source, COALESCE(medium,'(none)') AS medium, COUNT(*) AS n
    FROM radar_saves WHERE created_at >= ${fromIso}
    GROUP BY 1, 2 ORDER BY n DESC LIMIT 8`;

  if (!visits.length && !convos.length && !leads.length) {
    return { tool: "outreach", label: "outreach performance", lines: [], sources: ["page_views/funnel_events/radar_saves (n/a)"], empty: true };
  }
  if (visits.length) {
    lines.push("Visits by source: " + (visits as any[]).map((r) => `${r.source ?? "direct"}/${r.medium} (${r.n})`).join(", "));
  }
  if (leads.length) {
    lines.push("Saved radar leads by source: " + (leads as any[]).map((r) => `${r.source ?? "direct"}/${r.medium} (${r.n})`).join(", "));
  }
  if (convos.length) {
    lines.push("Signup conversions by source: " + (convos as any[]).map((r) => `${r.source ?? "direct"} (${r.n})`).join(", "));
  } else {
    lines.push("Signup conversions by source: none in window");
  }
  return {
    tool: "outreach",
    label: "outreach performance",
    lines,
    sources: ["page_views + funnel_events (human exclusions) + radar_saves", `over ${ctx.days}d`],
    empty: false,
  };
};

/* ════════════════════════════════════════════════════════════════════════
 * 6) BIGGEST PROBLEM — identify the largest real drop-off / most significant
 *    current signal from the retrieved data (drop-offs are FACTS).
 * ════════════════════════════════════════════════════════════════════════ */
export const problemReader: Reader = async (ctx) => {
  const { fromIso } = ctx;
  const db = sql();
  const fun = await computeFunnelLines(db, fromIso);
  const lines = [...fun.lines];
  const stages = fun.stages;
  // Largest absolute drop-off between consecutive stages.
  let biggest: { from: string; to: string; loss: number; pct: number | null } | null = null;
  for (let i = 1; i < stages.length; i++) {
    const loss = stages[i - 1].count - stages[i].count;
    if (loss > 0) {
      const pct = stages[i - 1].count === 0 ? null : Math.round((loss / stages[i - 1].count) * 1000) / 10;
      if (!biggest || loss > biggest.loss) {
        biggest = { from: stages[i - 1].stage, to: stages[i].stage, loss, pct };
      }
    }
  }
  if (biggest) {
    lines.push(`Largest funnel drop-off: ${biggest.from} → ${biggest.to} lost ${biggest.loss} (${biggest.pct ?? 0}%)`);
  } else if (stages[0].count > 0) {
    lines.push("No funnel drop-off detected in window (each stage retained at least one).");
  }

  // Suspicious analytics signals worth flagging.
  const feToday = await db`
    SELECT COUNT(*) AS n FROM funnel_events
      WHERE created_at >= ${ctx.fromIso} AND ${db.unsafe(humanFilter)}`;
  lines.push(`Tracked funnel events in window: ${Number(feToday[0]?.n ?? 0)}`);
  if (stages[0].count > 0 && stages[2].count === 0) {
    lines.push("FLAG: qualified visitors exist but ZERO signups completed — conversion is 0% (possible blocker).");
  }

  const empty = stages[0].count === 0;
  return {
    tool: "problem",
    label: "biggest current problem",
    lines,
    sources: ["visitors summary cache + funnel_events", `over ${ctx.days}d, exclusions applied`],
    empty,
  };
};

/* ════════════════════════════════════════════════════════════════════════
 * 7) FOCUS TODAY — prioritized RECOMMENDATION input. Reuses the funnel + a
 *    couple of quick facts; the grounding prompt turns this into a clearly
 *    labeled recommendation (NOT a fact).
 * ════════════════════════════════════════════════════════════════════════ */
export const focusReader: Reader = async (ctx) => {
  const { fromIso } = ctx;
  const db = sql();
  const fun = await computeFunnelLines(db, fromIso);
  const lines = [...fun.lines];
  const leads = await db`SELECT COUNT(*) AS n FROM radar_saves WHERE created_at >= ${fromIso}`;
  lines.push(`Saved radar leads in window: ${Number(leads[0]?.n ?? 0)} (warm, opted-in contacts — follow up).`);
  const closing = await closingBidsReader({ ...ctx, question: "" });
  if (!closing.empty) lines.push(`Soonest-closing opportunity: ${closing.lines[0]}`);

  const empty = fun.stages[0].count === 0 && Number(leads[0]?.n ?? 0) === 0;
  return {
    tool: "focus",
    label: "recommended focus",
    lines,
    sources: ["visitors summary cache + radar_saves + bids", `over ${ctx.days}d, exclusions applied`],
    empty,
  };
};
