import { neon } from "@neondatabase/serverless";
async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);
  await db`
    ALTER TABLE bid_scout_subscriptions
      ADD COLUMN IF NOT EXISTS offer_code text,
      ADD COLUMN IF NOT EXISTS first_invoice_amount integer,
      ADD COLUMN IF NOT EXISTS currency text
  `;
  await db`
    CREATE INDEX IF NOT EXISTS idx_bid_scout_subscriptions_offer_code
      ON bid_scout_subscriptions (offer_code) WHERE offer_code IS NOT NULL
  `;
  console.log(
    "✅ Migration 036 complete (bid_scout_subscriptions founders offer columns + partial index)",
  );
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });