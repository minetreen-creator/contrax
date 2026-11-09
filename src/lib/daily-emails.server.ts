/**
 * Runs the morning emails (owner 2026-11-09: "github isn't reliable" / "move the email to
 * vercel"). Vercel Cron calls /api/cron/daily-emails every 10 minutes from 10:00 to 15:50 UTC;
 * the GitHub workflow stays as a backup and calls the same runner (src/jobs/daily-emails.ts).
 *
 * Once a day, never twice: before a job runs it claims its row in daily_email_runs for today's
 * New York date. A claimed job is never run again that day, even if it failed, because a failed
 * send may have reached some people (the same rule the GitHub gate used). Each job is claimed on
 * its own, so one failing job does not stop the others.
 */
import { sql } from "~/db";
import { DAILY_EMAIL_JOBS, dailyEmailsDue, newYorkDayAndHour, type DailyEmailJob } from "~/lib/daily-emails";

type Db = typeof sql;

export async function ensureDailyEmailRuns(db: Db = sql): Promise<void> {
  await db()`
    CREATE TABLE IF NOT EXISTS daily_email_runs (
      day DATE NOT NULL,
      job TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      detail TEXT,
      PRIMARY KEY (day, job)
    )
  `;
}

/** Claims today's run of one job. True only for the one caller that got it. */
async function claim(db: Db, day: string, job: DailyEmailJob, trigger: string): Promise<boolean> {
  const rows = (await db()`
    INSERT INTO daily_email_runs (day, job, status, trigger)
    VALUES (${day}, ${job}, 'running', ${trigger})
    ON CONFLICT (day, job) DO NOTHING
    RETURNING job
  `) as { job: string }[];
  return rows.length === 1;
}

async function finish(db: Db, day: string, job: DailyEmailJob, status: "done" | "failed", detail: string): Promise<void> {
  await db()`
    UPDATE daily_email_runs SET status = ${status}, finished_at = NOW(), detail = ${detail.slice(0, 500)}
    WHERE day = ${day} AND job = ${job}
  `;
}

async function runJob(job: DailyEmailJob): Promise<unknown> {
  switch (job) {
    case "bid-digest":
      return (await import("~/jobs/send-bid-digest")).sendMorningBidDigest();
    case "trial-emails":
      return (await import("~/jobs/send-trial-emails")).sendTrialEmails();
    case "weekly-digest":
      return (await import("~/jobs/send-weekly-digest")).sendWeeklyDigest();
    case "radar-alerts":
      return (await import("~/lib/radar-lead-alerts")).sendRadarLeadMatchAlerts();
    case "max-reminders":
      return (await import("~/lib/max-reminders.server")).sendDueBidReminders();
    case "award-check":
      return (await import("~/jobs/check-awards")).checkAwards();
  }
}

/**
 * A morning already sent some other way (the old GitHub gate on the day this went live, or a
 * manual `bun run bid-digest`): if bid_digest_log shows a send on this New York date and nothing
 * is claimed for it yet, every job is marked done so no one gets a second email that day.
 */
async function adoptEarlierSend(db: Db, day: string): Promise<boolean> {
  const claimed = (await db()`SELECT COUNT(*)::int AS n FROM daily_email_runs WHERE day = ${day}`) as { n: number }[];
  if (Number(claimed[0]?.n ?? 0) > 0) return false;
  let sent: { n: number }[] = [];
  try {
    sent = (await db()`
      SELECT COUNT(*)::int AS n FROM bid_digest_log
      WHERE (sent_at AT TIME ZONE 'America/New_York')::date = ${day}::date
    `) as { n: number }[];
  } catch {
    return false; // no digest log yet
  }
  if (Number(sent[0]?.n ?? 0) === 0) return false;
  for (const job of DAILY_EMAIL_JOBS) {
    await db()`
      INSERT INTO daily_email_runs (day, job, status, trigger, finished_at, detail)
      VALUES (${day}, ${job}, 'done', 'earlier', NOW(), 'sent before this runner existed')
      ON CONFLICT (day, job) DO NOTHING
    `;
  }
  return true;
}

export interface DailyEmailsResult {
  day: string;
  due: boolean;
  ran: { job: DailyEmailJob; status: "done" | "failed"; detail: string }[];
  skipped: DailyEmailJob[];
}

export async function runDailyEmails(
  trigger: string,
  now: Date = new Date(),
  deps: { db?: Db; run?: (job: DailyEmailJob) => Promise<unknown> } = {},
): Promise<DailyEmailsResult> {
  const db = deps.db ?? sql;
  const run = deps.run ?? runJob;
  const { day } = newYorkDayAndHour(now);
  if (!dailyEmailsDue(now)) return { day, due: false, ran: [], skipped: [] };
  await ensureDailyEmailRuns(db);
  if (await adoptEarlierSend(db, day)) console.log(`[daily-emails] ${day} was already sent earlier; nothing more today.`);
  const ran: DailyEmailsResult["ran"] = [];
  const skipped: DailyEmailJob[] = [];
  for (const job of DAILY_EMAIL_JOBS) {
    if (!(await claim(db, day, job, trigger))) {
      skipped.push(job);
      continue;
    }
    try {
      const r = await run(job);
      const detail = JSON.stringify(r ?? {});
      await finish(db, day, job, "done", detail);
      ran.push({ job, status: "done", detail });
      console.log(`[daily-emails] ${job} done: ${detail}`);
    } catch (e) {
      const detail = (e as Error).message ?? String(e);
      await finish(db, day, job, "failed", detail).catch(() => {});
      ran.push({ job, status: "failed", detail });
      console.error(`[daily-emails] ${job} failed: ${detail}`);
    }
  }
  return { day, due: true, ran, skipped };
}
