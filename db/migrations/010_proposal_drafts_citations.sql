-- Migration 010: proposal_drafts.citations
-- FAR-grounded drafting citations (JSON array of {clause_number, title,
-- full_text}). Column is also ensured at runtime by lazy ALTERs in
-- src/routes/api/bids-draft.ts, src/routes/api/dashboard-data.ts and
-- src/routes/dashboard.tsx (downloadPdf), so this migration is
-- documentation + an idempotent runner for fresh setups.
ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS citations JSONB DEFAULT '[]'::jsonb;
