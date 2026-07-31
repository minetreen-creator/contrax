-- Migration 002: Post-checkout flow — add Stripe columns to users table
-- Apply with: bun run src/db/setup.ts (or run against Neon directly)

-- Add stripe_customer_id (nullable — only set when user pays via Stripe)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='stripe_customer_id') THEN
        ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
    END IF;
END $$;

-- Add subscription_status (nullable — 'active', 'canceled', 'past_due')
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='subscription_status') THEN
        ALTER TABLE users ADD COLUMN subscription_status TEXT;
    END IF;
END $$;

-- Add plan_tier (nullable — 'starter', 'professional', 'agency', 'premium')
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='plan_tier') THEN
        ALTER TABLE users ADD COLUMN plan_tier TEXT;
    END IF;
END $$;
