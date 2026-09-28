-- DOT FY2026 directory: an independent, private review ledger. Only exact matches
-- to an existing prime may be published. This never creates a prime or an opportunity.
-- Apply before deploying the read path. Additive and idempotent.
CREATE TABLE IF NOT EXISTS dot_directory_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT NOT NULL CHECK (status IN ('staging', 'complete')),
    source_url TEXT NOT NULL,
    source_label TEXT NOT NULL,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS dot_directory_records (
    run_id UUID NOT NULL REFERENCES dot_directory_runs(id),
    row_number INTEGER NOT NULL,
    vendor_name TEXT NOT NULL,
    vendor_address TEXT NOT NULL,
    vendor_state TEXT,
    naics TEXT,
    services TEXT,
    liaison TEXT,
    prime_id UUID REFERENCES subcontract_primes(id),
    review_reason TEXT,
    PRIMARY KEY (run_id, row_number),
    CHECK ((prime_id IS NOT NULL AND review_reason IS NULL) OR
           (prime_id IS NULL AND review_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_dot_directory_records_prime ON dot_directory_records(prime_id)
    WHERE prime_id IS NOT NULL;
