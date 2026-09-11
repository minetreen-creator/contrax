-- Migration 036 — Bid Scout Founders first-five offer (owner spec 2026-09-11).
--
-- Store what ACTUALLY happened at checkout, not what was attempted. The webhook
-- derives the applied offer from Stripe's completed-session numbers
-- (total_details.amount_discount === 5000 AND amount_total === 4900) and writes:
--   offer_code          'first_five_49' | 'standard_99' (NULL only when the
--                       completed-session retrieve failed — never inferred)
--   first_invoice_amount  the Stripe amount_total of the first invoice ($49 or $99)
--   currency              the Stripe session currency ('usd')
-- The existing subscription-table semantics are untouched (additive, nullable);
-- recurring run rate is ALWAYS $99 (BID_SCOUT_PRICE_USD) regardless of offer.
--
-- Mirrored verbatim in src/db/schema.sql (canonical merged schema, applied by
-- `bun run src/db/setup.ts`). Idempotent — safe to re-run.
--
ALTER TABLE bid_scout_subscriptions
  ADD COLUMN IF NOT EXISTS offer_code text,
  ADD COLUMN IF NOT EXISTS first_invoice_amount integer,
  ADD COLUMN IF NOT EXISTS currency text;

CREATE INDEX IF NOT EXISTS idx_bid_scout_subscriptions_offer_code
  ON bid_scout_subscriptions (offer_code) WHERE offer_code IS NOT NULL;