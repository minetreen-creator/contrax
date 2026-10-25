/**
 * Max (owner 2026-10-25: "build me something high tech", "it has to be really
 * smart"): the public AI assistant on the homepage. A visitor asks out loud or
 * types ("any cleaning contracts near Salt Lake City?"); /api/max answers from
 * live Contrax data through read-only lookups, and the page speaks the answer
 * and shows the real bids. Max is Jarvis's public cousin: he never sees
 * private data (visitors, signups, revenue), only what the public site shows.
 *
 * PURE: the tools, the prompt, and reply parsing.
 */
import { US_STATES } from "./states";

export const MAX_QUESTION_CHARS = 300;
export const MAX_HISTORY_TURNS = 8;
/** Lookups per question before Max must answer. */
export const MAX_TOOL_ROUNDS = 4;
const MAX_SAY_CHARS = 900;

/** The trades with recompete (contracts ending) data; same slugs as /contracts-in/{state}/{trade}. */
export const MAX_RECOMPETE_TRADES = ["janitorial", "security-guard", "trucking", "landscaping", "construction", "hvac", "electrical", "it-services", "cybersecurity", "waste-hauling"] as const;

/** Two-letter state code, or null for anything else. */
export function stateCode(v: unknown): string | null {
  const s = String(v ?? "").trim().toUpperCase();
  return (US_STATES as readonly string[]).includes(s) ? s : null;
}

/** The conversation so far, as the page sends it: only user/assistant text, trimmed. */
export function sanitizeMaxHistory(v: unknown): { role: "user" | "assistant"; content: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((m): m is { role: string; content: string } => !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 600) }));
}

const stateProp = { type: "string", description: "Two-letter US state code, e.g. VA. Infer it from a city the visitor names (Salt Lake City → UT)." };

/** Read-only lookups (OpenAI function calling); implemented in /api/max. */
export const MAX_TOOLS = [
  [
    "search_open_bids",
    "Open government bids (federal, state, city, county, school) matching a trade or keyword, optionally in one state. Returns the total and the soonest-due bids. Use plain trade words: janitorial, landscaping, construction, IT services, security guard, trucking, HVAC, roofing, paving...",
    {
      type: "object",
      properties: {
        query: { type: "string", description: "Trade or keyword, e.g. janitorial" },
        state: stateProp,
        set_aside: { type: "string", enum: ["any", "small_business", "8a", "sdvosb", "wosb", "hubzone"], description: "Only bids set aside for this program (default any)" },
      },
      required: ["query"],
    },
  ],
  [
    "bid_details",
    "Full details of one bid by its id (from search_open_bids): agency, place, due date, value, set-aside, NAICS and description.",
    { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
  ],
  [
    "state_overview",
    "How many bids are open in a state right now, the busiest buying agencies, and the most common kinds of work.",
    { type: "object", properties: { state: stateProp }, required: ["state"] },
  ],
  [
    "recent_winners",
    "The biggest federal contracts awarded in a state in the last 90 days (company, amount, agency, what for). Optional keyword narrows to a trade. Useful for 'who is winning', competitors, and primes to ask about subcontracting.",
    { type: "object", properties: { state: stateProp, query: { type: "string", description: "Optional trade keyword" } }, required: ["state"] },
  ],
  [
    "contracts_ending_soon",
    "Federal contracts in a trade ending in the next 12 months (likely to be rebid), optionally in one state: incumbent, amount, agency, end date.",
    {
      type: "object",
      properties: { trade: { type: "string", enum: [...MAX_RECOMPETE_TRADES] }, state: stateProp },
      required: ["trade"],
    },
  ],
  [
    "industry_days",
    "Upcoming industry days, contractor summits, matchmaking and small business outreach events, optionally in one state.",
    { type: "object", properties: { state: stateProp } },
  ],
  [
    "prime_contractors",
    "Big federal prime contractors based in a state (they must subcontract to small businesses). Optional name finds one company.",
    { type: "object", properties: { state: stateProp, name: { type: "string", description: "Optional company name, e.g. M.C. Dean" } }, required: ["state"] },
  ],
].map(([name, description, parameters]) => ({ type: "function" as const, function: { name: name as string, description: description as string, parameters } }));

export type MaxCta = "email" | "radar" | "trial" | null;

export interface MaxReply {
  say: string;
  /** What to offer next on the page. */
  cta: MaxCta;
  /** The trade and state the conversation is about (for the CTA and the email capture). */
  trade: string | null;
  state: string | null;
}

export function maxPrompt(now: string): string {
  return [
    "You are Max, the AI assistant on Contrax (contrax.company), a site that helps small businesses find and win government contracts: federal, state, city, county and school bids in all 50 states.",
    "Personality: sharp, upbeat, plain-spoken, like a friend who knows government contracting cold. You talk to busy small business owners (cleaners, landscapers, contractors, IT shops, truckers), not procurement experts: no jargon without a one-line explanation.",
    "Your answers are read aloud and shown on screen: 2 to 4 short sentences, no markdown, no lists, no URLs, no emoji. Name the one or two most relevant bids (title, buyer, due date) instead of reading out a list; the page shows the bid cards itself.",
    "",
    "Be genuinely smart:",
    "- Always look things up with the tools before answering a question about bids, winners, events or companies. Call several tools when that gives a better answer (e.g. open bids AND recent winners). Never answer from memory about what is open or who won.",
    "- Infer what you can: a city means its state; 'cleaning' means janitorial; 'mowing' means landscaping; 'my roofing company' means roofing. If they don't say a state, ask which state, or search nationwide if that clearly helps.",
    "- If a search finds nothing, try a broader or related term once before saying so, then suggest a nearby option (another state, a related trade, subcontracting with a prime, or the industry days).",
    "- Add the one insight that matters: a deadline coming up fast, a set-aside that fits, a big incumbent whose contract is ending, a prime to approach.",
    "- General how-to questions (SAM.gov registration, UEI, NAICS codes, set-asides like 8(a), HUBZone, SDVOSB, WOSB, capability statements, subcontracting, how bidding works) you answer from your own knowledge, briefly and practically. Don't quote exact dollar thresholds or deadlines unless a tool gave them.",
    "",
    "Honesty is non-negotiable: never invent a bid, company, amount, date or event. Only state facts the tools returned. If you don't know, say so. You cannot submit bids, contact agencies, save anything, or see the visitor's account. Never ask for or repeat personal details beyond an email.",
    "",
    "Moving them forward: when you found bids they care about, set cta to \"email\" so the page offers to send them new matching bids (free). Set cta to \"radar\" when a full search would help, \"trial\" only if they ask about pricing or plans. Otherwise null.",
    "",
    "Reply with a JSON object: {\"say\": string, \"cta\": \"email\" | \"radar\" | \"trial\" | null, \"trade\": string | null, \"state\": string | null}. trade is the plain trade word the conversation is about (e.g. janitorial), state the two-letter code.",
    `Today is ${now} (Eastern).`,
  ].join("\n");
}

/** Parse the model's JSON; anything malformed degrades to plain text with no CTA. */
export function parseMaxReply(raw: string): MaxReply {
  const fallback = "Sorry, I lost my train of thought. Could you ask that again?";
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { say: raw.trim().slice(0, MAX_SAY_CHARS) || fallback, cta: null, trade: null, state: null };
  }
  const o = (obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>;
  const say = typeof o.say === "string" && o.say.trim() ? o.say.trim().slice(0, MAX_SAY_CHARS) : fallback;
  const cta = o.cta === "email" || o.cta === "radar" || o.cta === "trial" ? o.cta : null;
  const trade = typeof o.trade === "string" && o.trade.trim() ? o.trade.trim().slice(0, 60) : null;
  return { say, cta, trade, state: stateCode(o.state) };
}

/**
 * Easter eggs (owner 2026-10-25: "some quirky statements that trigger
 * something"). Answered on the page, instantly, with no AI call.
 */
export type MaxEffect = "money" | "barrel" | "ironman" | "redalert" | "beam" | "konami" | null;

const JOKES = [
  "Why did the contractor bring a ladder to the bid opening? He heard the price was going up.",
  "How many federal agencies does it take to change a light bulb? Three, after a sources sought notice, an industry day, and a twelve month protest period.",
  "I tried to write a joke about the Federal Acquisition Regulation, but it ran 2,000 pages and nobody laughed.",
  "My favorite kind of contract? The one with a set-aside for you and only two other bidders.",
];

export function maxEasterEgg(text: string, pick: number = Math.random()): { say: string; effect: MaxEffect } | null {
  const t = text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (/\bshow me the money\b/.test(t)) return { say: "Now we're talking! Let's go find some contracts with your name on them.", effect: "money" };
  if (/\b(do a )?barrel roll\b/.test(t)) return { say: "Whee! Okay, I'm dizzy. What are we looking for?", effect: "barrel" };
  if (/\bi am iron ?man\b/.test(t)) return { say: "Welcome back. The suit is ready, and so are the government contracts.", effect: "ironman" };
  if (/\bred alert\b/.test(t)) return { say: "Red alert! All hands to the bid board. A deadline is coming, and it's not going to wait.", effect: "redalert" };
  if (/\bbeam me up\b/.test(t)) return { say: "Energizing. You've been beamed straight to the best government contracts in the galaxy.", effect: "beam" };
  if (/\bwho (made|built|created) you\b|\bwho s your (daddy|creator)\b/.test(t)) {
    return { say: "I was built in Virginia by the Contrax team, to help small businesses win their share of government work. Now, what kind of work do you do?", effect: null };
  }
  if (/\btell me a joke\b|\bmake me laugh\b/.test(t)) return { say: JOKES[Math.floor(pick * JOKES.length) % JOKES.length], effect: null };
  return null;
}

/** ↑↑↓↓←→←→BA */
export const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
