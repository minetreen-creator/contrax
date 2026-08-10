-- Migration 009: slack_config + slack_deliveries
-- Slack integration (Incoming Webhooks). One config row per user; delivery
-- attempts are logged like webhook_deliveries. Tables are also ensured at
-- runtime by src/lib/slack.ts (ensureSlackTables), so this migration is
-- documentation + an idempotent runner for fresh setups.
CREATE TABLE IF NOT EXISTS slack_config (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  webhook_url TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS slack_deliveries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  event TEXT NOT NULL,
  status_code INTEGER,
  attempt INTEGER NOT NULL DEFAULT 1,
  success BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS slack_deliveries_user_id_idx ON slack_deliveries (user_id, created_at DESC);
