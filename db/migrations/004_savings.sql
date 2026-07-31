-- Migration 004: Savings product tables
CREATE TABLE IF NOT EXISTS savings_diagnoses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  bill_type TEXT,
  provider_name TEXT,
  current_amount DECIMAL(10,2),
  diagnosis_json JSONB,
  savings_prescription JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS savings_bills (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  bill_type TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  current_amount DECIMAL(10,2) NOT NULL,
  billing_cycle TEXT DEFAULT 'monthly',
  next_due_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
