-- Standalone receivables tracker. Apply before deploying the payment workspace.
CREATE TABLE IF NOT EXISTS contract_payments (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  customer_name TEXT NOT NULL,
  job_name TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  invoice_due_date DATE,
  purchase_order_number TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'paid')),
  invoice_attached BOOLEAN NOT NULL DEFAULT FALSE,
  po_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  supporting_docs_ready BOOLEAN NOT NULL DEFAULT FALSE,
  next_action TEXT NOT NULL DEFAULT '',
  follow_up_date DATE,
  notes TEXT NOT NULL DEFAULT '',
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contract_payments_user_follow_up
  ON contract_payments(user_id, follow_up_date) WHERE archived_at IS NULL;

-- Payroll preparation only: no tax calculation, withholding, or disbursement.
CREATE TABLE IF NOT EXISTS contract_labor_entries (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  worker_name TEXT NOT NULL,
  job_name TEXT NOT NULL,
  work_date DATE NOT NULL,
  hours_hundredths INTEGER NOT NULL CHECK (hours_hundredths >= 0 AND hours_hundredths <= 2400),
  hourly_rate_cents INTEGER NOT NULL CHECK (hourly_rate_cents >= 0),
  reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT NOT NULL DEFAULT '',
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contract_labor_user_date
  ON contract_labor_entries(user_id, work_date DESC) WHERE archived_at IS NULL;
