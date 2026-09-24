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
  initialized = true;
}

export const BID_FIT_STATUSES = ["new", "reviewing", "awaiting_payment", "in_progress", "completed", "declined"] as const;

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
