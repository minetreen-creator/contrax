-- Private PDF attachments and verified one-time review payments.
ALTER TABLE bid_fit_review_requests
    ADD COLUMN IF NOT EXISTS access_hash TEXT,
    ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS checkout_session_id TEXT,
    ADD COLUMN IF NOT EXISTS checkout_url TEXT,
    ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid',
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS paid_amount INTEGER,
    ADD COLUMN IF NOT EXISTS document_bytes INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_intent_id TEXT;

DO $$ BEGIN
    PERFORM pg_advisory_xact_lock(739152601);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='bid_fit_review_requests'::regclass
      AND conname='bid_fit_review_requests_status_check' AND pg_get_constraintdef(oid) LIKE '%awaiting_information%') THEN
      ALTER TABLE bid_fit_review_requests DROP CONSTRAINT IF EXISTS bid_fit_review_requests_status_check;
      ALTER TABLE bid_fit_review_requests ADD CONSTRAINT bid_fit_review_requests_status_check
        CHECK(status IN ('new','reviewing','awaiting_information','awaiting_payment','in_progress','completed','declined'));
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS bid_fit_review_documents (
    id BIGSERIAL PRIMARY KEY, request_id BIGINT NOT NULL REFERENCES bid_fit_review_requests(id),
    filename TEXT NOT NULL, content BYTEA NOT NULL, size INTEGER NOT NULL CHECK(size > 0 AND size <= 3000000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

CREATE INDEX IF NOT EXISTS bid_fit_review_documents_request_idx ON bid_fit_review_documents(request_id);
