-- "Save your matches" — anonymous email opt-in for the Contract Radar lead capture
-- (option A, owner-approved).
--
-- Turns the current dead-end (a session-only visitor views their free radar
-- matches and bounces, and we never get their contact) into an OPTED-IN contact
-- list we can later email alerts / retarget. No account required — this is an
-- explicit email-opt-in, stored keyed to the email address, NOT to a user row
-- (anonymous visitors have no user).
--
-- Requirements honored:
--   * UNIQUE(email) — a returning submission / same visitor UPDATEs the row
--     (ON CONFLICT) instead of erroring or creating duplicates.
--   * Stores the exact radar criteria the visitor used (trade/NAICS, state,
--     cert, size_pref) so a future alert job can match new bids against their
--     saved criteria. `matched_count` records how many matches they were
--     viewing so we know the size of the result set they opted in to.
--   * Stores visitor_id / visit_id (opened + followed a lead) and first-touch
--     attribution (source / medium / campaign) so we can measure this capture's
--     conversion against the Facebook drop-off.
--   * `phone` is OPTIONAL (the form asks for it but does not require it).
--   * No email-sending infra exists yet — a future sync/alert worker reads this
--     table to send "new matching bid opened" alerts. Data here is REAL and
--     honest; we never fabricate deliverability.
--
-- Idempotent: safe to run repeatedly on any environment. The runtime path
-- self-heals with the same CREATE TABLE IF NOT EXISTS (see run-018.ts and
-- src/routes/api/radar-save.ts).
CREATE TABLE IF NOT EXISTS radar_saves (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,                  -- normalized lowercase/trimmed
  trade TEXT,                           -- trade / 6-digit NAICS the visitor used
  state TEXT,                           -- state filter ('' or null = nationwide)
  cert TEXT,                            -- sdvosb | 8a | wosb | hubzone | sb
  size_pref TEXT,                       -- under250k | under1m | under10m | any
  phone TEXT,                           -- optional phone (never validated as required)
  visitor_id TEXT,                      -- persistent per-visitor id (contrax_vid)
  visit_id TEXT,                        -- per-session visit id
  source TEXT,                          -- first-touch acquisition source
  medium TEXT,                          -- first-touch acquisition medium
  campaign TEXT,                        -- first-touch campaign (nullable)
  matched_count INTEGER,                -- how many radar matches they were seeing
  created_at TIMESTAMPTZ DEFAULT NOW(), -- first opt-in time (kept on UPDATE)
  updated_at TIMESTAMPTZ DEFAULT NOW(), -- last update
  UNIQUE (email)
);
-- Query-time indexes for the future alert/retarget jobs + acquisition analysis.
CREATE INDEX IF NOT EXISTS radar_saves_created_at_idx ON radar_saves (created_at);
CREATE INDEX IF NOT EXISTS radar_saves_cert_idx ON radar_saves (cert);
CREATE INDEX IF NOT EXISTS radar_saves_source_idx ON radar_saves (source);
