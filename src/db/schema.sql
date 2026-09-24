-- Contrax Database Schema
-- Tables for users, business profiles, bids, saved matches, and sessions

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    company_name TEXT,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    stripe_customer_id TEXT,
    subscription_status TEXT,
    plan_tier TEXT,
    trial_started_at TIMESTAMPTZ,
    -- Migration 042 (plan-tier lifecycle hardening, owner 2026-09-18): the end
    -- of the paid period for the Starter/Professional/Agency subscription. The
    -- verified Stripe webhook is the only writer; NULL when Stripe did not
    -- report a period end (never guessed).
    subscription_current_period_end TIMESTAMPTZ,
    active_profile_id INTEGER,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS google_accounts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    google_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    business_name TEXT NOT NULL,
    industry TEXT NOT NULL,
    locations JSONB NOT NULL DEFAULT '[]',
    service_categories JSONB NOT NULL DEFAULT '[]',
    naics_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    logo_url TEXT,
    is_agency BOOLEAN NOT NULL DEFAULT FALSE,
    uei TEXT,
    cage_code TEXT,
    sam_expiration DATE,
    duns TEXT,
    certifications JSONB DEFAULT '[]'::jsonb,
    certification_dates JSONB DEFAULT '{}'::jsonb,
    years_in_business INTEGER,
    employee_count INTEGER,
    annual_revenue TEXT,
    past_performance_summary TEXT,
    capability_statement TEXT,
    specialties JSONB DEFAULT '[]'::jsonb,
    licenses JSONB DEFAULT '[]'::jsonb,
    typical_contract_value TEXT
);

-- Agency migrations: preserve existing installations while enabling entities.
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_profile_id INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS is_agency BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS uei TEXT;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS cage_code TEXT;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS sam_expiration DATE;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS duns TEXT;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS certifications JSONB DEFAULT '[]'::jsonb;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS certification_dates JSONB DEFAULT '{}'::jsonb;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS years_in_business INTEGER;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS employee_count INTEGER;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS annual_revenue TEXT;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS past_performance_summary TEXT;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS capability_statement TEXT;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS specialties JSONB DEFAULT '[]'::jsonb;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS licenses JSONB DEFAULT '[]'::jsonb;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS typical_contract_value TEXT;

CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    key_hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT 'Default key',
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    revoked BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS bids (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    agency TEXT NOT NULL,
    description TEXT,
    location TEXT,
    category TEXT,
    set_aside TEXT,
    due_date TIMESTAMPTZ,
    estimated_value TEXT,
    source_url TEXT,
    source TEXT NOT NULL DEFAULT 'sam_gov',
    external_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS bid_alerts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    bid_id INTEGER NOT NULL REFERENCES bids(id),
    alert_type TEXT DEFAULT 'new_match',
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, bid_id, alert_type)
);

CREATE TABLE IF NOT EXISTS saved_matches (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    bid_id INTEGER REFERENCES bids(id),
    status TEXT DEFAULT 'new',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, bid_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    token TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_logs (
    id SERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    fetched INT DEFAULT 0,
    new INT DEFAULT 0,
    errors TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration: Add source/external_id columns to existing bids table if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bids' AND column_name='source') THEN
        ALTER TABLE bids ADD COLUMN source TEXT NOT NULL DEFAULT 'sam_gov';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bids' AND column_name='external_id') THEN
        ALTER TABLE bids ADD COLUMN external_id TEXT;
    END IF;
END $$;

-- Migration: Add UNIQUE constraint if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bids_source_external_id_key'
    ) THEN
        UPDATE bids SET external_id = 'seed-legacy-' || id::text WHERE external_id IS NULL;
        ALTER TABLE bids ADD CONSTRAINT bids_source_external_id_key UNIQUE (source, external_id);
    END IF;
END $$;

-- Migration: Add set_aside column to existing bids table if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bids' AND column_name='set_aside') THEN
        ALTER TABLE bids ADD COLUMN set_aside TEXT;
    END IF;
END $$;

-- Migration: cached AI RFP Executive Summary (JSONB) + generation timestamp.
-- Used by /api/bids/:id/analyze to avoid re-charging the LLM on repeat views.
ALTER TABLE bids ADD COLUMN IF NOT EXISTS ai_summary JSONB;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS ai_summary_at TIMESTAMPTZ;

-- Migration 047 (owner PRIORITY 09-21, R2 — PRESERVE rule): the Product Service
-- Code, the notice TYPE and SAM's own solicitation number. Additive / nullable /
-- no backfill; a source that cannot supply a value leaves it NULL.
ALTER TABLE bids ADD COLUMN IF NOT EXISTS psc text;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS notice_type text;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS solicitation_number text;
-- Cross-source dedupe support (R5): sparse, non-unique by design — the same
-- federal notice legitimately appears under more than one source label and this
-- PR never deletes rows.
CREATE INDEX IF NOT EXISTS idx_bids_solicitation_number
  ON bids (solicitation_number) WHERE solicitation_number IS NOT NULL;
-- Migration 048 (owner 2026-09-22, run-level dedupe hardening): the natural key
-- (title, agency, notice_type, due_date, psc) became a UNIQUE index, so a race
-- between two CONCURRENT Phase-2 sources can no longer store the same notice
-- twice. GRANDFATHERED: the WHERE predicate limits enforcement to rows inserted
-- from the frozen cutoff forward — the 4,059 pre-existing duplicate groups
-- (14,690 rows) stay untouched, because deleting them is a separate,
-- owner-gated reconciliation. NULLS NOT DISTINCT + COALESCE(text,'') keep this
-- index dimension-for-dimension identical to the in-memory key in
-- src/jobs/runner.ts (batchInsertNaturalKey). A bootstrap built from this file
-- therefore carries the same enforcement as production. The runner classifies a
-- 23505 naming this index as *deduped*, not *failed*.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_natural_key_unique
  ON bids (
    lower(btrim(title)),
    lower(btrim(agency)),
    COALESCE(notice_type, ''),
    due_date,
    COALESCE(psc, '')
  )
  NULLS NOT DISTINCT
  WHERE created_at >= TIMESTAMPTZ '2026-09-22 00:00:00+00';

-- Migration: bids.source default aligns with the canonical SAM.gov source
-- (city procurement feeds are stored under their own source values, e.g.
-- nyc_open_data). The ALTER is a no-op when the default is already set.
DO $$
BEGIN
    ALTER TABLE bids ALTER COLUMN source SET DEFAULT 'sam_gov';
END $$;

CREATE TABLE IF NOT EXISTS bid_summaries (
    id SERIAL PRIMARY KEY,
    bid_id INTEGER UNIQUE REFERENCES bids(id),
    summary_text TEXT NOT NULL,
    key_requirements JSONB DEFAULT '[]',
    generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proposal_drafts (
    id SERIAL PRIMARY KEY,
    bid_id INTEGER REFERENCES bids(id),
    user_id INTEGER REFERENCES users(id),
    draft_text TEXT NOT NULL,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(bid_id, user_id)
);
CREATE TABLE IF NOT EXISTS pending_drafts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    solicitation_text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'awaiting_profile',
    draft_text TEXT,
    citations JSONB DEFAULT '[]'::jsonb,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    fulfilled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pending_drafts_user_status ON pending_drafts (user_id, status);

CREATE TABLE IF NOT EXISTS analytics_events (
    id SERIAL PRIMARY KEY,
    path TEXT NOT NULL,
    referrer TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_feedback (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    session_id TEXT,
    context TEXT NOT NULL,
    solicitation_ref TEXT,
    ai_output_summary TEXT,
    was_helpful BOOLEAN,
    unhelpful_reason TEXT,
    unhelpful_detail TEXT,
    did_bid BOOLEAN,
    did_win BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS waitlist (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    source TEXT DEFAULT 'landing_page',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration 002: Add Stripe columns to existing users table if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='stripe_customer_id') THEN
        ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='subscription_status') THEN
        ALTER TABLE users ADD COLUMN subscription_status TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='plan_tier') THEN
        ALTER TABLE users ADD COLUMN plan_tier TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='trial_started_at') THEN
        ALTER TABLE users ADD COLUMN trial_started_at TIMESTAMPTZ;
    END IF;
    -- Migration 042: plan-tier subscription period end (see above).
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='subscription_current_period_end') THEN
        ALTER TABLE users ADD COLUMN subscription_current_period_end TIMESTAMPTZ;
    END IF;
END $$;

-- Savings product tables
CREATE TABLE IF NOT EXISTS savings_diagnoses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    bill_type TEXT,
    provider_name TEXT,
    current_amount DECIMAL(10,2),
    diagnosis_json JSONB,
    savings_prescription JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS savings_bills (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    bill_type TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    current_amount DECIMAL(10,2) NOT NULL,
    billing_cycle TEXT DEFAULT 'monthly',
    next_due_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration: Add naics_codes column to existing business_profiles table if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='business_profiles' AND column_name='naics_codes') THEN
        ALTER TABLE business_profiles ADD COLUMN naics_codes JSONB DEFAULT '[]'::jsonb;
    END IF;
END $$;

-- AI loss analysis
CREATE TABLE IF NOT EXISTS bid_losses (
    id SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    bid_title TEXT NOT NULL,
    agency TEXT NOT NULL,
    estimated_value TEXT,
    awarded_to TEXT,
    debrief_notes TEXT,
    naics_code TEXT,
    weaknesses JSONB DEFAULT '[]'::jsonb,
    primary_reason TEXT,
    severity TEXT,
    actionable_fix TEXT,
    recurring_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bid / No-Bid AI recommendations
CREATE TABLE IF NOT EXISTS bid_recommendations (
    id SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    bid_id TEXT NOT NULL,
    bid_title TEXT NOT NULL,
    win_probability INTEGER,
    effort_level TEXT NOT NULL DEFAULT 'medium',
    competition_level TEXT NOT NULL DEFAULT 'medium',
    strategic_fit TEXT NOT NULL DEFAULT 'moderate',
    recommendation TEXT NOT NULL DEFAULT 'CAUTIOUS',
    summary TEXT NOT NULL DEFAULT '',
    factors JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_email, bid_id)
);

-- Backward-compatible recommendation migrations
ALTER TABLE bid_recommendations ADD COLUMN IF NOT EXISTS bid_title TEXT DEFAULT '';
ALTER TABLE bid_recommendations ADD COLUMN IF NOT EXISTS win_probability INTEGER;
ALTER TABLE bid_recommendations ADD COLUMN IF NOT EXISTS effort_level TEXT DEFAULT 'medium';
ALTER TABLE bid_recommendations ADD COLUMN IF NOT EXISTS competition_level TEXT DEFAULT 'medium';
ALTER TABLE bid_recommendations ADD COLUMN IF NOT EXISTS strategic_fit TEXT DEFAULT 'moderate';
ALTER TABLE bid_recommendations ADD COLUMN IF NOT EXISTS recommendation TEXT DEFAULT 'CAUTIOUS';
ALTER TABLE bid_recommendations ADD COLUMN IF NOT EXISTS summary TEXT DEFAULT '';
ALTER TABLE bid_recommendations ADD COLUMN IF NOT EXISTS factors JSONB DEFAULT '[]'::jsonb;
ALTER TABLE bid_recommendations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Partner directory and matching data
CREATE TABLE IF NOT EXISTS partner_companies (
    id SERIAL PRIMARY KEY,
    company_name TEXT NOT NULL,
    capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
    naics_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
    past_awards JSONB NOT NULL DEFAULT '[]'::jsonb,
    location TEXT,
    contact_info TEXT,
    partner_type TEXT NOT NULL DEFAULT 'both',
    rating INTEGER DEFAULT 3,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS naics_codes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS past_awards JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS contact_info TEXT;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS partner_type TEXT DEFAULT 'both';
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS rating INTEGER DEFAULT 3;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS description TEXT;

-- Migration: Add naics_match column to bid_scores if missing.
-- GUARDED ON THE TABLE ITSELF: schema.sql never creates `bid_scores` (it is a
-- backward-compat tweak for installs that have it), so on a fresh database this
-- block must be a no-op. Unguarded it aborts the whole bootstrap with
-- `relation "bid_scores" does not exist` — the second pre-existing defect the
-- state-grants bootstrap test surfaced, on a path (src/db/setup.ts) that had not
-- run against an empty database in a long time. Same idiom as the
-- funnel_events guard further down this file.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bid_scores' AND relkind = 'r')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bid_scores' AND column_name='naics_match') THEN
        ALTER TABLE bid_scores ADD COLUMN naics_match TEXT DEFAULT '';
    END IF;
END $$;

-- Competitive Pricing Engine
CREATE TABLE IF NOT EXISTS pricing_recommendations (
    id SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    bid_id TEXT NOT NULL,
    bid_title TEXT NOT NULL,
    suggested_low DECIMAL(10,2),
    suggested_high DECIMAL(10,2),
    suggested_median DECIMAL(10,2),
    confidence INTEGER,
    comparable_awards JSONB DEFAULT '[]'::jsonb,
    rationale TEXT,
    pricing_strategy TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_email, bid_id)
);

-- Backward-compatible pricing_recommendations migrations
ALTER TABLE pricing_recommendations ADD COLUMN IF NOT EXISTS bid_title TEXT DEFAULT '';
ALTER TABLE pricing_recommendations ADD COLUMN IF NOT EXISTS comparable_awards JSONB DEFAULT '[]'::jsonb;
ALTER TABLE pricing_recommendations ADD COLUMN IF NOT EXISTS rationale TEXT;
ALTER TABLE pricing_recommendations ADD COLUMN IF NOT EXISTS pricing_strategy TEXT;
ALTER TABLE pricing_recommendations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Deadline & Amendment Tracker
CREATE TABLE IF NOT EXISTS tracked_bids (
    id SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    bid_id TEXT NOT NULL,
    bid_title TEXT NOT NULL,
    agency TEXT NOT NULL,
    due_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'tracked',
    last_checked TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_email, bid_id)
);

CREATE TABLE IF NOT EXISTS bid_amendments (
    id SERIAL PRIMARY KEY,
    bid_id TEXT NOT NULL,
    change_type TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    detected_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for amendment lookups
CREATE INDEX IF NOT EXISTS idx_bid_amendments_bid_id ON bid_amendments(bid_id);
CREATE INDEX IF NOT EXISTS idx_tracked_bids_user_email ON tracked_bids(user_email);

-- Learning Engine — win/loss outcomes feed back into AI predictions
CREATE TABLE IF NOT EXISTS learning_outcomes (
    id SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    bid_title TEXT NOT NULL,
    agency TEXT NOT NULL,
    naics_code TEXT DEFAULT '',
    estimated_value TEXT DEFAULT '',
    won BOOLEAN NOT NULL,
    notes TEXT DEFAULT '',
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pre-computed award trend analytics (recomputed on demand and safe for existing installs)
CREATE TABLE IF NOT EXISTS award_trends_cache (
    id SERIAL PRIMARY KEY,
    trend_type TEXT NOT NULL,
    period TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    computed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(trend_type, period)
);

-- Agency-tier integrations (OAuth-connected external services)
CREATE TABLE IF NOT EXISTS integrations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL CHECK (provider IN ('google_calendar', 'outlook_calendar', 'slack', 'teams', 'google_drive', 'onedrive')),
    access_token TEXT,
    refresh_token TEXT,
    status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('active', 'disconnected')),
    connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, provider)
);

-- In-app notifications
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK (type IN ('deadline_alert', 'new_bid_match', 'team_activity')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    bid_id INTEGER REFERENCES bids(id),
    read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);

-- Healthcare staffing: cached AI healthcare summaries (structured sections).
CREATE TABLE IF NOT EXISTS healthcare_bid_summaries (
    id SERIAL PRIMARY KEY,
    bid_id INTEGER UNIQUE REFERENCES bids(id),
    summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Knowledge base: searchable document library powering RAG retrieval for AI features.
-- pgvector is optional — some managed Postgres instances don't ship the extension.
-- The table is created WITHOUT the embedding column so migrations never fail;
-- the vector column is added below only when the `vector` type is available.
-- Full-text ILIKE search is the MVP retrieval path regardless.
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS vector; EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS knowledge_documents (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    title TEXT NOT NULL,
    doc_type TEXT NOT NULL CHECK (doc_type IN ('capability_statement', 'proposal_template', 'compliance_checklist', 'solicitation', 'faq', 'guide', 'other')),
    content TEXT NOT NULL,
    description TEXT,
    is_public BOOLEAN NOT NULL DEFAULT false,
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Add the embedding column only if pgvector became available (guarded).
DO $$ BEGIN ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS embedding VECTOR(1536); EXCEPTION WHEN OTHERS THEN NULL; END $$;
-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_knowledge_content ON knowledge_documents USING GIN (to_tsvector('english', content));
CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge_documents (doc_type);

-- Contract Intelligence Copilot — persistent chat message history.
CREATE TABLE IF NOT EXISTS copilot_messages (
    id SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Backward-compatible copilot_messages migration (older installs)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='copilot_messages' AND column_name='role') THEN
        ALTER TABLE copilot_messages ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
    END IF;
END $$;

-- Index for loading a user's recent chat history
CREATE INDEX IF NOT EXISTS idx_copilot_messages_user_created ON copilot_messages(user_email, created_at);

-- Knowledge-base semantic retrieval (pgvector is optional at bootstrap).
CREATE TABLE IF NOT EXISTS knowledge_documents (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    title TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    content TEXT NOT NULL,
    description TEXT,
    is_public BOOLEAN NOT NULL DEFAULT false,
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
    ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS embedding VECTOR(1536);
    CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON knowledge_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- FAR/DFARS regulatory knowledge base — exact clause text for AI citation.
-- Populated by /api/sync-far (admin button + daily cron) from acquisition.gov
-- compiled HTML; bootstrapped from the bundled seed on first query when empty.
CREATE TABLE IF NOT EXISTS far_clauses (
    id SERIAL PRIMARY KEY,
    clause_number TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    part TEXT,
    subpart TEXT,
    section TEXT,
    full_text TEXT NOT NULL,
    source TEXT DEFAULT 'far',
    last_updated TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_far_clauses_search ON far_clauses USING gin(to_tsvector('english', title || ' ' || full_text));
-- Stored weighted tsvector backing retrieveRelevantClauses' fast ts_rank
-- ordering (title weight A = 3x, full-text weight B). Matches identically to
-- the expression form; it is only a precompute. Runtime path (lazy migration):
-- ensureFarClausesTable() in src/lib/far-dfars.ts.
ALTER TABLE far_clauses ADD COLUMN IF NOT EXISTS search_tsv tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', full_text), 'B')) STORED;
CREATE INDEX IF NOT EXISTS idx_far_clauses_search_tsv ON far_clauses USING gin(search_tsv);
CREATE INDEX IF NOT EXISTS idx_far_clauses_source ON far_clauses (source);

-- Per-visitor SUMMARY cache for the Visitor Journeys board (Admin Tracker
-- Enrichment, owner 2026-08-31). Upserted at intake by the single beacon
-- endpoint /api/track-visitor (src/lib/tracking-intake.ts) for fast admin
-- display; funnel_events + page_views remain the detailed history. Idempotent;
-- mirrored by db/migrations/021_visitors.sql. first_ip/last_ip are available
-- only on authenticated admin pages and are automatically cleared after the
-- disclosed retention window.
CREATE TABLE IF NOT EXISTS visitors (
    visitor_id TEXT PRIMARY KEY,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_path TEXT,
    last_path TEXT,
    first_ip TEXT,
    last_ip TEXT,
    city TEXT,
    region TEXT,
    device_type TEXT,
    browser_label TEXT,
    source TEXT,
    radar BOOLEAN NOT NULL DEFAULT FALSE,
    signup TEXT NOT NULL DEFAULT 'Not started',
    activated BOOLEAN NOT NULL DEFAULT FALSE,
    steps INTEGER NOT NULL DEFAULT 0,
    sessions INTEGER NOT NULL DEFAULT 0,
    last_visit_id TEXT,
    last_action TEXT,
    last_action_at TIMESTAMPTZ,
    converted_user_id TEXT,
    converted_at TIMESTAMPTZ,
    saw_pricing BOOLEAN NOT NULL DEFAULT FALSE,
    saw_brief BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_visitors_last_seen_at ON visitors (last_seen_at);

-- Append-only record of authenticated admin access to raw visitor network
-- identifiers. Runtime creation in /api/admin/visitor-intel keeps older
-- deployments fail-closed until this canonical schema is applied.
CREATE TABLE IF NOT EXISTS admin_network_access_audit (
    id BIGSERIAL PRIMARY KEY,
    admin_user_id INTEGER NOT NULL,
    admin_email TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_network_access_audit_time
    ON admin_network_access_audit (accessed_at DESC);

-- Privacy-safe Radar criteria for anonymous visitors who complete a scan.
-- One current snapshot per first-party visitor id; deliberately excludes
-- email, phone, IP address and user agent. Runtime creation in
-- /api/radar/profile keeps older databases backward-compatible.
CREATE TABLE IF NOT EXISTS anonymous_radar_profiles (
    visitor_id TEXT PRIMARY KEY,
    visit_id TEXT,
    trade TEXT,
    state TEXT,
    cert TEXT NOT NULL,
    size_pref TEXT NOT NULL,
    matched_count INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bid Scout subscriptions (owner spec 2026-09-10) — Phase A purchase path.
-- One row per Bid Scout checkout/intake submission. The row is created with
-- status 'pending' BEFORE Stripe Checkout so a lost webhook can never lose a
-- lead; webhook events then transition it pending -> active / past_due /
-- cancelled. The `source` column stores the Bid Scout CTA source (placement
-- param, e.g. ?source=dashboard) — NOT first-touch acquisition attribution,
-- which stays on the visitor row and is never overwritten by this table.
CREATE TABLE IF NOT EXISTS bid_scout_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER REFERENCES users(id),
    email TEXT NOT NULL,
    company_name TEXT NOT NULL,
    website TEXT,
    capabilities TEXT NOT NULL,
    naics_codes TEXT,
    certifications TEXT,
    target_states TEXT,
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'bid_scout_page',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'past_due', 'cancelled')),
    stripe_checkout_session_id TEXT UNIQUE,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bid_scout_subscriptions_email
    ON bid_scout_subscriptions (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_bid_scout_subscriptions_status
    ON bid_scout_subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_bid_scout_subscriptions_user_id
    ON bid_scout_subscriptions (user_id);

-- Migration 036 — Bid Scout Founders first-five offer columns (owner 2026-09-11).
-- Additive + nullable; existing table semantics untouched. offer_code is written
-- by the webhook from Stripe's completed-session numbers (NEVER offerCandidate).
ALTER TABLE bid_scout_subscriptions
    ADD COLUMN IF NOT EXISTS offer_code text,
    ADD COLUMN IF NOT EXISTS first_invoice_amount integer,
    ADD COLUMN IF NOT EXISTS currency text;
CREATE INDEX IF NOT EXISTS idx_bid_scout_subscriptions_offer_code
    ON bid_scout_subscriptions (offer_code) WHERE offer_code IS NOT NULL;
-- Migration 037 — funnel_events.dedupe_key: server-side duplicate suppression
-- for the signup one-shot family (owner 09-12, PR #374 extension, gates a–d).
-- Guarded with IF EXISTS / a DO block because funnel_events is created lazily
-- by the intake DDL guard (src/lib/tracking-intake.ts), not by this schema —
-- on a fresh database the source table may not exist yet, and these statements
-- must no-op rather than fail setup. Idempotent — safe to re-run.
ALTER TABLE IF EXISTS funnel_events
    ADD COLUMN IF NOT EXISTS dedupe_key text;
ALTER TABLE IF EXISTS funnel_events
    ADD COLUMN IF NOT EXISTS dedupe_status text;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'funnel_events' AND relkind = 'r'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_funnel_events_dedupe_key
      ON funnel_events (dedupe_key) WHERE dedupe_key IS NOT NULL;
  END IF;
END $$;


-- ── Contrax Grants subscriptions (migration 039, owner 2026-09-17) ──
-- Mirrors db/migrations/039_grants_subscriptions.sql (idempotent).
-- Migration 039 — Contrax Grants subscriptions (owner order 2026-09-17).
--
-- One row per Contrax Grants ($19/month) Stripe subscription. The row is the
-- ONLY source of truth for grant access: entitlement is read from the stored
-- `status` (+ `current_period_end`) which is written exclusively by verified
-- Stripe webhooks (handleStripeWebhook → handleGrantsSubscriptionEvent). The
-- ?checkout=success redirect parameter NEVER grants access — it only drives a
-- client-side toast.
--
-- Conventions mirror bid_scout_subscriptions (migration 035): UUID pk,
-- gen_random_uuid(), a CHECK-constrained `status`, UNIQUE Stripe ids, and
-- created_at/updated_at timestamptz. Additive + idempotent — safe to re-run.
--
-- Allowed statuses are the Stripe subscription statuses; entitlement grants on
-- 'active' and 'trialing' ONLY (see GRANTS_GRANTED_STATUSES in
-- src/lib/grants-subscription.server.ts) — everything else is no-access.
--
-- Mirrored in src/db/schema.sql (canonical merged schema, applied by
-- `bun run src/db/setup.ts`) and in db/migrations/run-041.ts (idempotent runner).
CREATE TABLE IF NOT EXISTS grants_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER REFERENCES users(id),
    email TEXT,
    status TEXT NOT NULL DEFAULT 'incomplete'
        CHECK (status IN (
            'incomplete', 'incomplete_expired', 'trialing', 'active',
            'past_due', 'canceled', 'unpaid', 'paused'
        )),
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT UNIQUE,
    stripe_checkout_session_id TEXT UNIQUE,
    price_id TEXT,
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_grants_subscriptions_user_id
    ON grants_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_grants_subscriptions_customer_id
    ON grants_subscriptions (stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_grants_subscriptions_status
    ON grants_subscriptions (status);

-- ── State Grants (migrations 043 + 044; owner ROLLOUT order 2026-09-18, plus the
--    owner's 2026-09-19 P1 corrections in 044) ──
-- Mirrors BOTH db/migrations/043_state_grants.sql AND
-- db/migrations/044_state_grants_sources.sql (additive + idempotent; replayed by
-- db/migrations/run-043.ts and run-044.ts). A database built from THIS FILE ALONE
-- must be functionally identical to one built by applying 043 and then 044, so
-- the shape below is the POST-044 shape — the mirror 044 was deliberately NOT
-- given in R1 is closed here, and
-- src/lib/state-grants/state-grants-bootstrap.test.ts proves the equivalence by
-- diffing the two structures (columns, indexes, constraints) and then exercising
-- the part 2 search + coverage surface on the schema.sql-only database.
--
-- Part 1 of the state rollout: the stored corpus for STATE-level grant
-- opportunities, which (unlike Grants.gov) has no national API and therefore has
-- to persist between scheduled scrapes. Isolated from the federal product:
-- /grants, /api/grants/search, its freshness logic, events and pricing never read
-- these tables.
--
-- state_grant_sources (044): the registry of the official sources we read. A
-- row's identity is (source_id, external_id) — the SOURCE, never the state —
-- because two agencies in one state routinely publish the same short program id.
-- The seed row below is the only validated source today (Virginia, the reference
-- connector).
-- state_grant_opportunities: one row per source opportunity, keyed by
-- (source_id, external_id) by the unique index further down, so a re-published
-- (amended) record updates the SAME row. `fingerprint` is a CONTENT hash used only
-- for change detection, which is why the upsert can leave an unchanged row
-- completely untouched (no no-op rewrites — the Neon CU discipline used elsewhere
-- in this repo). `last_seen_at` is the last COMPLETE sync that saw the row
-- (unchanged rows included), which is what lets a record the source stopped
-- publishing flip to `unverified` instead of sitting there looking open.
-- `close_date` is only ever set for open/closed rows and `estimated_close_date`
-- only for a row whose source published an ESTIMATE, so an estimate can never
-- masquerade as a deadline (freshness contract carried over from #399). The
-- normalized columns (eligible applicants / geography / categories / award range /
-- amounts / total funding / matching) hold the source's own words, or
-- 'Not specified' when it published nothing, so part 2 filters on real columns.
-- state_grant_sync_runs: one row per sync attempt (ok|error) with the counts and
-- the error payload. A failed run writes ZERO opportunity rows.
-- state_grant_registry: the mirror of src/lib/state-grants/registry.ts, whose
-- status is DERIVED (a state is `connected` only with a connector AND a passing
-- source-validation test). The table never decides anything on its own. 044's
-- one-time remap of a pre-044 `connected` VA row to `limited` has no counterpart
-- here: this file builds an EMPTY registry table, and the registry mirror sync
-- writes it from the derived registry (VA = limited) — which the bootstrap test
-- asserts on a schema.sql-only database.
CREATE TABLE IF NOT EXISTS state_grant_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The connector's stable id (e.g. 'va-vtc-grants'). Code owns this value;
    -- the table mirrors it, and the sync runner resolves a connector to this row.
    source_key TEXT NOT NULL UNIQUE,
    -- Two-letter USPS state code (may occur many times: one row per SOURCE).
    state_code TEXT NOT NULL,
    -- Human label for the listing this source is.
    name TEXT NOT NULL,
    -- The publishing body, in the source's own words where it names itself.
    agency TEXT NOT NULL,
    -- The ONE official listing this source reads (hard-coded in its connector).
    official_url TEXT NOT NULL,
    -- Host that must be on the approved-host allowlist before a state may be
    -- reported above `unavailable` (fail-closed; see registry.ts).
    official_host TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_state_grant_sources_state ON state_grant_sources (state_code);
-- Seed: the only validated source today (Virginia, the reference connector).
-- Idempotent: re-running rewrites nothing unless one of the values changed.
INSERT INTO state_grant_sources
    (source_key, state_code, name, agency, official_url, official_host)
VALUES
    ('va-vtc-grants', 'VA', 'Virginia Tourism Corporation — Grants and Funding',
     'Virginia Tourism Corporation', 'https://www.vatc.org/grants/', 'www.vatc.org')
ON CONFLICT (source_key) DO UPDATE SET
    state_code = EXCLUDED.state_code,
    name = EXCLUDED.name,
    agency = EXCLUDED.agency,
    official_url = EXCLUDED.official_url,
    official_host = EXCLUDED.official_host,
    updated_at = NOW()
WHERE state_grant_sources.state_code IS DISTINCT FROM EXCLUDED.state_code
   OR state_grant_sources.name IS DISTINCT FROM EXCLUDED.name
   OR state_grant_sources.agency IS DISTINCT FROM EXCLUDED.agency
   OR state_grant_sources.official_url IS DISTINCT FROM EXCLUDED.official_url
   OR state_grant_sources.official_host IS DISTINCT FROM EXCLUDED.official_host;

CREATE TABLE IF NOT EXISTS state_grant_opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Two-letter USPS state code, incl. 'DC'. Denormalised for queries — the
    -- state registry (not this column) is the authority on which states we cover,
    -- and the identity below is the SOURCE, not the state.
    state_code TEXT NOT NULL,
    -- The SOURCE's own identifier for this opportunity (for Virginia: the slug
    -- of the official VTC program page). Never invented, never positional.
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    agency TEXT,
    summary TEXT,
    -- Derived by src/lib/state-grants/connector.ts classifyStateGrant() under the
    -- owner's ordered taxonomy: anything unconfirmed is `unverified`, never
    -- auto-classified as a forecast of a future cycle.
    status TEXT NOT NULL CHECK (status IN ('open', 'upcoming', 'rolling', 'closed', 'unverified')),
    -- Source-published dates, 'YYYY-MM-DD'. NULL when the source published none.
    posted_date DATE,
    close_date DATE,
    -- The date the source itself announced as an ESTIMATE. Never a deadline, and
    -- only ever present on a row whose status is `unverified`.
    estimated_close_date DATE,
    -- The opportunity's own page on the official source (falls back to the
    -- listing page when the source gives no per-record link).
    url TEXT NOT NULL,
    -- The official listing page this row was parsed from.
    source_url TEXT NOT NULL,
    -- Content hash (not a security primitive). Same content means the same value,
    -- so a re-run leaves the row untouched, while changed content is a detected
    -- amendment.
    fingerprint TEXT NOT NULL,
    -- The source's own "last updated" stamp, when it publishes a per-record one.
    -- NULL when it does not (Virginia publishes none — see CONVENTIONS.md).
    source_updated_at TIMESTAMPTZ,
    -- The parsed source fields verbatim, so nothing has to be re-fetched to
    -- re-derive a decision. Raw source payload only — no invented keys.
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- ── Added by 044, in 044's own order (the mirror must match the migration-
    --    built table column for column, which the bootstrap test asserts) ──
    -- The source this row came from. NOT NULL: we do not invent a source for a
    -- row we cannot attribute, and one opportunity belongs to exactly one source.
    source_id UUID NOT NULL REFERENCES state_grant_sources (id),
    -- The last COMPLETE sync that saw this row (unchanged rows included).
    last_seen_at TIMESTAMPTZ,
    -- The normalized filter columns part 2 queries on.
    eligible_applicants TEXT NOT NULL DEFAULT 'Not specified',
    eligible_geography TEXT NOT NULL DEFAULT 'Not specified',
    categories TEXT[] NOT NULL DEFAULT '{}'::text[],
    award_range TEXT NOT NULL DEFAULT 'Not specified',
    award_min_amount NUMERIC,
    award_max_amount NUMERIC,
    total_funding TEXT NOT NULL DEFAULT 'Not specified',
    matching_requirement TEXT NOT NULL DEFAULT 'Not specified'
);
-- IDENTITY (044): (source_id, external_id) as a UNIQUE INDEX — the same external
-- id from two agencies in one state is TWO rows, never an overwrite. It is an
-- index rather than a table constraint because 044 swaps the old state-keyed
-- UNIQUE constraint for it with plain, re-runnable statements (see
-- db/migrations/sql-statements.ts for why a PL/pgSQL block is not allowed there),
-- and the shape must match the migration-built table exactly.
CREATE UNIQUE INDEX IF NOT EXISTS state_grant_opportunities_source_external_key
    ON state_grant_opportunities (source_id, external_id);
CREATE INDEX IF NOT EXISTS idx_state_grant_opportunities_source_status
    ON state_grant_opportunities (source_id, status);
CREATE INDEX IF NOT EXISTS idx_state_grant_opportunities_state_status
    ON state_grant_opportunities (state_code, status);
CREATE INDEX IF NOT EXISTS idx_state_grant_opportunities_state_close_date
    ON state_grant_opportunities (state_code, close_date);

CREATE TABLE IF NOT EXISTS state_grant_sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_code TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    -- ok only when the whole run committed. Every failure path records an error
    -- row with zero opportunity writes from that run.
    status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
    fetched_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    -- { stage, message, ... } for a failed run, NULL when ok.
    error JSONB
);
CREATE INDEX IF NOT EXISTS idx_state_grant_sync_runs_state_started
    ON state_grant_sync_runs (state_code, started_at DESC);

CREATE TABLE IF NOT EXISTS state_grant_registry (
    state_code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    -- DERIVED, never hand-set: the owner's ladder, where `connected` requires a
    -- connector AND a passing source-validation test (src/lib/state-grants/
    -- registry.ts). The mirror is written from the derived registry; nothing in
    -- the product reads a tier out of this table.
    status TEXT NOT NULL CHECK (status IN ('unavailable', 'limited', 'curated', 'connected')),
    connector_id TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- ── NONPROFIT FREE (migration 045 mirror) ──
-- Generated from db/migrations/045_nonprofit_free.sql (comments stripped, statements
-- verbatim) so the mirror cannot drift from the migration. Nonprofit Free is a
-- separate product line: nothing here is read by /grants, /api/grants/search or the
-- Radar surface until a later phase wires it. See db/migrations/045_nonprofit_free.sql
-- for the reviewed DDL, the audit columns and the reasoning behind each one.
CREATE TABLE IF NOT EXISTS nonprofit_applications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id),
    org_name TEXT NOT NULL,
    work_email TEXT NOT NULL,
    website TEXT,
    ein CHAR(9) NOT NULL,
    state TEXT,
    contact_name TEXT NOT NULL,
    contact_role TEXT,
    org_use_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'manual_review', 'denied', 'revoked')),
    verification_method TEXT
        CHECK (verification_method IS NULL OR verification_method IN ('irs_eo_bmf', 'manual_exception')),
    submitted_name_normalized TEXT,
    matched_bmf_name TEXT,
    bmf_name_tier TEXT CHECK (bmf_name_tier IS NULL OR bmf_name_tier IN ('A', 'B', 'C')),
    bmf_status TEXT,
    bmf_subsection TEXT,
    bmf_group_no TEXT,
    bmf_posting_date DATE,
    bmf_source_ref TEXT,
    pub78 BOOLEAN,
    pub78_deductibility_code TEXT,
    on_revocation_list BOOLEAN,
    revocation_date DATE,
    revocation_posting_date DATE,
    reinstatement_date DATE,
    decision TEXT
        CHECK (decision IS NULL OR decision IN ('auto_approve', 'manual_review', 'deny', 'reentry_required')),
    decision_reason TEXT,
    reason_class TEXT
        CHECK (reason_class IS NULL OR reason_class IN
            ('clear-match', 'possible-match', 'no-match-request-docs', 'fraud-likely')),
    supporting_docs_requested BOOLEAN NOT NULL DEFAULT FALSE,
    decision_flags TEXT[] NOT NULL DEFAULT '{}'::text[],
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    granted_at TIMESTAMPTZ,
    reverify_due_at TIMESTAMPTZ,
    -- Migration 046: the owner's admin EIN-release (never automatic — no cooldown), and
    -- the weekly digest columns (written by a later unit; nothing reads them yet).
    -- A released row is NEVER deleted: the org keeps its account and its saved data.
    released_at TIMESTAMPTZ,
    digest_opt_out_at TIMESTAMPTZ,
    digest_unsubscribe_token_hash TEXT,
    digest_last_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS nonprofit_applications_user_id_key ON nonprofit_applications (user_id);
-- Migration 046: PARTIAL — "one free org account per EIN" applies to ATTACHED rows only,
-- so an EIN an administrator has released (released_at set) is immediately claimable by a
-- different applicant. Same index name as migration 045 on purpose (see 046's header).
CREATE UNIQUE INDEX IF NOT EXISTS nonprofit_applications_ein_key ON nonprofit_applications (ein) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_nonprofit_applications_status_created ON nonprofit_applications (status, created_at);
-- ── NONPROFIT FREE PHASE 2 (migration 046 mirror) ──
-- The append-only admin audit trail (owner appendix decision 3): one row per action, the
-- acting administrator's immutable id + email, an optional reason code and internal note,
-- and the status before/after. Append-only by convention — no UPDATE/DELETE path exists.
CREATE TABLE IF NOT EXISTS nonprofit_application_reviews (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES nonprofit_applications (id),
    action TEXT NOT NULL CHECK (action IN ('approve', 'deny', 'request_info', 'suspend', 'release', 'transfer')),
    actor_user_id INTEGER NOT NULL REFERENCES users (id),
    actor_email TEXT NOT NULL,
    reason_code TEXT,
    internal_note TEXT,
    prior_status TEXT NOT NULL,
    new_status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nonprofit_application_reviews_application
    ON nonprofit_application_reviews (application_id, created_at);
CREATE TABLE IF NOT EXISTS irs_eo_bmf (
    ein CHAR(9) PRIMARY KEY,
    name TEXT NOT NULL,
    sort_name TEXT,
    state TEXT,
    subsection TEXT,
    status TEXT,
    group_no TEXT,
    ruling_year TEXT,
    ntee TEXT,
    posting_date DATE,
    content_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_irs_eo_bmf_posting_date ON irs_eo_bmf (posting_date);
CREATE TABLE IF NOT EXISTS irs_pub78 (
    ein CHAR(9) PRIMARY KEY,
    deductibility_code TEXT,
    posting_date DATE,
    content_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_irs_pub78_posting_date ON irs_pub78 (posting_date);
CREATE TABLE IF NOT EXISTS irs_revocations (
    id BIGSERIAL PRIMARY KEY,
    ein CHAR(9) NOT NULL,
    revocation_date DATE,
    revocation_posting_date DATE,
    reinstatement_date DATE,
    row_hash TEXT NOT NULL UNIQUE,
    posting_date DATE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_irs_revocations_ein ON irs_revocations (ein);
CREATE INDEX IF NOT EXISTS idx_irs_revocations_posting_date ON irs_revocations (posting_date);
CREATE TABLE IF NOT EXISTS irs_mirror_runs (
    id SERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    payload TEXT NOT NULL,
    posting_date DATE,
    row_count INTEGER NOT NULL DEFAULT 0,
    distinct_ein_count INTEGER,
    quarantined_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    unchanged_count INTEGER NOT NULL DEFAULT 0,
    pruned_count INTEGER NOT NULL DEFAULT 0,
    mode TEXT NOT NULL CHECK (mode IN ('verify', 'import')),
    status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_irs_mirror_runs_source_started ON irs_mirror_runs (source, started_at DESC);
CREATE TABLE IF NOT EXISTS saved_grants (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id),
    opportunity_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'grants_gov',
    title TEXT NOT NULL,
    agency TEXT,
    status TEXT,
    closing_date DATE,
    award_display TEXT,
    official_url TEXT,
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS saved_grants_user_opportunity_key ON saved_grants (user_id, opportunity_id);
CREATE INDEX IF NOT EXISTS idx_saved_grants_user_created ON saved_grants (user_id, created_at DESC);
