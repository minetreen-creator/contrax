/**
 * Max (owner 2026-10-25: "build me something high tech", "it has to be really
 * smart"): the public AI assistant on the homepage. A visitor asks out loud or
 * types ("any cleaning contracts near Salt Lake City?"); /api/max answers from
 * live Contrax data through read-only lookups, and the page speaks the answer
 * and shows the real bids. Max is Jarvis's public cousin: he never sees
 * private data (visitors, signups, revenue), only what the public site shows.
 *
 * Owner 2026-10-25 "1,2,5,7": best-fit scoring, the bid explainer, deadline
 * reminders, and Spanish. Owner 2026-10-25 "1,3" + "and 4": Max on every bid
 * page, Max's pick of the day, and the capability statement coach.
 *
 * PURE: the tools, the prompt, reply parsing, fit scoring.
 */
import { US_STATES } from "./states";
import type { LaunchpadData, LaunchpadProfile } from "./launchpad";

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

/**
 * Who's asking (owner 2026-10-25: "Should Max only be available for paid
 * plans?" → free with a limit). Free visitors get a taste, an email keeps the
 * conversation going, paid plans get Max without limits (fair use).
 */
export type MaxTier = "free" | "email" | "paid";
export const MAX_TIER_LIMITS: Record<MaxTier, { perDay: number; perHour: number; fitPicks: number; reminders: number }> = {
  free: { perDay: 5, perHour: 5, fitPicks: 1, reminders: 0 },
  email: { perDay: 20, perHour: 20, fitPicks: 3, reminders: 3 },
  paid: { perDay: 300, perHour: 60, fitPicks: 10, reminders: Infinity },
};

/** Certifications a visitor can claim for best_fit_bids. */
export const FIT_CERTS = ["small_business", "8a", "sdvosb", "vosb", "wosb", "edwosb", "hubzone"] as const;
export type FitCert = (typeof FIT_CERTS)[number];

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
    "best_fit_bids",
    "The open bids a visitor is BEST suited for, scored on their trade, state and certifications: bids set aside for a certification they hold rank first, bids they are not eligible for (set aside for a certification they lack) are left out, and very close deadlines rank lower. Each comes with its reasons. Use when they describe their business (\"I'm a woman-owned janitorial company in Ohio\") or ask what they should bid on.",
    {
      type: "object",
      properties: {
        trade: { type: "string", description: "Their trade, e.g. janitorial" },
        state: stateProp,
        certifications: {
          type: "array",
          items: { type: "string", enum: [...FIT_CERTS] },
          description: "Certifications they said they hold. small_business = a small business with no special certification. Empty if they didn't say.",
        },
      },
      required: ["trade"],
    },
  ],
  [
    "explain_bid",
    "Look up one bid from a link or number the visitor pasted (a contrax.company/bid/... link, a SAM.gov link, a Contrax bid number or a solicitation number) and return its details plus the companies already doing similar work for that buyer (current contracts) and recent similar awards, to judge whether it's worth chasing.",
    { type: "object", properties: { ref: { type: "string", description: "The link or number exactly as pasted" } }, required: ["ref"] },
  ],
  [
    "prime_contractors",
    "Big federal prime contractors based in a state (they must subcontract to small businesses). Optional name finds one company.",
    { type: "object", properties: { state: stateProp, name: { type: "string", description: "Optional company name, e.g. M.C. Dean" } }, required: ["state"] },
  ],
].map(([name, description, parameters]) => ({ type: "function" as const, function: { name: name as string, description: description as string, parameters } }));

export type MaxCta = "email" | "radar" | "trial" | "remind" | "capability" | null;
export type MaxLang = "en" | "es";

export interface MaxReply {
  say: string;
  /** What to offer next on the page. */
  cta: MaxCta;
  /** The trade and state the conversation is about (for the CTA and the email capture). */
  trade: string | null;
  state: string | null;
  /** The bid to offer a deadline reminder for (cta "remind"). */
  remindBid: number | null;
  /** The language Max answered in (the page speaks and listens in it). */
  lang: MaxLang;
  /** A capability statement draft from the visitor's own answers (cta "capability"). */
  capability: MaxCapability | null;
}

/** The Launchpad fields Max's interview fills (src/lib/launchpad.ts). */
export const CAPABILITY_FIELDS = ["company", "trade", "state", "summary", "competencies", "differentiators", "experience", "certifications", "naics"] as const;
export type MaxCapability = Partial<Record<(typeof CAPABILITY_FIELDS)[number], string>>;

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
    "- If a tool result has more_on_a_paid_plan or more_with_email, mention once, briefly and without pressure, that more matches are there (free with an email, or all of them on a paid plan).",
    "- When they tell you about their business (trade, state, certifications like woman-owned, veteran-owned, 8(a), HUBZone), use best_fit_bids and explain in a sentence why the top one fits them.",
    "- When they paste a bid link or number, use explain_bid and give a plain-English verdict: what the buyer wants, when it's due, who can bid (set-aside), who already does similar work there, and whether it looks worth chasing for a small business. Say 'similar work', never claim a company won this exact contract unless the tool says so.",
    "- Capability statement coach: when they want help with a capability statement, interview them a little at a time (two questions per turn, short): company name, what they do and where; their core services; what sets them apart; past jobs or customers; certifications. Once you have at least the company name, trade and core services, set cta to \"capability\" and fill capability with THEIR answers, lightly polished into professional wording (summary: 2 sentences; competencies and experience: short lines separated by newlines). Never add a claim, number, customer, certification or year they didn't give you; leave a field out if they didn't cover it. Tell them it's ready to finish in Launchpad, where they add contact details and print it. Answer in their language but write the capability fields in English.",
    "- General how-to questions (SAM.gov registration, UEI, NAICS codes, set-asides like 8(a), HUBZone, SDVOSB, WOSB, capability statements, subcontracting, how bidding works) you answer from your own knowledge, briefly and practically. Don't quote exact dollar thresholds or deadlines unless a tool gave them.",
    "",
    "Honesty is non-negotiable: never invent a bid, company, amount, date or event. Only state facts the tools returned. If you don't know, say so. You cannot submit bids, contact agencies, save anything, or see the visitor's account. Never ask for or repeat personal details beyond an email.",
    "",
    "Moving them forward: when you found bids they care about, set cta to \"email\" so the page offers to send them new matching bids (free). Set cta to \"remind\" with remind_bid set to the bid's id when they ask to be reminded about a deadline (the page asks for their email and emails them before it closes; you can't set it yourself, so say 'pop your email in below'). Set cta to \"radar\" when a full search would help, \"trial\" only if they ask about pricing or plans. Otherwise null.",
    "",
    "Language: if the visitor writes in Spanish, or the page says the visitor chose Spanish, answer entirely in natural, friendly Latin American Spanish and set lang to \"es\". Otherwise answer in English with lang \"en\". Bid titles stay as published.",
    "",
    "Reply with a JSON object: {\"say\": string, \"cta\": \"email\" | \"remind\" | \"capability\" | \"radar\" | \"trial\" | null, \"remind_bid\": number | null, \"capability\": {\"company\", \"trade\", \"state\", \"summary\", \"competencies\", \"differentiators\", \"experience\", \"certifications\", \"naics\"} | null, \"trade\": string | null, \"state\": string | null, \"lang\": \"en\" | \"es\"}. trade is the plain English trade word the conversation is about (e.g. janitorial), state the two-letter code.",
    `Today is ${now} (Eastern).`,
  ].join("\n");
}

/** Parse the model's JSON; anything malformed degrades to plain text with no CTA. */
export function parseMaxReply(raw: string, lang: MaxLang = "en"): MaxReply {
  const fallback = lang === "es" ? "Perdón, perdí el hilo. ¿Me lo preguntas otra vez?" : "Sorry, I lost my train of thought. Could you ask that again?";
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { say: raw.trim().slice(0, MAX_SAY_CHARS) || fallback, cta: null, trade: null, state: null, remindBid: null, lang, capability: null };
  }
  const o = (obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>;
  const say = typeof o.say === "string" && o.say.trim() ? o.say.trim().slice(0, MAX_SAY_CHARS) : fallback;
  const remindBid = Number.isInteger(o.remind_bid) && (o.remind_bid as number) > 0 ? (o.remind_bid as number) : null;
  let cta: MaxCta = o.cta === "email" || o.cta === "radar" || o.cta === "trial" || o.cta === "remind" || o.cta === "capability" ? o.cta : null;
  if (cta === "remind" && !remindBid) cta = "email";
  const capability = parseCapability(o.capability);
  if (cta === "capability" && !capability) cta = null;
  const trade = typeof o.trade === "string" && o.trade.trim() ? o.trade.trim().slice(0, 60) : null;
  const outLang: MaxLang = o.lang === "es" ? "es" : o.lang === "en" ? "en" : lang;
  return { say, cta, trade, state: stateCode(o.state), remindBid, lang: outLang, capability: cta === "capability" ? capability : null };
}

const CAP_LIMITS: Record<(typeof CAPABILITY_FIELDS)[number], number> = {
  company: 120,
  trade: 80,
  state: 2,
  summary: 700,
  competencies: 900,
  differentiators: 700,
  experience: 900,
  certifications: 300,
  naics: 120,
};

/** The model's capability draft: known fields only, trimmed; null without a company and trade. */
export function parseCapability(v: unknown): MaxCapability | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const out: MaxCapability = {};
  for (const f of CAPABILITY_FIELDS) {
    const raw = o[f];
    const text = Array.isArray(raw) ? raw.filter((x) => typeof x === "string").join("\n") : typeof raw === "string" ? raw : "";
    const val = f === "state" ? stateCode(text) ?? "" : text.trim().slice(0, CAP_LIMITS[f]);
    if (val) out[f] = val;
  }
  return out.company && out.trade ? out : null;
}

/**
 * Hand Max's draft to Launchpad (its localStorage workspace): fills only the
 * fields that are still empty, so nothing the visitor typed is ever replaced.
 */
export function mergeCapability(data: LaunchpadData, cap: MaxCapability): { data: LaunchpadData; filled: string[] } {
  const profile: LaunchpadProfile = { ...data.profile };
  const filled: string[] = [];
  for (const f of CAPABILITY_FIELDS) {
    const v = cap[f];
    if (v && !profile[f].trim()) {
      profile[f] = v;
      filled.push(f);
    }
  }
  return { data: { ...data, profile, updatedAt: filled.length ? new Date().toISOString() : data.updatedAt }, filled };
}

/**
 * Max's pick of the day (owner 2026-10-25, "3"): one open bid near the
 * visitor, greeted with reasons built only from the bid's own facts (no AI
 * call, nothing invented).
 */
export interface MaxPick {
  id: number;
  title: string;
  agency: string | null;
  location: string | null;
  due: string | null;
  setAside: string | null;
  value: string | null;
  postedDaysAgo: number | null;
}

export function maxPickGreeting(pick: MaxPick, stateName: string | null, lang: MaxLang = "en", now: number = Date.now()): string {
  const days = pick.due ? Math.ceil((Date.parse(`${pick.due}T23:59:00Z`) - now) / 86_400_000) : null;
  const program = setAsideProgram(pick.setAside);
  const es = lang === "es";
  const why: string[] = [];
  if (days != null && days > 0) why.push(es ? `cierra en ${days} días, tiempo de sobra para prepararte` : `it closes in ${days} days, so there's time to prepare`);
  if (program !== "open" && program !== "other") why.push(es ? `está reservado para ${program === "small" ? "pequeños negocios" : `negocios ${PROGRAM_NAME[program]}`}` : `it's set aside for ${program === "small" ? "small businesses" : `${PROGRAM_NAME[program]} businesses`}`);
  if (pick.value) why.push(es ? `el valor publicado es ${pick.value}` : `the listed value is ${pick.value}`);
  if (pick.postedDaysAgo != null && pick.postedDaysAgo <= 3) why.push(es ? "se publicó hace poco" : "it just posted");
  const where = stateName ? (es ? ` en ${stateName}` : ` in ${stateName}`) : "";
  const buyer = pick.agency ? (es ? ` de ${pick.agency}` : ` from ${pick.agency}`) : "";
  const reason = why.length ? (es ? ` Me gusta porque ${joinList(why, "y")}.` : ` I like it because ${joinList(why, "and")}.`) : "";
  return es
    ? `¡Hola! Soy Max. Mi selección del día${where}: "${pick.title}"${buyer}.${reason} ¿A qué se dedica tu negocio? Te busco más.`
    : `Hi, I'm Max. My pick of the day${where}: "${pick.title}"${buyer}.${reason} Tell me what your business does and I'll find more like it.`;
}

function joinList(items: string[], and: string): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}

/** Bid pages (owner 2026-10-25, "1"): tell Max which bid "this" is. */
export function maxBidContext(bidId: unknown): string {
  const id = Number(bidId);
  if (!Number.isInteger(id) || id <= 0) return "";
  return `\nThe visitor is reading the Contrax page for bid #${id}. "This bid", "this one" or "it" means that bid: call explain_bid with ref "${id}" before answering about it. To offer a reminder for it, use remind_bid ${id}.`;
}

/**
 * Best fit (owner 2026-10-25, "1": "Am I a fit?"): which program a bid's
 * set-aside text restricts it to. "open" = full and open competition (or none
 * stated); "other" = a restriction we can't read, which is never excluded.
 */
export type SetAsideProgram = "open" | "small" | "8a" | "sdvosb" | "vosb" | "wosb" | "edwosb" | "hubzone" | "other";

export function setAsideProgram(text: string | null | undefined): SetAsideProgram {
  const t = String(text ?? "").toLowerCase().trim();
  if (!t || /^(none|n\/a|na|no set.?aside( used)?|full and open.*|unrestricted)$/.test(t)) return "open";
  if (/8\s*\(?a\)?|\b8an\b/.test(t)) return "8a";
  if (/sdvosb|service.?disabled/.test(t)) return "sdvosb";
  if (/edwosb|economically disadvantaged wom/.test(t)) return "edwosb";
  if (/wosb|wom[ae]n.?owned/.test(t)) return "wosb";
  if (/hubzone/.test(t)) return "hubzone";
  if (/\bvosb\b|veteran.?owned/.test(t)) return "vosb";
  if (/small business|\bsba\b|\bsbp\b|\bsb\b|total small/.test(t)) return "small";
  return "other";
}

/** Whether a business with these certifications can bid on that program. */
export function certEligible(program: SetAsideProgram, certs: readonly FitCert[]): boolean {
  const has = (c: FitCert) => certs.includes(c);
  switch (program) {
    case "open":
    case "other":
      return true;
    case "small":
      // Any of these certifications is a small business; with none stated, assume they're small (Max's audience).
      return true;
    case "8a":
      return has("8a");
    case "sdvosb":
      return has("sdvosb");
    case "vosb":
      return has("vosb") || has("sdvosb");
    case "wosb":
      return has("wosb") || has("edwosb");
    case "edwosb":
      return has("edwosb");
    case "hubzone":
      return has("hubzone");
  }
}

const PROGRAM_NAME: Record<SetAsideProgram, string> = {
  open: "open to everyone",
  small: "small business",
  "8a": "8(a)",
  sdvosb: "service-disabled veteran-owned",
  vosb: "veteran-owned",
  wosb: "woman-owned",
  edwosb: "economically disadvantaged woman-owned",
  hubzone: "HUBZone",
  other: "restricted",
};

export interface FitBid {
  id: number;
  due_date: string | null;
  set_aside: string | null;
  estimated_value: string | null;
}

/** Score one bid for a visitor; ineligible bids are flagged, not scored. */
export function scoreFit(bid: FitBid, certs: readonly FitCert[], now: number = Date.now()): { eligible: boolean; score: number; reasons: string[] } {
  const program = setAsideProgram(bid.set_aside);
  if (!certEligible(program, certs)) return { eligible: false, score: 0, reasons: [`set aside for ${PROGRAM_NAME[program]} businesses`] };
  const reasons: string[] = [];
  let score = 0;
  if (program === "small") {
    score += 25;
    reasons.push("small business set-aside, so big firms can't bid");
  } else if (program === "open" || program === "other") {
    score += 5;
    reasons.push(program === "open" ? "open to everyone" : `set-aside: ${bid.set_aside}`);
  } else {
    score += 45;
    reasons.push(`set aside for ${PROGRAM_NAME[program]} businesses, which you are, so far fewer competitors`);
  }
  const days = bid.due_date ? Math.floor((Date.parse(bid.due_date) - now) / 86_400_000) : null;
  if (days == null) reasons.push("no deadline listed");
  else if (days < 3) {
    score -= 30;
    reasons.push(`closes in ${Math.max(days, 0)} day${days === 1 ? "" : "s"}, very tight`);
  } else if (days < 7) reasons.push(`closes in ${days} days`);
  else if (days <= 45) {
    score += 20;
    reasons.push(`${days} days to prepare`);
  } else {
    score += 10;
    reasons.push(`${days} days away`);
  }
  if (bid.estimated_value) {
    score += 5;
    reasons.push(`value listed: ${bid.estimated_value}`);
  }
  return { eligible: true, score, reasons };
}

/** The visitor's best 3, plus how many they can and can't bid on. */
export function rankFit<T extends FitBid>(bids: T[], certs: readonly FitCert[], now: number = Date.now(), limit = 3) {
  const scored = bids.map((b) => ({ bid: b, ...scoreFit(b, certs, now) }));
  const eligible = scored.filter((x) => x.eligible).sort((a, b) => b.score - a.score || String(a.bid.due_date ?? "9999").localeCompare(String(b.bid.due_date ?? "9999")));
  return { total: bids.length, eligible: eligible.length, notEligible: scored.length - eligible.length, top: eligible.slice(0, limit) };
}

/** Certifications from the model's arguments (unknown values dropped). */
export function fitCerts(v: unknown): FitCert[] {
  return Array.isArray(v) ? [...new Set(v.map(String).filter((c): c is FitCert => (FIT_CERTS as readonly string[]).includes(c)))] : [];
}

/**
 * Bid explainer (owner 2026-10-25, "2"): what a pasted reference points at.
 * A Contrax link or bare number is our id; a SAM.gov link carries the notice
 * id; anything else is tried as a solicitation number.
 */
export type BidRef = { kind: "id"; id: number } | { kind: "sam"; noticeId: string } | { kind: "solicitation"; number: string } | null;

export function parseBidRef(ref: string): BidRef {
  const r = String(ref ?? "").trim().slice(0, 300);
  if (!r) return null;
  const contrax = r.match(/contrax\.company\/bid\/(\d+)/i) ?? r.match(/^\/?bid\/(\d+)/i);
  if (contrax) return { kind: "id", id: Number(contrax[1]) };
  const sam = r.match(/sam\.gov\/(?:opp|workspace\/contract\/opp)\/([0-9a-f]{32})/i);
  if (sam) return { kind: "sam", noticeId: sam[1].toLowerCase() };
  if (/^#?\d{1,9}$/.test(r)) return { kind: "id", id: Number(r.replace("#", "")) };
  const sol = r.replace(/^(solicitation|sol\.?|rfp|rfq|ifb|no\.?|number|#)\s*:?\s*/i, "").trim();
  if (/^[A-Za-z0-9][A-Za-z0-9\-_.\/]{3,59}$/.test(sol)) return { kind: "solicitation", number: sol };
  return null;
}

/**
 * Deadline reminder (owner 2026-10-25, "5"): when to email, 3 days before the
 * deadline (or now, if it's closer than that). Null when the bid closes in
 * under a day or has no deadline: too late to be useful.
 */
export const REMIND_DAYS_BEFORE = 3;
export function reminderAt(dueDate: string | null | undefined, now: number = Date.now()): Date | null {
  const due = dueDate ? Date.parse(dueDate) : NaN;
  if (!Number.isFinite(due) || due - now < 86_400_000) return null;
  return new Date(Math.max(now, due - REMIND_DAYS_BEFORE * 86_400_000));
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

const CHISTES = [
  "¿Por qué el contratista llevó una escalera a la apertura de ofertas? Porque oyó que los precios iban a subir.",
  "Intenté contar un chiste sobre el reglamento federal de compras, pero tenía dos mil páginas y nadie se rió.",
  "¿Mi contrato favorito? El que está reservado para ti y solo dos competidores más.",
];

export function maxEasterEgg(text: string, pick: number = Math.random()): { say: string; effect: MaxEffect } | null {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  // Spanish (owner 2026-10-25, "7"): the same fun, en español.
  if (/\bmuestrame el dinero\b/.test(t)) return { say: "¡Así se habla! Vamos a buscar contratos con tu nombre.", effect: "money" };
  if (/\balerta roja\b/.test(t)) return { say: "¡Alerta roja! Todos a sus puestos. Hay una fecha límite que no va a esperar.", effect: "redalert" };
  if (/\byo soy iron ?man\b/.test(t)) return { say: "Bienvenido de vuelta. El traje está listo, y los contratos del gobierno también.", effect: "ironman" };
  if (/\bquien te (hizo|creo|construyo)\b/.test(t)) return { say: "Me construyó el equipo de Contrax en Virginia, para ayudar a los pequeños negocios a ganar contratos del gobierno. ¿A qué se dedica tu negocio?", effect: null };
  if (/\bcuentame un chiste\b|\bhazme reir\b/.test(t)) return { say: CHISTES[Math.floor(pick * CHISTES.length) % CHISTES.length], effect: null };
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
