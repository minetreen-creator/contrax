/**
 * Jarvis Autonomous Upgrade — Phase 1 SEED: owner-approved operating facts.
 *
 * Idempotently seeds jarvis_memory with the OWNER-APPROVED operating facts from
 * the business plan (owner_approved=true, source='business-plan', high
 * confidence). Later phases read these as the "approved memory" tier of the
 * data-priority rule (live data > approved decisions > approved memory > ...).
 *
 * IDEMPOTENT: re-running never duplicates. A fact is inserted only if no
 * existing row already carries the same (source, category, fact). Existing rows
 * are untouched (never overwritten here) so later-phase edits to a seeded fact
 * survive re-seeds.
 *
 * Stage semantics below mirror EXACTLY what the Unified Funnel board / Jarvis
 * readers already implement (src/lib/jarvis/readers.ts + src/lib/tracking-intake.ts).
 */
import { sql } from "~/db";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createMemory, listAllMemory } from "~/lib/jarvis/store";

export interface SeedFact {
  category: string;
  fact: string;
}

/** The owner-approved operating facts from the business plan. */
export const BUSINESS_PLAN_FACTS: SeedFact[] = [
  // ── Funnel (mirrors the Unified Funnel board semantics) ──
  { category: "funnel", fact: "Funnel stages: Qualified Visit → Radar Completed → Signup Completed → Activated → Paid." },
  { category: "funnel", fact: "Qualified = any qualifying intent signal: an activation event (rfp_brief_result, save_success, score_result, score_submit, alert_created), radar_scan_complete, signup_view, signup_view_with_score, signup_start, signup_submit, signup_abandon, signup_success, hero_cta_click, or radar_scan_start." },
  { category: "funnel", fact: "Radar Completed = a radar_scan_complete funnel event." },
  { category: "funnel", fact: "Signup Completed = a signup_success funnel event." },
  { category: "funnel", fact: "Activated = any of the activation events rfp_brief_result, save_success, score_result, score_submit, alert_created." },
  { category: "funnel", fact: "Paid = distinct funnel users linked to an account with an active subscription (users.subscription_status = 'active'), with owner/admin/QA/bot exclusions applied." },

  // ── Pricing ──
  { category: "pricing", fact: "Basic $0/mo: Basic Solicitations Search, up to 3 Saved Bids, Standard Set-Aside Filters." },
  { category: "pricing", fact: "Starter $19/mo: Unlimited Saved Bids, Daily NAICS Email Alerts, CSV Pipeline Export." },
  { category: "pricing", fact: "Professional $79/mo (featured): Full Incumbent Intelligence & Past Pricing, AI Match Scoring, Draft Tools." },
  { category: "pricing", fact: "Agency $199/mo: Proposal Evaluator Red Team, team roles, client-ready export." },
  { category: "pricing", fact: "Gating rules: Basic caps Saved Bids at 3 (Starter+ unlimited); Incumbent Intelligence, AI Match Scoring, and Draft Tools are Professional+." },
  { category: "pricing", fact: "AI Executive Brief monthly allowance: Basic 1 / Starter 3 / Professional 50 / Agency 200." },

  // ── Trial ──
  { category: "trial", fact: "The free Professional trial is 14 days, lazy-start on the user's first premium use (not signup), no credit card, and auto-downgrades to free Basic after expiry." },
  { category: "trial", fact: "Per-trial caps: 5 AI Briefs / 3 match scores / 1 draft / 3 incumbent-intelligence looks." },
  { category: "trial", fact: "The Mission Beyond grant (user 67) is a grant, not a trial — it is untouched by trial logic and expires 2026-10-20." },

  // ── Target market ──
  { category: "target-market", fact: "Target market: minority-, veteran-, and women-owned small businesses pursuing US government set-aside contracts, holding 8(a), SDVOSB, WOSB, or HUBZone certifications." },

  // ── Metrics exclusion ──
  { category: "metrics-exclusion", fact: "Exclusion rule: exclude owner/admin accounts, QA/test accounts, bots, and health checks from all metrics (funnel, page views, user aggregates)." },

  // ── Data priority ──
  { category: "data-priority", fact: "Data priority: live Contrax data > approved owner decisions > approved memory > recent experiment results > historical data > model knowledge." },
];

/**
 * Idempotently seed (or refresh-by-insert-only) the owner-approved facts.
 * Returns the number of NEW rows inserted. Existing facts are left untouched.
 */
export async function seedBusinessPlanFacts(db: NeonQueryFunction<false, false>, facts: SeedFact[] = BUSINESS_PLAN_FACTS): Promise<number> {
  const existing = await listAllMemory(db as ReturnType<typeof sql>);
  const seen = new Set(existing.map((m) => `${m.source}|${m.category}|${m.fact}`));
  let inserted = 0;
  for (const f of facts) {
    const key = `business-plan|${f.category}|${f.fact}`;
    if (seen.has(key)) continue;
    await createMemory(db as ReturnType<typeof sql>, {
      category: f.category,
      fact: f.fact,
      source: "business-plan",
      confidence: 1,
      owner_approved: true,
    });
    seen.add(key);
    inserted++;
  }
  return inserted;
}
