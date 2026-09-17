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
