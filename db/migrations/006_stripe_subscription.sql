-- Migration 006: Stripe subscription id + trial_started_at on the users table
-- Applied by db/setup.ts (idempotent).

ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;
