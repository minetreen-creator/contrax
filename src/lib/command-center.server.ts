import { sql } from "~/db";
import { likelyCause } from "~/jobs/source-alerts";
import type { CommandCounts } from "~/lib/command-center";

/** Each read is separate and fail-soft: a missing table reads as zero, never as an invented number. */
async function n(q: () => Promise<unknown>): Promise<number> {
  try {
    const rows = (await q()) as { n: number | string | null }[];
    return Number(rows?.[0]?.n ?? 0) || 0;
  } catch {
    return 0;
  }
}

export async function commandCounts(): Promise<CommandCounts> {
  const db = sql();
  const [outreachDrafts, outreachSentToday, storiesPending, dataFeedRequestsNew, bidFitReviewsOpen, nonprofitReviews, passesEndingSoon, sourcesSyncedToday, newBidsToday, openBids, federalFiguresFailing] = await Promise.all([
    n(() => db`SELECT COUNT(*)::int AS n FROM outreach_contacts WHERE status = 'draft' AND due_date >= CURRENT_DATE + 2`),
    n(() => db`SELECT COUNT(*)::int AS n FROM outreach_contacts WHERE status = 'sent' AND sent_at >= CURRENT_DATE`),
    n(() => db`SELECT COUNT(*)::int AS n FROM success_stories WHERE status = 'pending'`),
    n(() => db`SELECT COUNT(*)::int AS n FROM data_feed_requests WHERE status = 'new'`),
    n(() => db`SELECT COUNT(*)::int AS n FROM bid_fit_review_requests WHERE status IN ('new', 'reviewing', 'in_progress')`),
    n(() => db`SELECT COUNT(*)::int AS n FROM nonprofit_applications WHERE status = 'manual_review'`),
    n(() => db`SELECT COUNT(*)::int AS n FROM users WHERE starter_pass_ends_at BETWEEN NOW() AND NOW() + INTERVAL '5 days' AND is_admin = false`),
    n(() => db`SELECT COUNT(DISTINCT source)::int AS n FROM sync_logs WHERE created_at > NOW() - INTERVAL '24 hours'`),
    n(() => db`SELECT COALESCE(SUM(new), 0)::int AS n FROM sync_logs WHERE created_at > NOW() - INTERVAL '24 hours'`),
    n(() => db`SELECT COUNT(*)::int AS n FROM bids WHERE due_date > NOW()`),
    n(() => db`SELECT COUNT(*)::int AS n FROM local_award_snapshots WHERE failed_runs >= 3`),
  ]);
  let failingSources: { source: string; cause: string }[] = [];
  try {
    // A source is failing when its latest run in the last day read nothing and logged an error.
    const rows = (await db`
      SELECT DISTINCT ON (source) source, fetched, errors FROM sync_logs
      WHERE created_at > NOW() - INTERVAL '24 hours'
      ORDER BY source, created_at DESC`) as { source: string; fetched: number; errors: string | null }[];
    failingSources = rows
      .filter((r) => Number(r.fetched) === 0 && r.errors && r.errors.trim())
      .map((r) => ({ source: r.source, cause: likelyCause(String(r.errors)) }));
  } catch {
    failingSources = [];
  }
  const last = async (q: () => Promise<unknown>) => {
    try {
      const rows = (await q()) as { at: string | Date | null }[];
      return rows?.[0]?.at ? new Date(rows[0].at).toISOString() : null;
    } catch {
      return null;
    }
  };
  const [lastSyncAt, federalFiguresLastAt] = await Promise.all([
    last(() => db`SELECT MAX(created_at) AS at FROM sync_logs`),
    last(() => db`SELECT MAX(fetched_at) AS at FROM local_award_snapshots`),
  ]);
  return {
    outreachDrafts,
    outreachSentToday,
    storiesPending,
    dataFeedRequestsNew,
    bidFitReviewsOpen,
    nonprofitReviews,
    passesEndingSoon,
    failingSources,
    sourcesSyncedToday,
    newBidsToday,
    openBids,
    lastSyncAt,
    federalFiguresFailing,
    federalFiguresLastAt,
  };
}

let notesReady = false;
async function ensureNotes() {
  if (notesReady) return;
  await sql()`CREATE TABLE IF NOT EXISTS admin_notes (id SERIAL PRIMARY KEY, body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), done_at TIMESTAMPTZ)`;
  notesReady = true;
}

export async function listNotes(): Promise<{ id: number; body: string; created_at: string }[]> {
  await ensureNotes();
  const rows = (await sql()`SELECT id, body, created_at FROM admin_notes WHERE done_at IS NULL ORDER BY created_at DESC LIMIT 20`) as { id: number; body: string; created_at: string | Date }[];
  return rows.map((r) => ({ id: Number(r.id), body: r.body, created_at: new Date(r.created_at).toISOString() }));
}

export async function addNote(body: string): Promise<void> {
  await ensureNotes();
  await sql()`INSERT INTO admin_notes (body) VALUES (${body})`;
}

export async function doneNote(id: number): Promise<void> {
  await ensureNotes();
  await sql()`UPDATE admin_notes SET done_at = NOW() WHERE id = ${id}`;
}
