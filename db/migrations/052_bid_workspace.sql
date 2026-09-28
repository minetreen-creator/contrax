-- Apply before deploying the bid workspace. Additive and safe to run again.
ALTER TABLE saved_matches ADD COLUMN IF NOT EXISTS pursuit_status TEXT NOT NULL DEFAULT 'evaluating';
ALTER TABLE saved_matches ADD COLUMN IF NOT EXISTS next_action TEXT;
ALTER TABLE saved_matches ADD COLUMN IF NOT EXISTS follow_up_date DATE;
ALTER TABLE saved_matches ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE saved_matches ADD COLUMN IF NOT EXISTS contact_organization TEXT;
ALTER TABLE saved_matches ADD COLUMN IF NOT EXISTS contact_role TEXT;
ALTER TABLE saved_matches ADD COLUMN IF NOT EXISTS contact_email TEXT;
