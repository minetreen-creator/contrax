/**
 * Contrax Sync Runner
 *
 * Orchestrates bid data ingestion from all procurement sources.
 * Runs each source's fetchBids(), upserts via ON CONFLICT DO UPDATE,
 * and logs results to the sync_logs table.
 *
 * Usage:
 *   bun run src/jobs/runner.ts           (manual run)
 *   bun run sync-bids                     (via package.json script)
 *
 * Scheduling (production):
 *   GitHub Actions workflow .github/workflows/sync-bids.yml runs
 *   `bun run sync-bids` every 4 hours on weekdays (Mon–Fri) and can be
 *   triggered manually via workflow_dispatch. The Vercel cron entry for
 *   /api/sync-bids was removed — Vercel Hobby's 10s serverless cap cannot
 *   fit a multi-minute sync across 59 sources. /api/sync-bids remains as an
 *   admin diagnostic that returns 202 and points at the workflow.
 *
 * Performance notes:
 *   - The 51 state-keyword sources are independent SAM.gov queries (one per
 *     state filter) and run concurrently in batches of 5.
 *   - Inserts are batched into multi-row INSERTs (250 rows each) instead of
 *     one query per bid — the biggest DB win.
 *   - The 500ms inter-source sleep was dropped to a 100ms politeness delay
 *     between the serial SAM.gov passes.
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { US_STATES } from "../lib/states";
import { fetchBids as fetchSamGov } from "./sources/sam-gov";
import { fetchBids as fetchCities } from "./sources/cities";
import { nysSocrataSource } from "./sources/socrata";
import { createStateKeywordSource, STATE_NAMES } from "./sources/state-keyword";
import type { RawBid } from "./sources/sam-gov";
import { CITY_SOURCES } from "../lib/city-procurement";
import { sendBidDigest, type NewBidSummary } from "../lib/email";
import { createNotification } from "../lib/notifications";
import { generateBidAlerts } from "../lib/bid-alerts";

interface SyncSource {
  name: string;
  fetchFn: () => Promise<RawBid[]>;
}

/**
 * Concrete neon() query type. `ReturnType<typeof neon>` resolves to
 * `NeonQueryFunction<boolean, boolean>` (constraint instantiation), which is
 * not assignable from the `neon(DATABASE_URL)` call value
 * (`NeonQueryFunction<false, false>`), so pin the default type params.
 */
type Sql = NeonQueryFunction<false, false>;

/**
 * Heavy SAM.gov passes — run strictly serially to stay gentle on SAM.gov's
 * rate limits. sam_gov is the national + regional pass (with per-bid detail
 * fetches); "cities" is the SAM.gov keyword pass for municipal bids.
 */
const SAM_GOV_SOURCES: SyncSource[] = [
  {
    name: "sam_gov",
    // The regional pass is additive. Keep national records first so a bid
    // returned by both queries is represented once (and remains national).
    fetchFn: async () => {
      const national = await fetchSamGov();
      const regional = await fetchSamGov({ states: [...US_STATES] });
      const seen = new Set(national.map((bid) => bid.external_id));
      return national.concat(regional.filter((bid) => !seen.has(bid.external_id)));
    },
  },
  { name: "cities", fetchFn: fetchCities },
];

/**
 * One keyword source per state (50 states + DC), generated from the shared
 * factory. Each hits SAM.gov with a different state filter, so the sources
 * are independent and safe to run concurrently in small batches. One state
 * failing never blocks the others (syncSource catches per-source errors).
 * Replaces the individual nc/sc/tx/fl/md-dc/va-ev sources; VA is now covered
 * by the va entry.
 */
const STATE_KEYWORD_SOURCES: SyncSource[] = US_STATES.map((code) => ({
  name: code.toLowerCase(),
  fetchFn: createStateKeywordSource(STATE_NAMES[code], code),
}));

/**
 * Everything else: NYS Socrata (state open-data portal) plus the city
 * open-data procurement portals (NYC, Chicago, LA, SF, Austin). These hit
 * different APIs, so they interleave one-at-a-time between state-keyword
 * batches — each is isolated so one failing never blocks the others.
 */
const TAIL_SOURCES: SyncSource[] = [
  { name: "nys_socrata", fetchFn: nysSocrataSource },
  ...CITY_SOURCES.map((s) => ({ name: s.name, fetchFn: s.fetch })),
];

/** State-keyword sources per concurrent batch (SAM.gov-friendly). */
const PARALLEL_BATCH_SIZE = 5;
/** Politeness delay between serial SAM.gov passes (was 500ms). */
const INTER_SOURCE_DELAY_MS = 100;
/** Rows per multi-row INSERT (12 cols × 250 rows = 3,000 params — well under Neon's limit). */
const INSERT_BATCH_SIZE = 250;

const BID_COLUMNS = [
  "title",
  "agency",
  "description",
  "location",
  "category",
  "set_aside",
  "due_date",
  "estimated_value",
  "source_url",
  "source",
  "external_id",
  "naics_code",
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toIsoDueDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

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

/**
 * Inserts a chunk of bids with a single multi-row INSERT.
 *
 * `(xmax = 0)` in RETURNING distinguishes genuinely new rows (xmax is 0 for a
 * freshly inserted tuple) from pre-existing rows that only got a mutable-field
 * refresh via ON CONFLICT DO UPDATE (xmax = the updating txn). Only genuinely
 * new rows are counted as "new" and returned for alerts/digests — so repeat
 * syncs no longer re-trigger notifications for already-seen bids.
 *
 * Uses sql.query() (not the tagged template) because the Neon driver rejects
 * array-of-objects fragment calls; placeholders are built manually.
 */
async function insertBidsBatch(
  sql: Sql,
  source: SyncSource,
  chunk: RawBid[],
): Promise<{ newCount: number; newBids: NewBidSummary[] }> {
  const params: unknown[] = [];
  const valueRows: string[] = [];
  for (const bid of chunk) {
    const row = [
      bid.title,
      bid.agency,
      bid.description,
      bid.location,
      bid.category,
      bid.set_aside ?? null,
      toIsoDueDate(bid.due_date),
      bid.estimated_value,
      bid.source_url,
      bid.source_label ?? source.name,
      bid.external_id,
      bid.naics_code ?? null,
    ];
    const placeholders = row.map((_, j) => `$${params.length + j + 1}`).join(", ");
    valueRows.push(`(${placeholders})`);
    params.push(...row);
  }

  const result = (await sql.query(
    `INSERT INTO bids (${BID_COLUMNS.join(", ")})
     SELECT * FROM (VALUES ${valueRows.join(", ")})
       AS v(title, agency, description, location, category, set_aside,
            due_date, estimated_value, source_url, source, external_id, naics_code)
     -- Cross-source dedup guard: skip a row whose natural key (title, agency)
     -- already exists in bids. Multiple sync sources return the SAME national
     -- solicitation (e.g. state-keyword sources va and va_evirginia), so
     -- without this the table grows duplicate rows every sync. Existing rows
     -- are untouched (provenance); only NEW duplicates are prevented.
     WHERE NOT EXISTS (
       SELECT 1 FROM bids b
       WHERE lower(btrim(b.title)) = lower(btrim(v.title))
         AND lower(btrim(b.agency)) = lower(btrim(v.agency))
     )
     ON CONFLICT (source, external_id) DO UPDATE SET
       title = EXCLUDED.title,
       location = EXCLUDED.location,
       category = EXCLUDED.category,
       due_date = EXCLUDED.due_date,
       estimated_value = EXCLUDED.estimated_value,
       naics_code = COALESCE(EXCLUDED.naics_code, bids.naics_code)
     RETURNING id, external_id, (xmax = 0) AS inserted`,
    params,
  )) as any[];

  const bidByExternalId = new Map(chunk.map((bid) => [bid.external_id, bid]));
  const newBids: NewBidSummary[] = [];
  let newCount = 0;
  for (const row of result) {
    if (!row.inserted) continue;
    newCount++;
    const bid = bidByExternalId.get(row.external_id);
    if (!bid) continue;
    newBids.push({
      bid_id: Number(row.id),
      title: bid.title,
      agency: bid.agency,
      source_url: bid.source_url,
      location: bid.location,
      due_date: bid.due_date ?? null,
      set_aside: bid.set_aside ?? null,
    });
  }
  return { newCount, newBids };
}

/** One-at-a-time fallback insert (batch failures only) with per-bid error isolation. */
async function insertBid(
  sql: Sql,
  source: SyncSource,
  bid: RawBid,
): Promise<NewBidSummary | null> {
  const result = (await sql`
    INSERT INTO bids (title, agency, description, location, category, set_aside, due_date, estimated_value, source_url, source, external_id, naics_code)
    SELECT
      ${bid.title},
      ${bid.agency},
      ${bid.description},
      ${bid.location},
      ${bid.category},
      ${bid.set_aside ?? null},
      ${toIsoDueDate(bid.due_date)}::timestamptz,
      ${bid.estimated_value},
      ${bid.source_url},
      ${bid.source_label ?? source.name},
      ${bid.external_id},
      ${bid.naics_code ?? null}
    -- Cross-source dedup guard (same natural-key check as the batch path).
    WHERE NOT EXISTS (
      SELECT 1 FROM bids b
      WHERE lower(btrim(b.title)) = lower(btrim(${bid.title}))
        AND lower(btrim(b.agency)) = lower(btrim(${bid.agency}))
    )
    ON CONFLICT (source, external_id) DO UPDATE SET
      title = EXCLUDED.title,
      location = EXCLUDED.location,
      category = EXCLUDED.category,
      due_date = EXCLUDED.due_date,
      estimated_value = EXCLUDED.estimated_value,
      naics_code = COALESCE(EXCLUDED.naics_code, bids.naics_code)
    RETURNING id, (xmax = 0) AS inserted
  `) as any[];
  if (result.length === 0 || !result[0].inserted) return null;
  return {
    bid_id: Number(result[0].id),
    title: bid.title,
    agency: bid.agency,
    source_url: bid.source_url,
    location: bid.location,
    due_date: bid.due_date ?? null,
    set_aside: bid.set_aside ?? null,
  };
}

async function syncSource(
  sql: Sql,
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

    for (let i = 0; i < bids.length; i += INSERT_BATCH_SIZE) {
      const chunk = bids.slice(i, i + INSERT_BATCH_SIZE);
      try {
        const { newCount: n, newBids: nb } = await insertBidsBatch(sql, source, chunk);
        newCount += n;
        newBids.push(...nb);
      } catch (e) {
        // A batch failed (e.g. one malformed row) — fall back to one-at-a-time
        // inserts so the bad row is isolated and logged without losing the
        // rest of the chunk. Single-statement atomicity means a failed batch
        // inserted nothing, so no rows are double-counted.
        for (const bid of chunk) {
          try {
            const summary = await insertBid(sql, source, bid);
            if (summary) {
              newCount++;
              newBids.push(summary);
            }
          } catch (e2) {
            const msg = `Insert error for ${bid.external_id}: ${(e2 as Error).message}`;
            errors.push(msg);
            console.error(`  ${msg}`);
          }
        }
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

  const allSources = [...SAM_GOV_SOURCES, ...STATE_KEYWORD_SOURCES, ...TAIL_SOURCES];
  console.log("🚀 Contrax Sync Runner");
  console.log(`   Started: ${new Date().toISOString()}`);
  console.log(`   Sources: ${allSources.map((s) => s.name).join(", ")}`);

  // Idempotent migration — once up front instead of once per source.
  await sql`ALTER TABLE bids ADD COLUMN IF NOT EXISTS naics_code TEXT`;

  // Functional (non-unique) index backing the cross-source dedup guard in
  // insertBidsBatch / insertBid, whose WHERE NOT EXISTS filters on
  // lower(btrim(title)), lower(btrim(agency)). Non-unique on purpose: we do
  // NOT mass-delete the ~11k existing duplicate rows (provenance preserved),
  // but this index stops NEW inserts from duplicating an existing
  // solicitation and keeps the existence check fast.
  await sql`CREATE INDEX IF NOT EXISTS idx_bids_natural_key ON bids (lower(btrim(title)), lower(btrim(agency)))`;

  const startTime = Date.now();
  const results: Record<string, SyncSourceResult> = {};

  // Phase 1 — heavy SAM.gov passes, serial (national → regional → city keyword).
  for (const source of SAM_GOV_SOURCES) {
    results[source.name] = await syncSource(sql, source);
    await sleep(INTER_SOURCE_DELAY_MS);
  }

  // Phase 2 — state-keyword sources in concurrent batches of 5 (each an
  // independent SAM.gov query with a different state filter). Tail sources
  // (NYS + city open-data portals, different APIs) interleave one at a time
  // between state batches so they progress without ever running two at once.
  let tailIndex = 0;
  for (let i = 0; i < STATE_KEYWORD_SOURCES.length; i += PARALLEL_BATCH_SIZE) {
    const batch = STATE_KEYWORD_SOURCES.slice(i, i + PARALLEL_BATCH_SIZE);
    const jobs = batch.map((source) => syncSource(sql, source));
    let tailSource: SyncSource | null = null;
    if (tailIndex < TAIL_SOURCES.length) {
      tailSource = TAIL_SOURCES[tailIndex++];
      jobs.push(syncSource(sql, tailSource));
    }
    const batchResults = await Promise.all(jobs);
    batch.forEach((source, idx) => {
      results[source.name] = batchResults[idx];
    });
    if (tailSource) {
      // The tail source's job was appended after the batch jobs, so its
      // result sits at index batch.length — record it so its new bids count
      // toward totals, alerts and digests.
      results[tailSource.name] = batchResults[batch.length];
    }
  }
  // Safety net for any tail sources left after the final state batch.
  for (; tailIndex < TAIL_SOURCES.length; tailIndex++) {
    const source = TAIL_SOURCES[tailIndex];
    results[source.name] = await syncSource(sql, source);
    await sleep(INTER_SOURCE_DELAY_MS);
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

  // Generate durable in-app bid alerts for every matching profile.
  if (totalNew > 0) {
    try { console.log(`🔔 Created ${await generateBidAlerts(allNewBids.map((b) => b.bid_id as number))} durable bid alert(s)`); }
    catch (err) { console.error("🔔 Failed to generate bid alerts:", (err as Error).message); }
  }

  // Notify matching profiles without allowing notification failures to break sync.
  if (totalNew > 0) {
    try {
      const profiles = await sql`SELECT user_id, industry, locations, service_categories, certifications FROM business_profiles WHERE user_id IS NOT NULL` as any[];
      let notified = 0;
      for (const bid of allNewBids) {
        const text = `${bid.title} ${bid.agency} ${bid.location || ""}`.toLowerCase();
        for (const profile of profiles) {
          const locations = Array.isArray(profile.locations) ? profile.locations : [];
          const services = Array.isArray(profile.service_categories) ? profile.service_categories : [];
          const industry = String(profile.industry || "").toLowerCase();
          const certifications = typeof profile.certifications === "string"
            ? (() => {
                try { return JSON.parse(profile.certifications); } catch { return []; }
              })()
            : profile.certifications;
          const profileCertifications = Array.isArray(certifications)
            ? certifications.filter((cert: unknown): cert is string => typeof cert === "string" && cert.trim().length > 0)
            : [];
          const setAside = String(bid.set_aside || "").toLowerCase();
          const matches = setAside && profileCertifications.length > 0
            ? profileCertifications.some((cert) => setAside.includes(cert.toLowerCase()) || cert.toLowerCase().includes(setAside))
            : !industry || text.includes(industry) || services.some((s: unknown) => text.includes(String(s).toLowerCase())) || locations.some((l: unknown) => text.includes(String(l).toLowerCase()));
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
