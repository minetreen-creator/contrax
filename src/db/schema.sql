-- Contrax Database Schema
-- Tables for users, business profiles, bids, saved matches, and sessions

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    stripe_customer_id TEXT,
    subscription_status TEXT,
    plan_tier TEXT
);

CREATE TABLE IF NOT EXISTS business_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) UNIQUE,
    business_name TEXT NOT NULL,
    industry TEXT NOT NULL,
    locations JSONB NOT NULL DEFAULT '[]',
    service_categories JSONB NOT NULL DEFAULT '[]',
    naics_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bids (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    agency TEXT NOT NULL,
    description TEXT,
    location TEXT,
    category TEXT,
    due_date TIMESTAMPTZ,
    estimated_value TEXT,
    source_url TEXT,
    source TEXT NOT NULL DEFAULT 'seed',
    external_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source, external_id)
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
DO $$$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bids' AND column_name='source') THEN
        ALTER TABLE bids ADD COLUMN source TEXT NOT NULL DEFAULT 'seed';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bids' AND column_name='external_id') THEN
        ALTER TABLE bids ADD COLUMN external_id TEXT;
    END IF;
END $$;

-- Migration: Add UNIQUE constraint if missing
DO $$$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bids_source_external_id_key'
    ) THEN
        UPDATE bids SET external_id = 'seed-legacy-' || id::text WHERE external_id IS NULL;
        ALTER TABLE bids ADD CONSTRAINT bids_source_external_id_key UNIQUE (source, external_id);
    END IF;
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

CREATE TABLE IF NOT EXISTS analytics_events (
    id SERIAL PRIMARY KEY,
    path TEXT NOT NULL,
    referrer TEXT,
    user_agent TEXT,
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

-- Migration: Add naics_match column to bid_scores if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bid_scores' AND column_name='naics_match') THEN
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
