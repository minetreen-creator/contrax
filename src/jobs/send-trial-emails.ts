/**
 * Trial-ending emails — CLI entrypoint (`bun run trial-emails`), run once a
 * morning from .github/workflows/daily-emails.yml (owner 2026-10-19).
 *
 * Sends each member at most one "trial ends in 2 days" and one "trial ended"
 * email (rules in ~/lib/trial-emails), with their own counts from
 * ~/lib/trial-recap.server. A send is recorded on the user row only when
 * Resend accepted it, so a failed morning retries the next day.
 */
import { sql } from "~/db";
import { isAdminEmail } from "~/lib/admin";
import { sendTrialEmail } from "~/lib/email";
import { trialEmailContent, trialEmailStage, type TrialEmailRow } from "~/lib/trial-emails";
import { loadOpenBids, primaryProfile, trialRecapFor, type OpenBid } from "~/lib/trial-recap.server";

export async function sendTrialEmails(now: number = Date.now()): Promise<{ reminder: number; ended: number }> {
  await sql()`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_reminder_sent_at TIMESTAMPTZ`;
  await sql()`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ended_sent_at TIMESTAMPTZ`;

  const users = (await sql()`
    SELECT id, email, is_admin, trial_started_at, subscription_status, access_expires_at,
           trial_reminder_sent_at, trial_ended_sent_at
    FROM users
    WHERE trial_started_at IS NOT NULL
      AND COALESCE(subscription_status, '') <> 'active'
      AND (trial_reminder_sent_at IS NULL OR trial_ended_sent_at IS NULL)
  `) as (TrialEmailRow & { id: number; email: string })[];

  const due = users
    .filter((u) => !isAdminEmail(String(u.email)) && !String(u.email).toLowerCase().endsWith("@test.contrax"))
    .map((u) => ({ u, stage: trialEmailStage(u, now) }))
    .filter((x) => x.stage !== null);
  console.log(`⏳ ${users.length} trial account(s) checked; ${due.length} due a trial email`);
  if (due.length === 0) return { reminder: 0, ended: 0 };

  const open: OpenBid[] = await loadOpenBids();
  const sent = { reminder: 0, ended: 0 };
  for (const { u, stage } of due) {
    const recap = await trialRecapFor(u.id, await primaryProfile(u.id), open, now);
    const ok = await sendTrialEmail(String(u.email).trim(), trialEmailContent(stage!, recap));
    if (!ok) continue;
    if (stage === "reminder") await sql()`UPDATE users SET trial_reminder_sent_at = NOW() WHERE id = ${u.id}`;
    else await sql()`UPDATE users SET trial_ended_sent_at = NOW() WHERE id = ${u.id}`;
    sent[stage!]++;
  }
  console.log(`⏳ Trial emails sent: ${sent.reminder} reminder(s), ${sent.ended} ended notice(s)`);
  return sent;
}

if (import.meta.main) {
  try {
    await sendTrialEmails();
    process.exit(0);
  } catch (e) {
    console.error("💥 Trial emails crashed:", e);
    process.exit(1);
  }
}
