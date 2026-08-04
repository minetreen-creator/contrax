/**
 * Contract Intelligence Copilot — context assembler.
 *
 * Builds a single dense text block describing EVERYTHING Contrax knows about a
 * business: profile, certifications, active scored bids, win/loss learning
 * patterns, recurring weaknesses from lost bids, cached pricing data, and
 * relevant knowledge-base documents. This block is injected into the Copilot
 * chat system prompt so the assistant answers from the business's real data.
 *
 * Deliberately defensive: each section is isolated in its own try/catch so a
 * missing table, missing profile, or empty dataset degrades that section
 * (skipped or marked "no data") instead of breaking the whole context.
 */
import { buildProfileContext } from "~/lib/profile-context";
import { getLearningContext } from "~/lib/learning";
import { getRelevantContext } from "~/lib/knowledge";
import { sql } from "~/db";
import type { BusinessProfile } from "~/components/CompanyProfile";

const PROFILE_COLUMNS = `id, business_name, industry, locations, service_categories, naics_codes, logo_url, is_agency, uei, cage_code, sam_expiration, duns, certifications, certification_dates, years_in_business, employee_count, annual_revenue, past_performance_summary, capability_statement, specialties, licenses, typical_contract_value`;

/** Looks up the user id for an email (or null). */
async function findUserId(userEmail: string): Promise<number | null> {
  try {
    const rows = await sql()`SELECT id FROM users WHERE email = ${userEmail} LIMIT 1`;
    return rows.length > 0 ? Number((rows[0] as { id: number }).id) : null;
  } catch {
    return null;
  }
}

/** Loads the business profile for a user id (or null). */
async function loadProfile(userId: number | null): Promise<BusinessProfile | null> {
  if (!userId) return null;
  try {
    const rows = await sql()`
      SELECT ${PROFILE_COLUMNS}
      FROM business_profiles WHERE user_id = ${userId} LIMIT 1`;
    if (rows.length === 0) return null;
    const p = rows[0] as Record<string, unknown>;
    return {
      id: Number(p.id),
      business_name: String(p.business_name ?? ""),
      industry: String(p.industry ?? ""),
      locations: Array.isArray(p.locations) ? p.locations.map(String) : [],
      service_categories: Array.isArray(p.service_categories) ? p.service_categories.map(String) : [],
      naics_codes: Array.isArray(p.naics_codes) ? p.naics_codes.map(String) : [],
      logo_url: p.logo_url ? String(p.logo_url) : null,
      is_agency: Boolean(p.is_agency),
      uei: p.uei ? String(p.uei) : null,
      cage_code: p.cage_code ? String(p.cage_code) : null,
      sam_expiration: p.sam_expiration ? String(p.sam_expiration).slice(0, 10) : null,
      duns: p.duns ? String(p.duns) : null,
      certifications: Array.isArray(p.certifications) ? p.certifications.map(String) : [],
      certification_dates: p.certification_dates && typeof p.certification_dates === "object" && !Array.isArray(p.certification_dates) ? (p.certification_dates as Record<string, string>) : {},
      years_in_business: p.years_in_business != null ? Number(p.years_in_business) : null,
      employee_count: p.employee_count != null ? Number(p.employee_count) : null,
      annual_revenue: p.annual_revenue ? String(p.annual_revenue) : null,
      past_performance_summary: p.past_performance_summary ? String(p.past_performance_summary) : null,
      capability_statement: p.capability_statement ? String(p.capability_statement) : null,
      specialties: Array.isArray(p.specialties) ? p.specialties.map(String) : [],
      licenses: Array.isArray(p.licenses) ? (p.licenses as BusinessProfile["licenses"]) : [],
      typical_contract_value: p.typical_contract_value ? String(p.typical_contract_value) : null,
    };
  } catch {
    return null;
  }
}

/** Top 10 bids that have been scored or recommended for this user. */
async function loadActiveBids(userId: number | null, userEmail: string): Promise<string> {
  try {
    await sql()`CREATE TABLE IF NOT EXISTS bid_scores (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, bid_id INTEGER NOT NULL REFERENCES bids(id), win_probability INTEGER NOT NULL, competition_level TEXT NOT NULL, agency_sentiment TEXT NOT NULL, size_fit TEXT NOT NULL DEFAULT '', experience_match TEXT NOT NULL, similar_awards_note TEXT NOT NULL DEFAULT '', ai_explanation TEXT NOT NULL, generated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, bid_id))`;
    await sql()`CREATE TABLE IF NOT EXISTS bid_recommendations (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_id TEXT NOT NULL, bid_title TEXT NOT NULL, win_probability INTEGER, effort_level TEXT DEFAULT 'medium', competition_level TEXT DEFAULT 'medium', strategic_fit TEXT DEFAULT 'moderate', recommendation TEXT DEFAULT 'CAUTIOUS', summary TEXT DEFAULT '', factors JSONB DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, bid_id))`;
  } catch { /* tables may not exist — queries below are guarded anyway */ }

  try {
    const rows = await sql()`
      SELECT b.title, b.agency, b.set_aside, b.estimated_value, b.due_date,
             bs.win_probability AS score_win_prob, bs.ai_explanation,
             br.recommendation, br.summary AS rec_summary, br.win_probability AS rec_win_prob
      FROM bids b
      LEFT JOIN bid_scores bs ON bs.bid_id = b.id AND bs.user_id = ${userId}
      LEFT JOIN bid_recommendations br ON br.bid_id = b.id::text AND br.user_email = ${userEmail}
      WHERE bs.bid_id IS NOT NULL OR br.bid_id IS NOT NULL
      ORDER BY COALESCE(bs.win_probability, br.win_probability, 0) DESC
      LIMIT 10`;
    if (rows.length === 0) return "No bids scored or recommended yet.";
    return (rows as any[]).map((r) => {
      const score = r.score_win_prob != null ? Number(r.score_win_prob) : r.rec_win_prob != null ? Number(r.rec_win_prob) : null;
      const parts = [
        `- ${r.title} (${r.agency})`,
        r.set_aside ? `set-aside: ${r.set_aside}` : "set-aside: none",
        score != null ? `win probability: ${score}%` : "win probability: unscored",
        r.recommendation ? `recommendation: ${r.recommendation}` : "recommendation: none",
        r.estimated_value ? `value: ${r.estimated_value}` : "value: unknown",
      ];
      if (r.rec_summary) parts.push(`summary: ${r.rec_summary}`);
      if (r.ai_explanation) parts.push(`why: ${r.ai_explanation}`);
      return parts.join(" · ");
    }).join("\n");
  } catch {
    return "No bids scored or recommended yet.";
  }
}

/** Top 3 recurring weakness patterns from the user's lost bids. */
async function loadRecurringWeaknesses(userEmail: string): Promise<string> {
  try {
    const rows = await sql()`
      SELECT w->>'weakness' AS weakness, COUNT(*)::int AS count
      FROM bid_losses bl, jsonb_array_elements(bl.weaknesses) w
      WHERE bl.user_email = ${userEmail}
      GROUP BY w->>'weakness'
      ORDER BY count DESC
      LIMIT 3`;
    if (rows.length === 0) return "No recurring weaknesses tracked (no lost bids logged).";
    return (rows as any[]).map((r) => `- ${r.weakness} (${r.count}×)`).join("\n");
  } catch {
    return "No recurring weaknesses tracked (no lost bids logged).";
  }
}

/** Cached pricing recommendations for this user. */
async function loadPricing(userEmail: string): Promise<string> {
  try {
    await sql()`CREATE TABLE IF NOT EXISTS pricing_recommendations (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_id TEXT NOT NULL, bid_title TEXT NOT NULL, suggested_low DECIMAL(10,2), suggested_high DECIMAL(10,2), suggested_median DECIMAL(10,2), confidence INTEGER, comparable_awards JSONB DEFAULT '[]'::jsonb, rationale TEXT, pricing_strategy TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, bid_id))`;
    const rows = await sql()`
      SELECT bid_title, suggested_low, suggested_high, suggested_median, confidence, pricing_strategy
      FROM pricing_recommendations WHERE user_email = ${userEmail}
      ORDER BY created_at DESC LIMIT 5`;
    if (rows.length === 0) return "No cached pricing recommendations.";
    return (rows as any[]).map((r) => {
      const low = Number(r.suggested_low || 0);
      const high = Number(r.suggested_high || 0);
      const median = Number(r.suggested_median || 0);
      return `- ${r.bid_title}: $${low.toLocaleString()}–$${high.toLocaleString()} (median $${median.toLocaleString()}), strategy ${r.pricing_strategy || "competitive"}, confidence ${r.confidence != null ? r.confidence + "%" : "n/a"}`;
    }).join("\n");
  } catch {
    return "No cached pricing recommendations.";
  }
}

/**
 * Assembles the full Copilot context block for a user. Never throws — every
 * section is optional and degrades to a "no data" line when unavailable.
 */
export async function fetchCopilotContext(userEmail: string): Promise<string> {
  const userId = await findUserId(userEmail);
  const profile = await loadProfile(userId);

  const sections: string[] = [];

  // 1. Profile
  sections.push(profile ? buildProfileContext(profile) : "BUSINESS PROFILE:\n(No profile set up yet — mention that completing onboarding improves advice.)");

  // 2. Active bids (top 10)
  const bidsBlock = await loadActiveBids(userId, userEmail);
  sections.push(`ACTIVE BIDS (TOP 10 BY WIN PROBABILITY):\n${bidsBlock}`);

  // 3. Learning patterns (win/loss history, best NAICS/agencies, implicit preferences)
  let learningBlock = "";
  try {
    learningBlock = await getLearningContext(userEmail, "", "", "", "");
  } catch {
    learningBlock = "";
  }
  sections.push(`LEARNING PATTERNS (WIN/LOSS HISTORY):\n${learningBlock || "No win/loss history recorded yet."}`);

  // 4. Recent losses / recurring weaknesses
  const weaknessesBlock = await loadRecurringWeaknesses(userEmail);
  sections.push(`RECURRING WEAKNESSES (FROM LOST BIDS):\n${weaknessesBlock}`);

  // 5. Pricing data
  const pricingBlock = await loadPricing(userEmail);
  sections.push(`PRICING DATA:\n${pricingBlock}`);

  // 6. Knowledge base (RAG)
  const naicsQuery = profile?.naics_codes?.length ? profile.naics_codes.join(" ") : "";
  let knowledgeBlock = "";
  try {
    knowledgeBlock = await getRelevantContext(`government contracting strategy NAICS ${naicsQuery}`.trim());
  } catch {
    knowledgeBlock = "";
  }
  sections.push(`KNOWLEDGE BASE:\n${knowledgeBlock || "No relevant knowledge-base documents found."}`);

  return sections.join("\n\n");
}
