/**
 * One-shot database setup: run migrations then seed.
 * Usage: bun run src/db/setup.ts
 */

import { runMigrations } from "./migrate";
import { runSeed } from "./seed";

async function setup() {
  console.log("🔄 Running migrations...");
  await runMigrations();

  console.log("🌱 Running seed...");
  await runSeed();

  console.log("✅ Database setup complete");
}

setup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Setup failed:", err);
    process.exit(1);
  });
