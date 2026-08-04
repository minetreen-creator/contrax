/**
 * Contrax Sync Runner
 *
 * Orchestrates bid data ingestion from all procurement sources.
 * Runs each source's fetchBids(), deduplicates via ON CONFLICT DO NOTHING,
 * and logs results to the sync_logs table.
 *
 * Usage:
 *   bun run src/jobs/runner.ts           (manual run)
 *   bun run sync-bids                     (via package.json script)
 *
 * Scheduling (production):
 *   Set up a cron job to run this script periodically. Options:
 *   - Vercel Cron Jobs: add a vercel.json cron that hits an API route
 *     that calls this logic
 *   - GitHub Actions: schedule workflow to run `bun run sync-bids`
 *   - Any cron service: run `bun run src/jobs/runner.ts` on schedule
 *
 *   Recommended: run every 4-6 hours during business days.
 */

import { neon } from "@neondatabase/serverless";
import { fetchBids as fetchSamGov } from "./sources/sam-gov";
import { fetchBids as fetchVaEv } from "./sources/va-ev";
import { fetchBids as fetchNc } from "./sources/nc";
import { fetchBids as fetchMdDc } from "./sources/md-dc";
import { fetchBids as fetchTx } from "./sources/tx";
import { fetchBids as fetchFl } from "./sources/fl";
import { fetchBids as fetchCities } from "./sources/cities";
import { nycSocrataSource, nysSocrataSource } from "./sources/socrata";
import type { RawBid } from "./sources/sam-gov";
import { sendBidDigest, type NewBidSummary } from "../lib/email";
import { createNotification } from "../lib/notifications";

interface SyncSource {
  name: string;
  fetchFn: () => Promise<RawBid[]>;
}

const SOURCES: SyncSource[] = [
  { name: "sam_gov", fetchFn: fetchSamGov },
  { name: "va_evirginia", fetchFn: fetchVaEv },
  { name: "nc", fetchFn: fetchNc },
  { name: "md_dc", fetchFn: fetchMdDc },
  { name: "tx", fetchFn: fetchTx },
  { name: "fl", fetchFn: fetchFl },
  { name: "cities", fetchFn: fetchCities },
  { name: "nyc_socrata", fetchFn: nycSocrataSource },
  { name: "nys_socrata", fetchFn: nysSocrataSource },
];

export interface SyncSourceResult {
  fetched: number;
  new: number;
  errors: string[];
  newBids: NewBidSummary[];
}

export interface SyncResult {
  totalFetched: number;
  totalNew: number;
  totalErrors: number;
  duration: string;
  results: Record<string, SyncSourceResult>;
  newBids: NewBidSummary[];
}

async function syncSource(
  sql: ReturnType<typeof neon>,
  source: SyncSource,
): Promise<SyncSourceResult> {
  const errors: string[] = [];
  const newBids: NewBidSummary[] = [];
  let fetched = 0;
  let newCount = 0;

  try {
    console.log(`\n📡 Fetching from ${source.name}...`);
    const bids = await source.fetchFn();
    fetched = bids.length;
    console.log(`  Fetched ${fetched} bids from ${source.name}`);

    for (const bid of bids) {
      try {
        const result = await sql`
          INSERT INTO bids (title, agency, description, location, category, set_aside, due_date, estimated_value, source_url, source, external_id)
          VALUES (
            ${bid.title},
            ${bid.agency},
            ${bid.description},
            ${bid.location},
            ${bid.category},
            ${bid.set_aside ?? null},
            ${bid.due_date ? new Date(bid.due_date).toISOString() : null}::timestamptz,
            ${bid.estimated_value},
            ${bid.source_url},
            ${source.name},
            ${bid.external_id}
          )
          ON CONFLICT (source, external_id) DO NOTHING
          RETURNING id
        `;
        if (result.length > 0) {
          newCount++;
          newBids.push({
            bid_id: Number((result[0] as { id: number }).id),
            title: bid.title,
            agency: bid.agency,
            source_url: bid.source_url,
            location: bid.location,
            due_date: bid.due_date ?? null,
          });
        }
      } catch (e) {
        const msg = `Insert error for ${bid.external_id}: ${(e as Error).message}`;
        errors.push(msg);
        console.error(`  ${msg}`);
      }
    }

    console.log(`  ${source.name}: ${newCount} new, ${fetched - newCount} duplicates, ${errors.length} errors`);
  } catch (e) {
    const msg = `Source error for ${source.name}: ${(e as Error).message}`;
    errors.push(msg);
    console.error(`  ${msg}`);
  }

  // Log to sync_logs
  try {
    await sql`
      INSERT INTO sync_logs (source, fetched, new, errors, created_at)
      VALUES (${source.name}, ${fetched}, ${newCount}, ${errors.join("; ") || null}, NOW())
    `;
  } catch (e) {
    console.error(`  Failed to log sync for ${source.name}:`, (e as Error).message);
  }

  return { fetched, new: newCount, errors, newBids };
}

export async function runSync(): Promise<SyncResult> {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  const sql = neon(DATABASE_URL);

  console.log("🚀 Contrax Sync Runner");
  console.log(`   Started: ${new Date().toISOString()}`);
  console.log(`   Sources: ${SOURCES.map((s) => s.name).join(", ")}`);

  const startTime = Date.now();
  const results: Record<string, SyncSourceResult> = {};

  for (const source of SOURCES) {
    results[source.name] = await syncSource(sql, source);
    // Small delay between sources to be polite
    await new Promise((r) => setTimeout(r, 500));
  }

  const totalFetched = Object.values(results).reduce((s, r) => s + r.fetched, 0);
  const totalNew = Object.values(results).reduce((s, r) => s + r.new, 0);
  const totalErrors = Object.values(results).reduce((s, r) => s + r.errors.length, 0);
  const allNewBids: NewBidSummary[] = Object.values(results).flatMap((r) => r.newBids);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n✅ Sync complete in ${duration}s`);
  console.log(`   Total fetched: ${totalFetched}`);
  console.log(`   New bids: ${totalNew}`);
  console.log(`   Errors: ${totalErrors}`);

  if (totalErrors > 0) {
    console.log("\n⚠️  Errors encountered:");
    for (const [source, r] of Object.entries(results)) {
      for (const err of r.errors) {
        console.log(`   [${source}] ${err}`);
      }
    }
  }

  // Notify matching profiles without allowing notification failures to break sync.
  if (totalNew > 0) {
    try {
      const profiles = await sql`SELECT user_id, industry, locations, service_categories FROM business_profiles WHERE user_id IS NOT NULL` as any[];
      let notified = 0;
      for (const bid of allNewBids) {
        const text = `${bid.title} ${bid.agency} ${bid.location || ""}`.toLowerCase();
        for (const profile of profiles) {
          const locations = Array.isArray(profile.locations) ? profile.locations : [];
          const services = Array.isArray(profile.service_categories) ? profile.service_categories : [];
          const industry = String(profile.industry || "").toLowerCase();
          const matches = !industry || text.includes(industry) || services.some((s: unknown) => text.includes(String(s).toLowerCase())) || locations.some((l: unknown) => text.includes(String(l).toLowerCase()));
          if (matches) {
            await createNotification({ userId: Number(profile.user_id), type: "new_bid_match", title: "New bid matches your profile", message: `"${bid.title}" from ${bid.agency} matches your business profile.`, bidId: bid.bid_id });
            notified++;
          }
        }
      }
      console.log(`🔔 Created ${notified} bid match notification(s)`);
    } catch (err) {
      console.error("🔔 Failed to create bid match notifications:", (err as Error).message);
    }
  }

  // ── Send bid digest email ────────────────────────────────────────────────
  if (totalNew > 0) {
    try {
      const userRows = await sql`SELECT email FROM users` as { email: string }[];
      if (userRows.length > 0) {
        const userEmails = userRows.map((r) => r.email);
        console.log(`\n📧 Sending bid digest to ${userEmails.length} user(s)...`);
        await sendBidDigest(userEmails, allNewBids);
      } else {
        console.log("\n📧 No users found in DB — skipping bid digest");
      }
    } catch (err) {
      console.error(
        "\n📧 Failed to query users for bid digest:",
        (err as Error).message,
      );
    }
  }

  return {
    totalFetched,
    totalNew,
    totalErrors,
    duration,
    results,
    newBids: allNewBids,
  };
}

async function main() {
  try {
    await runSync();
    console.log("\n🏁 Runner finished successfully");
    process.exit(0);
  } catch (err) {
    console.error("\n💥 Runner crashed:", err);
    process.exit(1);
  }
}

// Only run the CLI entrypoint when this file is executed directly
// (e.g. `bun run src/jobs/runner.ts`). When imported — e.g. by the
// /api/sync-bids route for Vercel Cron — import.meta.main is undefined in the
// server bundle, so main() must not run (it would trigger a full sync and
// call process.exit(), killing the request handler).
if ((import.meta as ImportMeta & { main?: boolean }).main) {
  main();
}
