import { sql } from "~/db";
import { fetchOpenAIWithRetry, sanitizeLogString } from "~/lib/ai";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { adminFunnelExclusionSQL, qaExternalUserSQL, qaFunnelExclusionSQL } from "~/lib/qa-exclusion";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { SIGNUP_VIEWED_EVENTS } from "~/lib/tracking-intake";
import { outreachOverview } from "~/lib/outreach.server";
import {
  clampDays,
  JARVIS_TOOLS,
  jarvisPrompt,
  MAX_QUESTION_CHARS,
  MAX_TOOL_ROUNDS,
  parseJarvisReply,
  sanitizeHistory,
  simulateFunnel,
  VISUAL_TOOL,
  type JarvisReply,
  type JarvisServerStats,
  type JarvisSnapshot,
  type JarvisVisual,
  type SimBaseline,
  type SimResult,
} from "~/lib/jarvis";

/**
 * Jarvis's brain (src/lib/jarvis.ts) for /api/admin/jarvis. Answers with
 * OpenAI function calling: the model sees the console's data plus today's
 * counts, and can look up more through the read-only tools below.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
/** A stronger model than the site default: Jarvis has to reason over the data. */
const SMART_MODEL = process.env.JARVIS_MODEL || "gpt-4.1";
const FALLBACK_MODEL = "gpt-4o-mini";
const ET = "America/New_York";

const human = () => `NOT ${BOT_EXCLUSION_SQL} AND ${qaFunnelExclusionSQL()} AND ${adminFunnelExclusionSQL()}`;
const PAID = `LOWER(COALESCE(medium, '')) IN ('cpc', 'ppc', 'paid', 'paidsocial', 'display')`;

export async function serverStats(): Promise<JarvisServerStats> {
  const now = new Date().toLocaleString("en-US", { timeZone: ET, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  const stats: JarvisServerStats = { now, visitorsToday: null, visitorsYesterday: null, week: null, outreach: null };
  const db = sql();
  try {
    const [v] = (await db.query(
      `SELECT COUNT(DISTINCT visitor_id) FILTER (WHERE (created_at AT TIME ZONE '${ET}')::date = (NOW() AT TIME ZONE '${ET}')::date)::int AS today,
              COUNT(DISTINCT visitor_id) FILTER (WHERE (created_at AT TIME ZONE '${ET}')::date = (NOW() AT TIME ZONE '${ET}')::date - 1)::int AS yesterday
       FROM page_views
       WHERE created_at > NOW() - INTERVAL '50 hours' AND visitor_id IS NOT NULL AND path NOT LIKE '/admin%' AND ${human()}`,
    )) as { today: number; yesterday: number }[];
    stats.visitorsToday = Number(v?.today ?? 0);
    stats.visitorsYesterday = Number(v?.yesterday ?? 0);
  } catch (err) {
    console.error("[jarvis] visitor counts failed:", sanitizeLogString(err));
  }
  try {
    const f = await funnel(7);
    const [a] = (await db.query(
      `SELECT COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new_accounts,
              COUNT(*) FILTER (WHERE trial_started_at > NOW() - INTERVAL '7 days')::int AS trials,
              COUNT(*) FILTER (WHERE subscription_status = 'active')::int AS paying
       FROM users WHERE ${qaExternalUserSQL()}`,
    )) as { new_accounts: number; trials: number; paying: number }[];
    stats.week = {
      visitors: f.visited,
      searches: f.searched,
      signups: f.signed_up,
      newAccounts: Number(a?.new_accounts ?? 0),
      trialsStarted: Number(a?.trials ?? 0),
      payingNow: Number(a?.paying ?? 0),
    };
  } catch (err) {
    console.error("[jarvis] week stats failed:", sanitizeLogString(err));
  }
  try {
    const o = await outreachOverview();
    stats.outreach = { waiting: o.stats.drafts, sentToday: o.stats.sentToday, sentFirst: o.stats.sentFirst, sentFollowup: o.stats.sentFollowup, unsubscribed: o.stats.suppressed };
  } catch (err) {
    console.error("[jarvis] outreach stats failed:", sanitizeLogString(err));
  }
  return stats;
}

async function funnel(days: number) {
  const [r] = (await sql().query(
    `WITH pv AS (
       SELECT visitor_id, BOOL_OR(path ~ '^/(pricing|upgrade)([/?]|$)') AS pricing
       FROM page_views
       WHERE created_at > NOW() - make_interval(days => $1) AND visitor_id IS NOT NULL AND path NOT LIKE '/admin%' AND ${human()}
       GROUP BY visitor_id
     ), fe AS (
       SELECT visitor_id,
              BOOL_OR(event_name = 'radar_scan_start') AS searched,
              BOOL_OR(event_name IN ('radar_scan_signed_in_matches', 'radar_scan_anonymous_matches')) AS matched,
              BOOL_OR(event_name = ANY($2::text[])) AS saw_signup,
              BOOL_OR(event_name = 'signup_success') AS signed_up,
              BOOL_OR(event_name LIKE '%upgrade_click%' OR event_name LIKE '%checkout_started%') AS clicked_buy
       FROM funnel_events
       WHERE created_at > NOW() - make_interval(days => $1) AND visitor_id IS NOT NULL AND ${human()}
       GROUP BY visitor_id
     )
     SELECT COUNT(*)::int AS visited,
            COUNT(*) FILTER (WHERE fe.searched)::int AS searched,
            COUNT(*) FILTER (WHERE fe.matched)::int AS search_found_bids,
            COUNT(*) FILTER (WHERE fe.saw_signup)::int AS saw_signup,
            COUNT(*) FILTER (WHERE fe.signed_up)::int AS signed_up,
            COUNT(*) FILTER (WHERE pv.pricing)::int AS saw_pricing,
            COUNT(*) FILTER (WHERE fe.clicked_buy)::int AS clicked_buy
     FROM pv LEFT JOIN fe ON fe.visitor_id = pv.visitor_id`,
    [days, [...SIGNUP_VIEWED_EVENTS]],
  )) as Record<string, number>[];
  return Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, Number(v)])) as Record<string, number>;
}

/** Read-only lookups the model may call. Each returns plain JSON. */
export async function runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const db = sql();
  const days = clampDays(args.days);
  const visitorWhere = `created_at > NOW() - make_interval(days => $1) AND visitor_id IS NOT NULL AND path NOT LIKE '/admin%' AND ${human()}`;
  switch (name) {
    case "visitors_by_day":
      return db.query(
        `SELECT to_char((created_at AT TIME ZONE '${ET}')::date, 'Dy Mon DD') AS day,
                COUNT(DISTINCT visitor_id)::int AS visitors,
                COUNT(DISTINCT visitor_id) FILTER (WHERE ${PAID})::int AS from_paid_ads
         FROM page_views WHERE ${visitorWhere}
         GROUP BY (created_at AT TIME ZONE '${ET}')::date ORDER BY (created_at AT TIME ZONE '${ET}')::date`,
        [days],
      );
    case "traffic_sources":
      return db.query(
        `SELECT COALESCE(NULLIF(source, ''), NULLIF(split_part(regexp_replace(COALESCE(referrer, ''), '^https?://(www\\.)?', ''), '/', 1), ''), 'direct') AS source,
                COALESCE(NULLIF(medium, ''), '-') AS medium,
                COUNT(DISTINCT visitor_id)::int AS visitors
         FROM page_views WHERE ${visitorWhere}
         GROUP BY 1, 2 ORDER BY visitors DESC LIMIT 15`,
        [days],
      );
    case "top_pages":
      return db.query(
        `SELECT split_part(path, '?', 1) AS page, COUNT(*)::int AS views, COUNT(DISTINCT visitor_id)::int AS visitors
         FROM page_views WHERE ${visitorWhere}
         GROUP BY 1 ORDER BY visitors DESC LIMIT 15`,
        [days],
      );
    case "visitor_locations":
      return db.query(
        `SELECT COALESCE(NULLIF(city, ''), '?') AS city, COALESCE(NULLIF(region, ''), '?') AS region, COUNT(DISTINCT visitor_id)::int AS visitors
         FROM page_views WHERE ${visitorWhere}
         GROUP BY 1, 2 ORDER BY visitors DESC LIMIT 15`,
        [days],
      );
    case "funnel":
      return funnel(days);
    case "top_searches":
      return db.query(
        `SELECT trade, state, COUNT(*)::int AS searches, ROUND(AVG(matched))::int AS avg_bids_found,
                COUNT(*) FILTER (WHERE matched = 0)::int AS found_nothing
         FROM radar_search_log WHERE created_at > NOW() - make_interval(days => $1)
         GROUP BY 1, 2 ORDER BY searches DESC LIMIT 15`,
        [days],
      );
    case "recent_signups":
      return db.query(
        `SELECT split_part(email, '@', 1) AS who, to_char(created_at AT TIME ZONE '${ET}', 'Dy Mon DD HH12:MI AM') AS joined,
                plan_tier, COALESCE(subscription_status, 'none') AS subscription, trial_started_at IS NOT NULL AS started_trial
         FROM users WHERE ${qaExternalUserSQL()} AND created_at > NOW() - make_interval(days => $1)
         ORDER BY created_at DESC LIMIT 20`,
        [days],
      );
    case "bid_details": {
      const id = Math.round(Number(args.id));
      if (!Number.isFinite(id) || id <= 0) return { error: "a bid id is required" };
      const [b] = (await db.query(
        `SELECT id, title, agency, location, normalized_state AS state, category, to_char(due_date, 'Dy Mon DD YYYY') AS due,
                estimated_value, LEFT(regexp_replace(COALESCE(description, ''), '\\s+', ' ', 'g'), 600) AS description
         FROM bids WHERE id = $1`,
        [id],
      )) as Record<string, unknown>[];
      return b ?? { error: "no bid with that id" };
    }
    case "visitor_journey": {
      const vid = String(args.vid ?? "").slice(0, 64);
      if (!vid) return { error: "vid is required" };
      const pages = await db.query(
        `SELECT to_char(created_at AT TIME ZONE '${ET}', 'Dy HH12:MI AM') AS at, path,
                NULLIF(COALESCE(NULLIF(source, ''), split_part(regexp_replace(COALESCE(referrer, ''), '^https?://(www\\.)?', ''), '/', 1)), '') AS came_from,
                device_type AS device, city, region
         FROM page_views WHERE visitor_id = $1 AND created_at > NOW() - INTERVAL '7 days' AND path NOT LIKE '/admin%'
         ORDER BY created_at ASC LIMIT 60`,
        [vid],
      );
      const searches = await db.query(
        `SELECT to_char(created_at AT TIME ZONE '${ET}', 'Dy HH12:MI AM') AS at, trade, state, matched
         FROM radar_search_log WHERE visitor_id = $1 AND created_at > NOW() - INTERVAL '7 days' ORDER BY created_at ASC LIMIT 20`,
        [vid],
      );
      return { pages, searches };
    }
    case "open_bids": {
      const keyword = String(args.keyword ?? "").trim().slice(0, 60);
      const state = String(args.state ?? "").trim().toUpperCase().slice(0, 2);
      if (!keyword) return { error: "keyword is required" };
      const where = `due_date > NOW() AND title ILIKE '%' || $1 || '%' AND ($2 = '' OR normalized_state = $2) AND ${LOW_CONTENT_SQL} AND ${AWARD_EXCLUSION_SQL}`;
      const [c] = (await db.query(`SELECT COUNT(*)::int AS n FROM bids WHERE ${where}`, [keyword, state])) as { n: number }[];
      const soonest = await db.query(
        `SELECT title, agency, normalized_state AS state, to_char(due_date, 'Mon DD') AS due FROM bids WHERE ${where} ORDER BY due_date ASC LIMIT 5`,
        [keyword, state],
      );
      return { open: Number(c?.n ?? 0), soonest_due: soonest };
    }
    case "simulate":
      return simulateFunnel(await simBaseline(), args);
    default:
      return { error: `unknown tool ${name}` };
  }
}

interface ChatMsg {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

async function chat(model: string, messages: ChatMsg[]) {
  const res = await fetchOpenAIWithRetry(OPENAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages, tools: JARVIS_TOOLS, temperature: 0.4, max_tokens: 500, response_format: { type: "json_object" } }),
  });
  if (!res.ok) {
    const err = new Error(`OpenAI ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const j = (await res.json()) as { choices?: { message?: ChatMsg }[] };
  const msg = j.choices?.[0]?.message;
  if (!msg) throw new Error("OpenAI returned no message");
  return msg;
}

/** The model's final text, and the last simulation it ran (shown on screen). */
async function answer(model: string, messages: ChatMsg[]): Promise<{ raw: string; sim: SimResult | null }> {
  let sim: SimResult | null = null;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const msg = await chat(model, messages);
    if (!msg.tool_calls?.length || round === MAX_TOOL_ROUNDS) return { raw: msg.content ?? "", sim };
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      let result: unknown;
      try {
        result = await runTool(call.function.name, JSON.parse(call.function.arguments || "{}"));
        if (call.function.name === "simulate") sim = result as SimResult;
      } catch (err) {
        console.error(`[jarvis] tool ${call.function.name} failed:`, sanitizeLogString(err));
        result = { error: "lookup failed" };
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  return { raw: "", sim };
}


/** The last 30 days of the funnel, for "what if" projections. */
async function simBaseline(): Promise<SimBaseline> {
  const days = 30;
  const f = await funnel(days);
  const [p] = (await sql().query(
    `SELECT COUNT(DISTINCT visitor_id)::int AS paid FROM page_views
     WHERE created_at > NOW() - make_interval(days => $1) AND visitor_id IS NOT NULL AND path NOT LIKE '/admin%' AND ${human()} AND ${PAID}`,
    [days],
  )) as { paid: number }[];
  const [a] = (await sql().query(
    `SELECT COUNT(*)::int AS accounts, COUNT(*) FILTER (WHERE subscription_status = 'active')::int AS paying FROM users WHERE ${qaExternalUserSQL()}`,
  )) as { accounts: number; paying: number }[];
  return {
    days,
    visitors: f.visited ?? 0,
    paidVisitors: Number(p?.paid ?? 0),
    searched: f.searched ?? 0,
    signedUp: f.signed_up ?? 0,
    accounts: Number(a?.accounts ?? 0),
    paying: Number(a?.paying ?? 0),
  };
}

/** What a display shows: the server's own lookup, never the model's numbers. */
export interface JarvisDisplay {
  kind: JarvisVisual | "simulation";
  days: number;
  rows: unknown;
}

const SORRY = "My apologies, sir. I couldn't reach my thinking circuits just now. Try me again in a moment.";

/** One question in, Jarvis's reply (and a display for the console) out. */
export async function askJarvis(input: { question: string; snapshot: unknown; history: unknown }): Promise<JarvisReply & { visual?: JarvisDisplay }> {
  const question = input.question.trim().slice(0, MAX_QUESTION_CHARS);
  const snapshot = (input.snapshot && typeof input.snapshot === "object" ? input.snapshot : {}) as JarvisSnapshot;
  const online = Array.isArray(snapshot.online) ? snapshot.online.slice(0, 20) : [];
  const safe: JarvisSnapshot = {
    onlineCount: Number(snapshot.onlineCount) || 0,
    online,
    feed: Array.isArray(snapshot.feed) ? snapshot.feed.slice(0, 25) : [],
    trials: Array.isArray(snapshot.trials) ? snapshot.trials.slice(0, 15) : [],
    money: snapshot.money ?? null,
  };
  const messages: ChatMsg[] = [
    { role: "system", content: jarvisPrompt(safe, await serverStats()) },
    ...sanitizeHistory(input.history),
    { role: "user", content: question },
  ];
  let out: { raw: string; sim: SimResult | null };
  try {
    out = await answer(SMART_MODEL, [...messages]);
  } catch (err) {
    // An unknown or unavailable model id: answer with the site's default model.
    const status = (err as { status?: number }).status;
    if (status !== 400 && status !== 404) {
      console.error("[jarvis] failed:", sanitizeLogString(err));
      return { say: SORRY, action: null };
    }
    console.error(`[jarvis] ${SMART_MODEL} unavailable, falling back:`, sanitizeLogString(err));
    out = await answer(FALLBACK_MODEL, [...messages]).catch(() => ({ raw: "", sim: null }));
  }
  const reply = parseJarvisReply(out.raw, new Set(online.map((v) => String(v.vid))));
  // "Run a simulation" (owner 2026-10-23): the projection goes up on screen.
  if (out.sim) return { say: reply.say, action: null, visual: { kind: "simulation", days: 30, rows: out.sim } };
  // "Show me…" (owner 2026-10-23): the display's numbers come from the same
  // read-only lookups, never from the model.
  if (reply.action?.type === "show" && reply.action.visual !== "map") {
    try {
      const rows = await runTool(VISUAL_TOOL[reply.action.visual], { days: reply.action.days });
      return { ...reply, visual: { kind: reply.action.visual, days: reply.action.days, rows } };
    } catch (err) {
      console.error("[jarvis] display data failed:", sanitizeLogString(err));
      return { say: "My apologies, sir, I couldn't pull that display together just now.", action: null };
    }
  }
  return reply;
}

const TTS_URL = "https://api.openai.com/v1/audio/speech";
/** A British-sounding voice; JARVIS_VOICE picks another (alloy, ash, echo, onyx, sage…). */
const TTS_VOICE = process.env.JARVIS_VOICE || "fable";
const TTS_STYLE =
  "Voice: a refined British AI butler, like J.A.R.V.I.S. from Iron Man. Calm, warm, quietly confident, crisp diction, a hint of dry humour. Measured pace, never rushed.";
export const MAX_TTS_CHARS = 800;

/**
 * Jarvis's real voice (owner 2026-10-23, "1,2,5"): OpenAI text-to-speech, MP3.
 * Falls back to tts-1 when the newer model is unavailable. null on failure, so
 * the page can fall back to the browser's own voice.
 */
export async function jarvisSpeech(text: string, voice: { voice?: string; style?: string } = {}): Promise<ArrayBuffer | null> {
  return (await speechWithStatus(text, voice)).audio;
}

/**
 * Speech plus why it failed (owner 2026-10-25: "max sounds too robotic" — the
 * AI voice was failing and the page fell back to the browser's voice). Tries
 * gpt-4o-mini-tts, then tts-1 on ANY failure (not only 400/404: a project
 * without access to the newer model answers 401/403). `status` is OpenAI's
 * last HTTP status (0 = network error), never its message.
 */
export async function speechWithStatus(
  text: string,
  voice: { voice?: string; style?: string } = {},
): Promise<{ audio: ArrayBuffer | null; status: number | null }> {
  const input = text.trim().slice(0, MAX_TTS_CHARS);
  if (!input || !process.env.OPENAI_API_KEY) return { audio: null, status: null };
  const call = (body: Record<string, unknown>) =>
    fetchOpenAIWithRetry(TTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ input, voice: voice.voice ?? TTS_VOICE, response_format: "mp3", ...body }),
    });
  let status = 0;
  for (const body of [{ model: "gpt-4o-mini-tts", instructions: voice.style ?? TTS_STYLE }, { model: "tts-1" }]) {
    try {
      const res = await call(body);
      if (res.ok) return { audio: await res.arrayBuffer(), status: res.status };
      status = res.status;
      console.error(`[jarvis] speech ${body.model} ${res.status}:`, sanitizeLogString((await res.text().catch(() => "")).slice(0, 200)));
    } catch (err) {
      status = 0;
      console.error(`[jarvis] speech ${body.model} failed:`, sanitizeLogString(err));
    }
  }
  return { audio: null, status };
}
