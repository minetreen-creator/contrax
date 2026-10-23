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
  /** The page's path, e.g. /bid/737788 (the bid id is in it). */
  path?: string;
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

/**
 * "Jarvis, show me…" hologram displays (owner 2026-10-23, "do 2,3"). Each maps
 * to a lookup the server already runs (map uses what Mission Control shows).
 */
export const JARVIS_VISUALS = {
  map: "where visitors are right now and where searches come from (US map)",
  funnel: "the funnel: visited, searched, found bids, saw signup, signed up, saw pricing, clicked buy",
  traffic: "visitors per day",
  sources: "where visitors come from (sources)",
  pages: "the most visited pages",
  searches: "what people search for (trade + state)",
} as const;
export type JarvisVisual = keyof typeof JARVIS_VISUALS;

export type JarvisAction =
  | { type: "chat"; vid: string }
  | { type: "open"; path: string }
  | { type: "show"; visual: JarvisVisual; days: number };

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
    "bid_details",
    "One bid by its id (the number in a /bid/123 path): title, buyer, location, category, due date, value and a short description.",
    { type: "object", properties: { id: { type: "integer", description: "The bid id" } }, required: ["id"] },
  ],
  [
    "visitor_journey",
    "Everything one visitor did in the last 7 days: each page with time (Eastern), where they came from, device, and their searches. Use the vid from ONLINE NOW.",
    { type: "object", properties: { vid: { type: "string", description: "The visitor's vid" } }, required: ["vid"] },
  ],
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
    "Use the data below first. When it isn't enough, call the lookup tools (you may call several) before answering: for a visitor's bid page, read the id from their path and call bid_details; for what someone has been doing, call visitor_journey. Don't offer to dig further — dig, then answer. If nothing covers the question, say so plainly. Never invent numbers, names or events.",
    "",
    "Reply with a JSON object: {\"say\": string, \"action\": null | {\"type\": \"chat\", \"vid\": string} | {\"type\": \"open\", \"path\": string} | {\"type\": \"show\", \"visual\": string, \"days\": number}}.",
    "When he asks to show, display, put up, visualize or see a chart of something, use a show action with the closest visual (" +
      Object.entries(JARVIS_VISUALS)
        .map(([k, w]) => `${k}: ${w}`)
        .join("; ") +
      ") and days 1-90 (default 7). Then \"say\" is one short line introducing the display (\"Here is your funnel for the week, sir.\"); the display shows the numbers.",
    "Your ONLY abilities are: reading this data, the lookup tools, opening a visitor chat, opening an admin page, and showing a display. You cannot save notes, remember anything after this conversation, send emails or messages, contact anyone, or change the site. Never say you will do, note, log, flag or pass along something you can't; if he asks for that, say plainly you can't and suggest what he can do instead (for example, write it down or ask Claude to build it).",
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
  const a = (o.action && typeof o.action === "object" ? o.action : null) as { type?: unknown; vid?: unknown; path?: unknown; visual?: unknown; days?: unknown } | null;
  let action: JarvisAction | null = null;
  if (a?.type === "chat" && typeof a.vid === "string" && onlineVids.has(a.vid)) action = { type: "chat", vid: a.vid };
  if (a?.type === "open" && typeof a.path === "string" && a.path in JARVIS_PAGES) action = { type: "open", path: a.path };
  if (a?.type === "show" && typeof a.visual === "string" && a.visual in JARVIS_VISUALS) {
    action = { type: "show", visual: a.visual as JarvisVisual, days: clampDays(a.days) };
  }
  return { say, action };
}

/** The lookup each "show me" display draws from (map uses the page's own data). */
export const VISUAL_TOOL: Record<Exclude<JarvisVisual, "map">, string> = {
  funnel: "funnel",
  traffic: "visitors_by_day",
  sources: "traffic_sources",
  pages: "top_pages",
  searches: "top_searches",
};

/** "Jarvis, wake up" (owner 2026-10-23): the phrases that start the boot sequence. */
export function isWakePhrase(text: string): boolean {
  return /\b(wake up|boot up|start ?up|power up|systems? (on|online)|good morning)\b/i.test(text);
}

/**
 * The boot sequence's status lines and the summary Jarvis speaks, from the
 * numbers the page already has plus the server's counts. PURE.
 */
export function bootReport(stats: JarvisServerStats, snap: Pick<JarvisSnapshot, "onlineCount" | "online" | "trials">): { lines: string[]; spoken: string } {
  const n = (v: number | null | undefined) => (v === null || v === undefined ? "unknown" : String(v));
  const hot = snap.online.filter((v) => v.level === "hot").length;
  const waiting = stats.outreach?.waiting ?? null;
  const hour = Number(/(\d+):\d+\s*(AM|PM)/i.exec(stats.now)?.[1] ?? 9) % 12 + (/PM/i.test(stats.now) ? 12 : 0);
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const lines = [
    "Initializing J.A.R.V.I.S.",
    "Neural link: online",
    "Contrax website: online",
    `Visitors today: ${n(stats.visitorsToday)} (yesterday ${n(stats.visitorsYesterday)})`,
    `On the site now: ${snap.onlineCount}${hot ? ` (${hot} hot)` : ""}`,
    `Trials running: ${snap.trials.length}`,
    `Paying customers: ${n(stats.week?.payingNow)}`,
    `Outreach emails awaiting approval: ${n(waiting)}`,
    "All systems nominal",
  ];
  const parts = [
    `${greeting}, sir. All systems are online.`,
    stats.visitorsToday !== null ? `${stats.visitorsToday} visitor${stats.visitorsToday === 1 ? "" : "s"} so far today${stats.visitorsYesterday !== null ? `, against ${stats.visitorsYesterday} yesterday` : ""}.` : "",
    snap.onlineCount ? `${snap.onlineCount} on the site right now${hot ? `, ${hot} of them hot` : ""}.` : "Nobody on the site at the moment.",
    waiting ? `${waiting} outreach email${waiting === 1 ? " is" : "s are"} awaiting your approval.` : "",
  ];
  return { lines, spoken: parts.filter(Boolean).join(" ") };
}
