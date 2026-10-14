-- Preserve one genuine, previously generated AI brief independently of live bid retention.
-- No synthetic content: application populates this from an existing cached summary.
CREATE TABLE IF NOT EXISTS example_brief_snapshots (
  id integer PRIMARY KEY CHECK (id = 1),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
