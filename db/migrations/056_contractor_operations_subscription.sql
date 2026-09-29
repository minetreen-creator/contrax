-- Separate paid entitlement for the standalone Contractor Operations product.
CREATE TABLE IF NOT EXISTS contractor_operations_subscriptions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'incomplete',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  price_id TEXT,
  current_period_end TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contractor_operations_subscription_customer
  ON contractor_operations_subscriptions (stripe_customer_id);
