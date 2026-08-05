-- Preserve the SAM.gov NAICS classification for incumbent intelligence lookups.
ALTER TABLE bids ADD COLUMN IF NOT EXISTS naics_code TEXT;
