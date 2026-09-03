import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";
import { countRoleMatches } from "~/lib/healthcare";
import { ARCHIVED_STATUSES, LIVE_SQL, DEAD_SQL } from "~/lib/bid-status";
import { createDeadlineAlertsForUser } from "~/lib/notifications";
import { locationMatchesStates, naicsPred, setAsidePredMulti } from "~/lib/open-bids";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import type { BusinessProfile } from "~/components/CompanyProfile";

// Interfaces mirror src/routes/dashboard.tsx (kept local so this route is
// self-contained; the client casts the JSON response).
interface Bid {
  id: number; title: string; agency: string; description: string;
  location: string; category: string; set_aside: string | null; due_date: string; estimated_value: string;
  source_url: string | null; role_matches: number;
  naics_code: string | null; created_at: string;
}
interface BidSummary {
  bid_id: number; summary_text: string; key_requirements: string[];
  generated_at: string;
}
interface ClauseCitation {
  clause_number: string;
  title: string;
  full_text: string;
}
interface ProposalDraft {
  bid_id: number; draft_text: string; generated_at: string;
  citations: ClauseCitation[];
}
interface BidRecommendation {
  bid_id: string; bid_title: string; win_probability: number | null;
  effort_level: string; competition_level: string; strategic_fit: string;
  recommendation: "GO" | "NO_GO" | "CAUTIOUS"; summary: string;
  factors: { factor: string; impact: string }[]; created_at: string;
}
interface BidScore {
  bid_id: number; win_probability: number;
  competition_level: string;
  agency_sentiment: string;
  size_fit: string;
  experience_match: string;
  similar_awards_note: string;
  naics_match: string;
  role_fit: string;
  ai_explanation: string; generated_at: string;
}
interface SavedMatch { bid_id: number; status: string; }

// ── External-user search telemetry ──────────────────────────────────────────
// This dashboard-load is the authenticated user's live-matches feed, so each
// load represents them genuinely examining/searching the feed (initial visit,
// filter apply, or "broaden search" refresh). We record ONE row per user per
// 2-minute window (debounced via the NOT IN subquery) so a session that
// renders the feed repeatedly doesn't spam the table. Fire-and-forget: any
// failure is swallowed so telemetry can NEVER break the dashboard. Going
// forward only — there is no historical search data, so counts start at 0.
let userSearchesEnsured = false;
async function recordUserSearch(userId: number): Promise<void> {
  try {
    if (!userSearchesEnsured) {
      await sql()`CREATE TABLE IF NOT EXISTS user_searches (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`;
      await sql()`CREATE INDEX IF NOT EXISTS idx_user_searches_user_id ON user_searches (user_id)`;
      await sql()`CREATE INDEX IF NOT EXISTS idx_user_searches_created_at ON user_searches (created_at)`;
      userSearchesEnsured = true;
    }
    await sql()`INSERT INTO user_searches (user_id, created_at)
      SELECT ${userId}, NOW()
      WHERE ${userId} NOT IN (
        SELECT user_id FROM user_searches
        WHERE user_id = ${userId} AND created_at > NOW() - INTERVAL '2 minutes'
      )`;
  } catch {
    // Best-effort — never break the dashboard.
  }
}

async function handler({ request }: { request: Request }) {
  try {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  // Non-blocking search telemetry (swallows all errors internally).
  await recordUserSearch(Number(user.id));

  // Check for active_profile_id (agency entity switching)
  let activeProfileId: number | null = null;
  try {
    const userRows = await sql()`SELECT active_profile_id FROM users WHERE id = ${user.id}`;
    activeProfileId = (userRows[0] as any)?.active_profile_id ?? null;
  } catch { /* column may not exist yet */ }

  // Lazy migration guards for healthcare staffing + profile enrichment columns.
  try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS naics_codes JSONB DEFAULT '[]'::jsonb`; } catch {}
  try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS specialties JSONB DEFAULT '[]'::jsonb`; } catch {}
  try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS licenses JSONB DEFAULT '[]'::jsonb`; } catch {}
  try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS typical_contract_value TEXT`; } catch {}

  const PROFILE_COLUMNS = `id, business_name, industry, locations, service_categories, naics_codes, logo_url, is_agency, uei, cage_code, sam_expiration, duns, certifications, certification_dates, years_in_business, employee_count, annual_revenue, past_performance_summary, capability_statement, specialties, licenses, typical_contract_value`;
  // Interpolate the (hardcoded) column list as a RAW SQL fragment. Passing the
  // comma-separated string directly as a bound parameter would make Neon treat
  // the whole list as a single text value, so the SELECT returns one literal
  // column and every profile field comes back undefined (→ an empty profile in
  // the eligibility widget for ALL users, incl. freshly onboarded ones).
  const profileCols = sql().unsafe(PROFILE_COLUMNS);
  const profileRows = activeProfileId
    ? await sql()`SELECT ${profileCols} FROM business_profiles WHERE id = ${activeProfileId} AND user_id = ${user.id}`
    : await sql()`
      SELECT ${profileCols}
      FROM business_profiles WHERE user_id = ${user.id}`;
  let profile: BusinessProfile | null = null;
  if (profileRows.length > 0) {
    const p = profileRows[0] as any;
    profile = {
      id: p.id, business_name: p.business_name, industry: p.industry,
      locations: Array.isArray(p.locations) ? p.locations : [],
      service_categories: Array.isArray(p.service_categories) ? p.service_categories : [],
      naics_codes: Array.isArray(p.naics_codes) ? p.naics_codes : [],
      logo_url: p.logo_url ?? null,
      is_agency: Boolean(p.is_agency),
      uei: p.uei ?? null,
      cage_code: p.cage_code ?? null,
      sam_expiration: p.sam_expiration ? String(p.sam_expiration).slice(0, 10) : null,
      duns: p.duns ?? null,
      certifications: Array.isArray(p.certifications) ? p.certifications : [],
      certification_dates: p.certification_dates && typeof p.certification_dates === "object" && !Array.isArray(p.certification_dates) ? p.certification_dates : {},
      years_in_business: p.years_in_business ?? null,
      employee_count: p.employee_count ?? null,
      annual_revenue: p.annual_revenue ?? null,
      past_performance_summary: p.past_performance_summary ?? null,
      capability_statement: p.capability_statement ?? null,
      specialties: Array.isArray(p.specialties) ? p.specialties : [],
      licenses: Array.isArray(p.licenses) ? p.licenses : [],
      typical_contract_value: p.typical_contract_value ?? null,
    };
  }

  await sql()`CREATE TABLE IF NOT EXISTS bid_scores (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, bid_id INTEGER NOT NULL REFERENCES bids(id), win_probability INTEGER NOT NULL, competition_level TEXT NOT NULL, agency_sentiment TEXT NOT NULL, size_fit TEXT NOT NULL DEFAULT '', experience_match TEXT NOT NULL, similar_awards_note TEXT NOT NULL DEFAULT '', ai_explanation TEXT NOT NULL, generated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, bid_id))`;
  // Backward compat: add new columns if they don't exist yet (old DB may have match_score/naics_fit/similarity_notes/profitability_estimate)
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS win_probability INTEGER DEFAULT 50`; } catch {}
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS agency_sentiment TEXT DEFAULT ''`; } catch {}
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS size_fit TEXT DEFAULT ''`; } catch {}
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS experience_match TEXT DEFAULT ''`; } catch {}
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS similar_awards_note TEXT DEFAULT ''`; } catch {}
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS naics_match TEXT DEFAULT ''`; } catch {}
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS role_fit TEXT DEFAULT ''`; } catch {}

  // ── LIVE matched feed — routed through the authoritative SQL matcher ─────
  // DEFAULT MATCHED FEED = LIVE ONLY, profile-relevant. Previously this route
  // returned EVERY live bid and let the client's degenerate `matchBid` (which
  // auto-matched every bid for a NAICS-onboarded profile whose `industry` is an
  // empty string) inflate the count to the full national live table. Now the
  // SAME SQL predicates the onboarding "We found N" count uses (set-aside LIKE,
  // `naics_code = ANY(codes)`, `locationMatchesStates` on the returned rows,
  // LOW_CONTENT_SQL, DISTINCT ON(title, agency)) plus the live/archived split
  // (#199) run SERVER-SIDE, so the feed + count reflect true relevance.
  // set_aside / naics_code are migration-created columns present in
  // src/db/schema.sql — the old per-request `ALTER TABLE ... ADD COLUMN IF NOT
  // EXISTS` lazy-migration guards are removed (migration-only concern now).
  const locations = (profile?.locations ?? []).map((s) => String(s));
  const setAsideFrag = setAsidePredMulti(profile?.certifications ?? [], sql);
  const naicsFrag = naicsPred(profile?.naics_codes ?? [], sql);

  const bidRows = await sql()`
    SELECT * FROM (
      SELECT DISTINCT ON (title, agency)
        id, title, agency, description, location, category, set_aside, due_date,
        estimated_value, source_url, naics_code, created_at
      FROM bids
      WHERE ${sql().unsafe(LIVE_SQL)}
        AND ${sql().unsafe(LOW_CONTENT_SQL)}
        AND id NOT IN (
          SELECT bid_id FROM saved_matches WHERE user_id = ${user.id} AND status = ANY(${ARCHIVED_STATUSES})
        )
        ${setAsideFrag} ${naicsFrag}
      ORDER BY title, agency
    ) matched
    ORDER BY due_date ASC NULLS LAST`;
  const userSpecialties = profile?.specialties || [];
  // Geography filter applied POST-dedup (same `locationMatchesStates` the
  // onboarding count uses — nationwide = no-op, specific states = targeted).
  const bids: Bid[] = (bidRows as any[])
    .filter((b) => locationMatchesStates(b.location, locations))
    .map((b) => ({
      id: b.id, title: b.title, agency: b.agency, description: b.description,
      location: b.location, category: b.category, set_aside: b.set_aside ?? null,
      due_date: String(b.due_date),
      estimated_value: b.estimated_value, source_url: b.source_url,
      naics_code: b.naics_code ?? null,
      created_at: b.created_at ? String(b.created_at) : "",
      role_matches: countRoleMatches(b as any, userSpecialties),
    }));

  const matchRows = await sql()`SELECT bid_id, status FROM saved_matches WHERE user_id = ${user.id}`;
  const savedMatches: SavedMatch[] = (matchRows as any[]).map((m) => ({
    bid_id: m.bid_id, status: m.status,
  }));

  // Fetch summaries and drafts for this user's saved/viewable bids
  const summaryRows = await sql()`SELECT bid_id, summary_text, key_requirements, generated_at FROM bid_summaries`;
  const summaries: BidSummary[] = (summaryRows as any[]).map((s) => ({
    bid_id: s.bid_id,
    summary_text: s.summary_text,
    key_requirements: Array.isArray(s.key_requirements) ? s.key_requirements : [],
    generated_at: String(s.generated_at),
  }));

  // Fetch scores with backward compat: try new columns first, fall back to old names
  let scoreRows: any[];
  try {
    scoreRows = await sql()`SELECT bid_id, win_probability, competition_level, agency_sentiment, size_fit, experience_match, similar_awards_note, naics_match, role_fit, ai_explanation, generated_at FROM bid_scores WHERE user_id = ${user.id}`;
  } catch {
    // Fallback: old schema with match_score/naics_fit/similarity_notes/profitability_estimate
    const oldRows = await sql()`SELECT bid_id, match_score, competition_level, naics_fit, similarity_notes, profitability_estimate, ai_explanation, generated_at FROM bid_scores WHERE user_id = ${user.id}`;
    scoreRows = (oldRows as any[]).map((r: any) => ({
      bid_id: r.bid_id,
      win_probability: Number(r.match_score),
      competition_level: r.competition_level,
      agency_sentiment: r.naics_fit || '',
      size_fit: r.profitability_estimate || '',
      experience_match: r.similarity_notes || '',
      similar_awards_note: '',
      naics_match: '',
      role_fit: '',
      ai_explanation: r.ai_explanation,
      generated_at: String(r.generated_at),
    }));
  }
  const scores: BidScore[] = (scoreRows as any[]).map((s) => ({ bid_id: s.bid_id, win_probability: Number(s.win_probability), competition_level: s.competition_level, agency_sentiment: s.agency_sentiment || '', size_fit: s.size_fit || '', experience_match: s.experience_match || '', similar_awards_note: s.similar_awards_note || '', naics_match: s.naics_match || '', role_fit: s.role_fit || '', ai_explanation: s.ai_explanation, generated_at: String(s.generated_at) }));

  await sql()`CREATE TABLE IF NOT EXISTS bid_recommendations (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_id TEXT NOT NULL, bid_title TEXT NOT NULL, win_probability INTEGER, effort_level TEXT DEFAULT 'medium', competition_level TEXT DEFAULT 'medium', strategic_fit TEXT DEFAULT 'moderate', recommendation TEXT DEFAULT 'CAUTIOUS', summary TEXT DEFAULT '', factors JSONB DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, bid_id))`;
  const recommendationRows = await sql()`SELECT bid_id, bid_title, win_probability, effort_level, competition_level, strategic_fit, recommendation, summary, factors, created_at FROM bid_recommendations WHERE user_email = ${user.email}`;
  const recommendations: BidRecommendation[] = (recommendationRows as any[]).map((r) => ({ ...r, bid_id: String(r.bid_id), win_probability: r.win_probability == null ? null : Number(r.win_probability), factors: Array.isArray(r.factors) ? r.factors : [], created_at: String(r.created_at) }));

  // Lazy migration for FAR-grounded drafting citations (same pattern as the
  // business_profiles ALTERs below).
  try { await sql()`ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS citations JSONB DEFAULT '[]'::jsonb`; } catch {}
  // Part B — pending draft (the score → signup draft promise): latest row for
  // this user, so the dashboard can show an honest ready/processing state
  // instead of a dead end when a draft is awaiting or fulfilled.
  let pendingDraft: { id: number; status: string; has_draft_text: boolean } | null = null;
  try {
    await sql()`CREATE TABLE IF NOT EXISTS pending_drafts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      solicitation_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'awaiting_profile',
      draft_text TEXT,
      citations JSONB DEFAULT '[]'::jsonb,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      fulfilled_at TIMESTAMPTZ
    )`;
    const pendingRows = await sql()`SELECT id, status, (draft_text IS NOT NULL) AS has_draft_text FROM pending_drafts WHERE user_id = ${user.id} ORDER BY id DESC LIMIT 1`;
    if (pendingRows.length > 0) {
      const p = pendingRows[0] as any;
      pendingDraft = { id: Number(p.id), status: String(p.status), has_draft_text: p.has_draft_text === true };
    }
  } catch { /* non-blocking */ }

  const draftRows = await sql()`SELECT bid_id, draft_text, generated_at, citations FROM proposal_drafts WHERE user_id = ${user.id}`;
  const drafts: ProposalDraft[] = (draftRows as any[]).map((d) => ({
    bid_id: d.bid_id,
    draft_text: d.draft_text,
    generated_at: String(d.generated_at),
    citations: Array.isArray(d.citations) ? (d.citations as ClauseCitation[]) : [],
  }));

  const syncRows = await sql()`SELECT created_at FROM sync_logs ORDER BY created_at DESC LIMIT 1`;
  const lastSynced = syncRows.length > 0 ? String(syncRows[0].created_at) : null;
  const countRows = await sql()`SELECT COUNT(*) as count FROM bids`;
  const totalBids = countRows.length > 0 ? Number(countRows[0].count) : 0;
  // Archived = closed/no-go (due strictly before today) OR dismissed/closed by
  // this user, further filtered to the SAME profile relevance as the live feed
  // (set-aside + NAICS SQL predicates + location), so the Archived-tab badge
  // matches the relevant dead list served by /api/dashboard-archive.
  let archivedCount = 0;
  try {
    const archRows = await sql()`
      SELECT DISTINCT ON (title, agency) title, agency, location
      FROM bids
      WHERE (${sql().unsafe(DEAD_SQL)}
         OR id IN (SELECT bid_id FROM saved_matches WHERE user_id = ${user.id} AND status = ANY(${ARCHIVED_STATUSES})))
        AND ${sql().unsafe(LOW_CONTENT_SQL)}
        ${setAsideFrag} ${naicsFrag}
      ORDER BY title, agency`;
    archivedCount = (archRows as any[]).filter((r) => locationMatchesStates(r.location, locations)).length;
  } catch {}
  let lossesCount = 0;
  try { const lossRows = await sql()`SELECT COUNT(*) as count FROM bid_losses WHERE user_email = ${user.email}`; lossesCount = Number(lossRows[0]?.count || 0); } catch {}

  // Urgent tracked bids count (due within 3 days)
  let topCompetitor: { name: string; awards: number } | null = null;
  let activeAwardees = 0;
  try {
    const codes = (profile?.naics_codes || []).map(String);
    const rows = codes.length ? await sql()`SELECT winning_company, COUNT(*)::int AS awards FROM awarded_contracts WHERE winning_company IS NOT NULL AND naics_code = ANY(${codes}) GROUP BY winning_company ORDER BY awards DESC LIMIT 1` : [];
    topCompetitor = rows[0] ? { name: String((rows[0] as any).winning_company), awards: Number((rows[0] as any).awards) } : null;
    const count = codes.length ? await sql()`SELECT COUNT(DISTINCT winning_company)::int AS count FROM awarded_contracts WHERE winning_company IS NOT NULL AND naics_code = ANY(${codes})` : [];
    activeAwardees = Number((count[0] as any)?.count || 0);
  } catch {}
  let urgentTrackedCount = 0;
  try {
    await sql()`CREATE TABLE IF NOT EXISTS tracked_bids (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_id TEXT NOT NULL, bid_title TEXT NOT NULL, agency TEXT NOT NULL, due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'tracked', last_checked TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, bid_id))`;
    const urgentRows = await sql()`SELECT COUNT(*) as count FROM tracked_bids WHERE user_email = ${user.email} AND due_date::date <= (NOW() + INTERVAL '3 days')::date AND due_date::date >= NOW()::date`;
    urgentTrackedCount = Number(urgentRows[0]?.count || 0);
  } catch { /* tracking table may not exist yet */ }

  // Best-effort: generate deadline alert notifications for this user
  try { createDeadlineAlertsForUser(user.id, user.email).catch(() => {}); } catch { /* non-blocking */ }

  let unreadAlerts = 0; try { const ar = await sql()`SELECT COUNT(*)::int AS count FROM bid_alerts WHERE user_id = ${user.id} AND is_read=false`; unreadAlerts = Number((ar[0] as any)?.count || 0); } catch {}
  return Response.json({ profile, bids, savedMatches, summaries, drafts, scores, recommendations, pricing: [], lastSynced, totalBids, matchCount: bids.length, archivedCount, lossesCount, urgentTrackedCount, topCompetitor, activeAwardees, unreadAlerts, pendingDraft });
  } catch (err) {
    console.error("[api/dashboard-data] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load dashboard data" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/dashboard-data")({
  server: { handlers: { GET: handler } },
});
