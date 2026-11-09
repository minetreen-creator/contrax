/**
 * Auto-Pilot Radar, server side (owner 2026-11-09): scores a member's new matching bids with the
 * AI and caches each answer, so a bid is read once per member (and again only if their profile
 * changes). Eligibility is never cached: it is worked out from today's certifications on every
 * read (src/lib/autopilot.ts). Without OPENAI_API_KEY it does nothing and the email goes out as
 * before.
 */
import { sql } from "~/db";
import { callAI } from "~/lib/ai";
import {
  AUTOPILOT_DAILY_CAP,
  autopilotMessages,
  autopilotProfileKey,
  eligibilityFor,
  parseAutopilotVerdict,
  type AutopilotBid,
  type AutopilotProfile,
  type AutopilotVerdict,
} from "~/lib/autopilot";

/** Most AI calls in one morning across every member (cost cap). */
export const AUTOPILOT_RUN_CAP = 600;

export function autopilotEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function ensureAutopilotTable(): Promise<void> {
  await sql()`
    CREATE TABLE IF NOT EXISTS autopilot_verdicts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      bid_id INTEGER NOT NULL,
      profile_key TEXT NOT NULL,
      raw TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, bid_id)
    )
  `;
}

/** Shared across members in one run: how many AI calls are left this morning. */
export interface AutopilotBudget {
  left: number;
  calls: number;
  failures: number;
}

export function newAutopilotBudget(cap = AUTOPILOT_RUN_CAP): AutopilotBudget {
  return { left: cap, calls: 0, failures: 0 };
}

/**
 * Verdicts for up to AUTOPILOT_DAILY_CAP of this member's bids (in the order given). Cached
 * answers are reused; the rest are scored while the budget lasts. `store: false` scores without
 * writing (the preview). Never throws: a failed bid is left out.
 */
export async function autopilotForMember(
  userId: number,
  profile: AutopilotProfile,
  bids: AutopilotBid[],
  budget: AutopilotBudget,
  opts: { store?: boolean; ai?: (messages: { role: string; content: string }[]) => Promise<string>; db?: typeof sql } = {},
): Promise<AutopilotVerdict[]> {
  if ((!opts.ai && !autopilotEnabled()) || bids.length === 0) return [];
  const db = opts.db ?? sql;
  const ai = opts.ai ?? ((m) => callAI(m, { jsonMode: true, temperature: 0.2, max_tokens: 300 }));
  const store = opts.store !== false;
  const key = autopilotProfileKey(profile);
  const picked = bids.slice(0, AUTOPILOT_DAILY_CAP);
  const certs = profile.certifications ?? [];

  const cached = new Map<number, string>();
  try {
    const rows = (await db()`
      SELECT bid_id, raw FROM autopilot_verdicts
      WHERE user_id = ${userId} AND profile_key = ${key} AND bid_id = ANY(${picked.map((b) => b.bid_id)})
    `) as { bid_id: number; raw: string }[];
    for (const r of rows) cached.set(Number(r.bid_id), String(r.raw));
  } catch (e) {
    console.warn(`[autopilot] cache read failed: ${(e as Error).message}`);
  }

  const out: AutopilotVerdict[] = [];
  const todo: AutopilotBid[] = [];
  for (const bid of picked) {
    const raw = cached.get(bid.bid_id);
    if (raw) {
      const v = parseAutopilotVerdict(raw, bid, eligibilityFor(bid.set_aside, certs));
      if (v) out.push(v);
    } else {
      todo.push(bid);
    }
  }

  const scoreOne = async (bid: AutopilotBid) => {
    if (budget.left <= 0) return;
    budget.left--;
    budget.calls++;
    const eligibility = eligibilityFor(bid.set_aside, certs);
    try {
      const raw = await ai(autopilotMessages(profile, bid, eligibility));
      const v = parseAutopilotVerdict(raw, bid, eligibility);
      if (!v) {
        budget.failures++;
        return;
      }
      out.push(v);
      if (store) {
        await db()`
          INSERT INTO autopilot_verdicts (user_id, bid_id, profile_key, raw)
          VALUES (${userId}, ${bid.bid_id}, ${key}, ${raw.slice(0, 4000)})
          ON CONFLICT (user_id, bid_id) DO UPDATE SET profile_key = EXCLUDED.profile_key, raw = EXCLUDED.raw, created_at = NOW()
        `;
      }
    } catch (e) {
      budget.failures++;
      console.warn(`[autopilot] bid ${bid.bid_id} not scored: ${(e as Error).message.slice(0, 160)}`);
    }
  };
  // Four at a time keeps a morning of members quick without bursting the API.
  for (let i = 0; i < todo.length; i += 4) await Promise.all(todo.slice(i, i + 4).map(scoreOne));
  const order = new Map(picked.map((b, i) => [b.bid_id, i]));
  return out.sort((a, b) => (order.get(a.bid_id) ?? 0) - (order.get(b.bid_id) ?? 0));
}
