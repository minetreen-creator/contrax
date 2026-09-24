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
);

CREATE INDEX IF NOT EXISTS bid_fit_review_requests_created_idx ON bid_fit_review_requests (created_at DESC);
