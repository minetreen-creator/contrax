-- Migration 011: pending_drafts
-- Server-side persistence for the score → signup → draft promise. When a user
-- signs up right after scoring a pasted solicitation, the solicitation text is
-- stored here keyed to their user_id with status 'awaiting_profile'. Onboarding
-- completion (or a later /draft/pending visit) fulfills it through the SAME
-- FAR-grounded generation path as bids-draft and stores the resulting
-- draft_text + citations on the row (status -> 'fulfilled').
--
-- The table is also ensured at runtime by lazy CREATEs in
-- src/routes/api/pending-drafts.ts and src/routes/api/pending-drafts-fulfill.ts
-- (same pattern as the business_profiles ALTERs / slack tables), so this
-- migration is documentation + an idempotent runner for fresh setups.
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
