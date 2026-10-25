import { sql } from "~/db";
import { fetchOpenAIWithRetry, sanitizeLogString } from "~/lib/ai";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { AWARD_NOTICE_EXCLUSION_SQL, CLOSED_EXCLUSION_SQL, OPEN_BID_SQL, setAsidePred } from "~/lib/open-bids";
import { noticeKeySql } from "~/lib/notice-dedupe";
import { expandTrade, isStrongTradeMatch, tradeKeywordPred } from "~/lib/trade-registry";
import { filterBidsToState, mapSeoBid, type SeoBid } from "~/lib/seo-landing";
import { STATE_CODE_TO_NAME } from "~/lib/location-state";
import { jarvisSpeech } from "~/lib/jarvis.server";
import {
  MAX_QUESTION_CHARS,
  MAX_RECOMPETE_TRADES,
  MAX_TOOL_ROUNDS,
  MAX_TOOLS,
  maxPrompt,
  parseMaxReply,
  sanitizeMaxHistory,
  stateCode,
  type MaxReply,
} from "~/lib/max";

/**
 * Max's brain (src/lib/max.ts) for /api/max: OpenAI function calling over
 * read-only PUBLIC lookups (the same data the public pages show). No visitor,
 * account or revenue data is reachable from here.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const SMART_MODEL = process.env.MAX_MODEL || process.env.JARVIS_MODEL || "gpt-4.1";
const FALLBACK_MODEL = "gpt-4o-mini";

/** A bid card the page shows (never the model's words: straight from the lookup). */
export interface MaxBidCard {
  id: number;
  title: string;
  agency: string | null;
  location: string | null;
  due: string | null;
  setAside: string | null;
}

const card = (b: SeoBid): MaxBidCard => ({
  id: b.id,
  title: b.title,
  agency: b.agency,
  location: b.location,
  due: b.due_date ? String(b.due_date).slice(0, 10) : null,
  setAside: b.set_aside,
});

const OPEN = () => `${OPEN_BID_SQL} AND ${LOW_CONTENT_SQL} AND ${AWARD_EXCLUSION_SQL} AND ${AWARD_NOTICE_EXCLUSION_SQL} AND ${CLOSED_EXCLUSION_SQL}`;

/** Open bids for a trade/keyword, the same match the /contracts-in pages and Radar use. */
async function searchOpenBids(query: string, state: string | null, setAside: string): Promise<SeoBid[]> {
  const expansion = expandTrade(query);
  const db = sql;
  const aside = setAside === "small_business" ? db().unsafe("AND set_aside IS NOT NULL") : setAside && setAside !== "any" ? setAsidePred(setAside, db) : db()``;
  const rows = (await db()`
    SELECT id, title, agency, description, due_date, estimated_value, naics_code, location, set_aside, source_url, source, created_at
    FROM (
      SELECT DISTINCT ON (${db().unsafe(noticeKeySql("bids"))})
             id, title, agency, description, due_date, estimated_value, naics_code, location, set_aside, source_url, source, created_at
      FROM bids
      WHERE due_date > NOW() AND ${db().unsafe(LOW_CONTENT_SQL)} AND ${db().unsafe(AWARD_EXCLUSION_SQL)}
        ${tradeKeywordPred(db, expansion)}
        ${aside}
      ORDER BY ${db().unsafe(noticeKeySql("bids"))}, created_at DESC NULLS LAST
    ) t
    LIMIT 5000
  `) as any[];
  const strong = rows.filter((r) => isStrongTradeMatch(r.title, null, r.description, r.naics_code, expansion)).map(mapSeoBid);
  return state ? filterBidsToState(strong, state) : strong.sort((a, b) => String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999")));
}

type ToolOut = { result: unknown; cards?: MaxBidCard[] };

async function runTool(name: string, args: Record<string, unknown>): Promise<ToolOut> {
  const db = sql();
  const state = stateCode(args.state);
  switch (name) {
    case "search_open_bids": {
      const query = String(args.query ?? "").trim().slice(0, 60);
      if (!query) return { result: { error: "query is required" } };
      const bids = await searchOpenBids(query, state, String(args.set_aside ?? "any"));
      const top = bids.slice(0, 6).map(card);
      return {
        result: { query, state: state ? STATE_CODE_TO_NAME[state] ?? state : "nationwide", total_open: bids.length, soonest_due: top },
        cards: top,
      };
    }
    case "bid_details": {
      const id = Math.round(Number(args.id));
      if (!Number.isFinite(id) || id <= 0) return { result: { error: "an id is required" } };
      const [b] = (await db.query(
        `SELECT id, title, agency, location, normalized_state AS state, to_char(due_date, 'Dy Mon DD YYYY') AS due,
                estimated_value, set_aside, naics_code, LEFT(regexp_replace(COALESCE(description, ''), '\\s+', ' ', 'g'), 900) AS description
         FROM bids WHERE id = $1 AND ${AWARD_EXCLUSION_SQL}`,
        [id],
      )) as Record<string, unknown>[];
      return { result: b ?? { error: "no open bid with that id" } };
    }
    case "state_overview": {
      if (!state) return { result: { error: "a two-letter state is required" } };
      const where = `${OPEN()} AND normalized_state = $1`;
      const [[c], agencies, kinds] = (await Promise.all([
        db.query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE due_date < NOW() + INTERVAL '7 days')::int AS closing_7d FROM bids WHERE ${where}`, [state]),
        db.query(`SELECT agency, COUNT(*)::int AS n FROM bids WHERE ${where} GROUP BY agency ORDER BY n DESC LIMIT 6`, [state]),
        db.query(`SELECT COALESCE(NULLIF(category, ''), 'Other') AS kind, COUNT(*)::int AS n FROM bids WHERE ${where} GROUP BY 1 ORDER BY n DESC LIMIT 6`, [state]),
      ])) as [Record<string, number>[], unknown[], unknown[]];
      return { result: { state: STATE_CODE_TO_NAME[state] ?? state, open_now: c?.n ?? 0, closing_in_7_days: c?.closing_7d ?? 0, busiest_agencies: agencies, common_kinds_of_work: kinds } };
    }
    case "recent_winners": {
      if (!state) return { result: { error: "a two-letter state is required" } };
      const { queryAwardLeads } = await import("~/lib/award-leads.server");
      const { pickWinners, moneyText } = await import("~/lib/subcontracts/state-page");
      const q = String(args.query ?? "").trim().slice(0, 60);
      const naics = q ? expandTrade(q).naicsCodes : [];
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
      const { rows } = await queryAwardLeads({ states: [state], naics, since, minAmount: 250_000, limit: 500, after: 0 });
      const winners = pickWinners(rows, 8).map((w) => ({
        company: w.recipient_name,
        amount: moneyText(w.amount),
        agency: w.sub_agency || w.agency,
        city: w.recipient_city,
        awarded: w.awarded_on,
        what: (w.naics_description || w.description || "").slice(0, 140),
      }));
      return { result: { state: STATE_CODE_TO_NAME[state] ?? state, trade: q || "all", winners } };
    }
    case "contracts_ending_soon": {
      const trade = String(args.trade ?? "");
      if (!(MAX_RECOMPETE_TRADES as readonly string[]).includes(trade)) return { result: { error: "unknown trade" } };
      const { queryRecompetes } = await import("~/lib/federal-trade-data.server");
      const { moneyText } = await import("~/lib/subcontracts/state-page");
      const r = await queryRecompetes({ trade, state, months: 12, limit: 8 });
      return {
        result: {
          trade,
          state: state ? STATE_CODE_TO_NAME[state] ?? state : "nationwide",
          ending_in_12_months: r.count,
          total_value: moneyText(r.total),
          soonest: r.rows.map((x) => ({ incumbent: x.recipient_name, amount: moneyText(x.amount), agency: x.sub_agency || x.agency, ends: x.end_date, what: (x.description ?? "").slice(0, 120) })),
        },
      };
    }
    case "industry_days": {
      const { queryIndustryDays } = await import("~/lib/industry-days-data");
      const rows = (await queryIndustryDays()).filter((r) => !state || r.state === state);
      return { result: { state: state ? STATE_CODE_TO_NAME[state] ?? state : "nationwide", count: rows.length, events: rows.slice(0, 8).map((r) => ({ title: r.title, agency: r.agency, date: r.date, where: r.location ?? r.state })) } };
    }
    case "prime_contractors": {
      if (!state) return { result: { error: "a two-letter state is required" } };
      const { readPrimesPayload } = await import("~/lib/subcontracts/read.server");
      const { isPrimesQueryError, isUnavailable } = await import("~/lib/subcontracts/read");
      const { searchPrimes } = await import("~/lib/subcontracts/state-page");
      const name = String(args.name ?? "").trim().slice(0, 60);
      const all: { legalName: string; uei: string; naicsLabel: string | null; agencies: string[] }[] = [];
      let total = 0;
      for (let page = 1; page <= 10; page++) {
        const res = await readPrimesPayload({ naics: null, state: (STATE_CODE_TO_NAME[state] ?? state).toUpperCase(), page, limit: 100 });
        if (isPrimesQueryError(res) || isUnavailable(res)) break;
        total = res.counts.filtered;
        all.push(...res.rows.map((p) => ({ legalName: p.legalName, uei: p.uei, naicsLabel: p.naicsLabels[0] ?? null, agencies: p.agencies.slice(0, 3) })));
        if (!res.hasMore || !name) break;
      }
      const found = name ? searchPrimes(all, name) : all;
      return { result: { state: STATE_CODE_TO_NAME[state] ?? state, primes_in_state: total, matches: found.slice(0, 8).map((p) => ({ company: p.legalName, work: p.naicsLabel, works_for: p.agencies })) } };
    }
    default:
      return { result: { error: `unknown tool ${name}` } };
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
    body: JSON.stringify({ model, messages, tools: MAX_TOOLS, temperature: 0.4, max_tokens: 500, response_format: { type: "json_object" } }),
  });
  if (!res.ok) {
    const err = new Error(`OpenAI ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const msg = ((await res.json()) as { choices?: { message?: ChatMsg }[] }).choices?.[0]?.message;
  if (!msg) throw new Error("OpenAI returned no message");
  return msg;
}

async function answer(model: string, messages: ChatMsg[]): Promise<{ raw: string; cards: MaxBidCard[] }> {
  let cards: MaxBidCard[] = [];
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const msg = await chat(model, messages);
    if (!msg.tool_calls?.length || round === MAX_TOOL_ROUNDS) return { raw: msg.content ?? "", cards };
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      let out: ToolOut;
      try {
        out = await runTool(call.function.name, JSON.parse(call.function.arguments || "{}"));
      } catch (err) {
        console.error(`[max] tool ${call.function.name} failed:`, sanitizeLogString(err));
        out = { result: { error: "lookup failed" } };
      }
      if (out.cards?.length) cards = out.cards; // the last search is the one the answer is about
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out.result).slice(0, 7000) });
    }
  }
  return { raw: "", cards };
}

/** One visitor question in, Max's reply and the bid cards to show out. */
export async function askMax(input: { question: string; history: unknown }): Promise<MaxReply & { bids: MaxBidCard[] }> {
  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const messages: ChatMsg[] = [
    { role: "system", content: maxPrompt(now) },
    ...sanitizeMaxHistory(input.history),
    { role: "user", content: input.question.trim().slice(0, MAX_QUESTION_CHARS) },
  ];
  let out: { raw: string; cards: MaxBidCard[] };
  try {
    out = await answer(SMART_MODEL, [...messages]);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 400 && status !== 404) {
      console.error("[max] failed:", sanitizeLogString(err));
      return { say: "Sorry, I'm having trouble reaching my brain right now. Try me again in a moment.", cta: null, trade: null, state: null, bids: [] };
    }
    out = await answer(FALLBACK_MODEL, [...messages]).catch(() => ({ raw: "", cards: [] }));
  }
  return { ...parseMaxReply(out.raw), bids: out.cards };
}

/** Max's voice (owner 2026-10-25: "give it an american accent too"). */
const MAX_VOICE = process.env.MAX_VOICE || "ash";
const MAX_STYLE =
  "Voice: a friendly, confident American man in his thirties with a natural General American accent. Upbeat, warm and clear, like a sharp business advisor talking to a small business owner. Natural pace, conversational.";

export function maxSpeech(text: string): Promise<ArrayBuffer | null> {
  return jarvisSpeech(text, { voice: MAX_VOICE, style: MAX_STYLE });
}
