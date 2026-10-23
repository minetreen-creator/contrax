/**
 * Jarvis (owner 2026-10-23: "I could use an assistant"): a voice assistant on
 * Mission Control. The owner asks out loud ("Jarvis, how many visitors
 * today?"), /api/admin/jarvis answers from the console's live data plus a few
 * server-side numbers, and the page speaks the answer. It can also act: open
 * the chat with a visitor on the site now, or open an admin page.
 *
 * PURE: the snapshot shape, the prompt, wake-word handling and reply parsing.
 */

/** Admin pages Jarvis may open, by the words the owner would use. */
export const JARVIS_PAGES: Record<string, string> = {
  "/admin/outreach": "outreach emails waiting for approval",
  "/admin/signups": "signups",
  "/admin/customers": "customers",
  "/admin/payments": "payments",
  "/admin/journeys": "visitor journeys",
  "/admin/radar-leads": "radar leads",
  "/admin/bid-scout": "Bid Scout orders",
  "/admin/live": "Mission Control",
};

export interface JarvisVisitor {
  vid: string;
  place: string | null;
  page: string;
  score: number;
  level: string;
  reasons: string[];
}

/** What the page already shows, sent with each question. */
export interface JarvisSnapshot {
  onlineCount: number;
  online: JarvisVisitor[];
  feed: { kind: string; title: string; place: string | null; detail: string | null; minutesAgo: number }[];
  trials: { who: string; hoursLeft: number; heat: string; trade: string | null; visits7d: number }[];
  money: { payingNow: number; sawPlans: number; clickedBuy: number; openedCheckout: number } | null;
}

/** Numbers only the server can count. */
export interface JarvisServerStats {
  /** Eastern time, e.g. "Friday, October 23, 11:42 AM". */
  now: string;
  visitorsToday: number | null;
  visitorsYesterday: number | null;
  week: { visitors: number; searches: number; signups: number; newAccounts: number; trialsStarted: number; payingNow: number } | null;
  outreach: { waiting: number; sentToday: number; sentFirst: number; sentFollowup: number; unsubscribed: number } | null;
}

export type JarvisAction = { type: "chat"; vid: string } | { type: "open"; path: string };

export interface JarvisReply {
  say: string;
  action: JarvisAction | null;
}

export const MAX_QUESTION_CHARS = 300;
const MAX_SAY_CHARS = 700;
/** Lookups per question before Jarvis must answer. */
export const MAX_TOOL_ROUNDS = 4;
/** Earlier turns kept so follow-ups ("and yesterday?") make sense. */
export const MAX_HISTORY_TURNS = 8;

/** Days back for a lookup: 1 to 90, default 7. */
export function clampDays(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(90, n) : 7;
}

/** The conversation so far, as sent by the page: only user/assistant text, trimmed. */
export function sanitizeHistory(v: unknown): { role: "user" | "assistant"; content: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((m): m is { role: string; content: string } => !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 700) }));
}

const daysParam = { type: "object", properties: { days: { type: "integer", description: "How many days back, 1-90 (default 7)" } } };

/** Read-only lookups Jarvis can run (OpenAI function calling); see /api/admin/jarvis. */
export const JARVIS_TOOLS = [
  ["visitors_by_day", "Unique real visitors per day (Eastern time), and how many came from paid ads.", daysParam],
  ["traffic_sources", "Where visitors came from: source/referrer and medium, by unique visitors.", daysParam],
  ["top_pages", "Most visited pages, by unique visitors and views.", daysParam],
  ["visitor_locations", "Cities and states visitors are in.", daysParam],
  ["funnel", "The funnel: visited, searched, search found bids, saw signup, signed up, saw pricing, clicked buy.", daysParam],
  ["top_searches", "What people searched on Contract Radar (trade + state), with bids found and searches that found nothing.", daysParam],
  ["recent_signups", "New accounts: who (email name only), when, plan, subscription, trial.", daysParam],
  [
    "open_bids",
    "Open bids in the Contrax database whose title contains a keyword, optionally in one state: the count and the 5 due soonest.",
    {
      type: "object",
      properties: { keyword: { type: "string", description: "Word to find in bid titles, e.g. janitorial" }, state: { type: "string", description: "Two-letter state, e.g. VA (optional)" } },
      required: ["keyword"],
    },
  ],
].map(([name, description, parameters]) => ({ type: "function" as const, function: { name: name as string, description: description as string, parameters } }));

const WAKE = /\b(?:hey\s+|ok\s+|okay\s+)?(?:jarvis|jervis|jarvas|travis)\b[\s,.:!?-]*/i;

/**
 * In always-listening mode: the question after the wake word, "" when the
 * wake word was said alone, null when it wasn't said.
 */
export function afterWakeWord(transcript: string): string | null {
  const m = WAKE.exec(transcript);
  if (!m) return null;
  return transcript.slice(m.index + m[0].length).trim();
}

/** The system prompt: who Jarvis is, the data, and the reply format. */
export function jarvisPrompt(snapshot: JarvisSnapshot, stats: JarvisServerStats): string {
  return [
    "You are Jarvis, the voice assistant for Nathaniel Minetree, owner and CEO of Contrax (contrax.company), a site that helps small businesses find government bids.",
    "You speak like J.A.R.V.I.S.: calm, warm, concise, a little dry wit, and you call him \"sir\" now and then. Your words are read aloud, so: no markdown, no lists, no URLs, no emoji; spell numbers naturally; two to four short sentences unless he asks for detail.",
    "Be genuinely useful: answer the question, then add the one insight or next step that matters (a trend, a drop, a lead worth chasing). Compare to yesterday or last week when it helps.",
    "Use the data below first. When it isn't enough, call the lookup tools (you may call several) before answering. If nothing covers the question, say so plainly. Never invent numbers, names or events.",
    "",
    "Reply with a JSON object: {\"say\": string, \"action\": null | {\"type\": \"chat\", \"vid\": string} | {\"type\": \"open\", \"path\": string}}.",
    "Use a chat action only when he asks to message, greet or say hi to a visitor; pick the vid of a visitor in ONLINE NOW (hottest first if he doesn't say which). Use an open action only when he asks to open, show or go to one of these pages: " +
      Object.entries(JARVIS_PAGES)
        .map(([p, w]) => `${p} (${w})`)
        .join(", ") +
      ".",
    "",
    `NOW: ${stats.now} (Eastern).`,
    `VISITORS: today ${stats.visitorsToday ?? "unknown"}, yesterday ${stats.visitorsYesterday ?? "unknown"} (unique real visitors; bots, admins and test accounts excluded).`,
    `LAST 7 DAYS: ${stats.week ? JSON.stringify(stats.week) : "unavailable"}.`,
    `OUTREACH EMAILS: ${stats.outreach ? JSON.stringify(stats.outreach) : "unavailable"} (waiting = drafts he still has to approve and send).`,
    `ONLINE NOW (${snapshot.onlineCount} on the site; lead score 0-100, hot = 60+): ${JSON.stringify(snapshot.online)}.`,
    `ACTIVITY, LAST 48 HOURS (newest first): ${JSON.stringify(snapshot.feed)}.`,
    `TRIALS RUNNING: ${JSON.stringify(snapshot.trials)}.`,
    `MONEY, LAST 7 DAYS: ${snapshot.money ? JSON.stringify(snapshot.money) : "unavailable"}.`,
  ].join("\n");
}

/** Parse the model's JSON, keeping only actions that point at real things. */
export function parseJarvisReply(raw: string, onlineVids: Set<string>): JarvisReply {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { say: raw.trim().slice(0, MAX_SAY_CHARS) || "Sorry, sir, I lost my train of thought.", action: null };
  }
  const o = (obj && typeof obj === "object" ? obj : {}) as { say?: unknown; action?: unknown };
  const say = typeof o.say === "string" && o.say.trim() ? o.say.trim().slice(0, MAX_SAY_CHARS) : "Sorry, sir, I lost my train of thought.";
  const a = (o.action && typeof o.action === "object" ? o.action : null) as { type?: unknown; vid?: unknown; path?: unknown } | null;
  let action: JarvisAction | null = null;
  if (a?.type === "chat" && typeof a.vid === "string" && onlineVids.has(a.vid)) action = { type: "chat", vid: a.vid };
  if (a?.type === "open" && typeof a.path === "string" && a.path in JARVIS_PAGES) action = { type: "open", path: a.path };
  return { say, action };
}
