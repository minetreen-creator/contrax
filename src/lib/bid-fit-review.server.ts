import { sql } from "~/db";

// Public intake and the admin queue share this idempotent bootstrap. The SQL
// migration is also recorded in db/migrations/050_bid_fit_review_requests.sql.
let initialized = false;
export async function ensureBidFitReviewTable() {
  if (initialized) return;
  await sql()`
    CREATE TABLE IF NOT EXISTS bid_fit_review_requests (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      business TEXT NOT NULL,
      email TEXT NOT NULL,
      solicitation_url TEXT NOT NULL,
      capabilities TEXT NOT NULL,
      deadline TEXT NOT NULL,
      documents_available TEXT NOT NULL CHECK (documents_available IN ('yes', 'login', 'unsure')),
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'awaiting_payment', 'in_progress', 'completed', 'declined')),
      notification_status TEXT NOT NULL DEFAULT 'pending' CHECK (notification_status IN ('pending', 'sent', 'failed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql()`CREATE INDEX IF NOT EXISTS bid_fit_review_requests_created_idx ON bid_fit_review_requests (created_at DESC)`;
  await ensureReviewFlowSchema();
  initialized = true;
}

export const BID_FIT_STATUSES = ["new", "reviewing", "awaiting_information", "awaiting_payment", "in_progress", "completed", "declined"] as const;

export async function createBidFitReviewRequest(input: {
  name: string; business: string; email: string; solicitationUrl: string;
  capabilities: string; deadline: string; documentsAvailable: "yes" | "login" | "unsure";
}): Promise<number> {
  await ensureBidFitReviewTable();
  const rows = await sql()`
    INSERT INTO bid_fit_review_requests (name, business, email, solicitation_url, capabilities, deadline, documents_available)
    VALUES (${input.name}, ${input.business}, ${input.email}, ${input.solicitationUrl}, ${input.capabilities}, ${input.deadline}, ${input.documentsAvailable})
    RETURNING id`;
  return Number(rows[0].id);
}

export async function setBidFitNotificationStatus(id: number, status: "sent" | "failed") {
  await sql()`UPDATE bid_fit_review_requests SET notification_status = ${status}, updated_at = NOW() WHERE id = ${id}`;
}

async function ensureReviewFlowSchema() {
  await sql()`ALTER TABLE bid_fit_review_requests
    ADD COLUMN IF NOT EXISTS access_hash TEXT,
    ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS checkout_session_id TEXT,
    ADD COLUMN IF NOT EXISTS checkout_url TEXT,
    ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid',
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS paid_amount INTEGER,
    ADD COLUMN IF NOT EXISTS document_bytes INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_intent_id TEXT`;
  await sql()`DO $$ BEGIN
    PERFORM pg_advisory_xact_lock(739152601);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='bid_fit_review_requests'::regclass
      AND conname='bid_fit_review_requests_status_check' AND pg_get_constraintdef(oid) LIKE '%awaiting_information%') THEN
      ALTER TABLE bid_fit_review_requests DROP CONSTRAINT IF EXISTS bid_fit_review_requests_status_check;
      ALTER TABLE bid_fit_review_requests ADD CONSTRAINT bid_fit_review_requests_status_check
        CHECK(status IN ('new','reviewing','awaiting_information','awaiting_payment','in_progress','completed','declined'));
    END IF;
  END $$`;
  await sql()`CREATE TABLE IF NOT EXISTS bid_fit_review_documents (
    id BIGSERIAL PRIMARY KEY, request_id BIGINT NOT NULL REFERENCES bid_fit_review_requests(id),
    filename TEXT NOT NULL, content BYTEA NOT NULL, size INTEGER NOT NULL CHECK(size > 0 AND size <= 3000000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql()`CREATE INDEX IF NOT EXISTS bid_fit_review_documents_request_idx ON bid_fit_review_documents(request_id)`;
}
