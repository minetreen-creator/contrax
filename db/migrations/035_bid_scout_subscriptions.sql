-- Migration 035 — Bid Scout subscriptions (owner spec 2026-09-10, Phase A).
--
-- One row per Bid Scout checkout/intake submission. The row is created with
-- status 'pending' BEFORE Stripe Checkout so a lost webhook can never lose a
-- lead; webhook events then transition it pending -> active / past_due /
-- cancelled. The `source` column stores the Bid Scout CTA source (placement
-- param, e.g. ?source=dashboard) — NOT first-touch acquisition attribution,
-- which stays on the visitor row and is never overwritten by this table.
--
-- Mirrored verbatim in src/db/schema.sql (canonical merged schema, applied by
-- `bun run src/db/setup.ts`). Idempotent — safe to re-run.
--
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