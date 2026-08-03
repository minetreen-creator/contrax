// Run migration 001: create users table
import { neon } from "@neondatabase/serverless";

const db = neon(process.env.DATABASE_URL!);

async function run() {
  const tables = await db`
    SELECT table_name FROM information_schema.tables
    WHERE table_name = 'users' AND table_schema = 'public'
  `;

  if (tables.length === 0) {
    await db`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log("Created users table");
  } else {
    console.log("users table already exists");
  }
  console.log("✅ Migration 001 complete");
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });
