/**
 * CRM follow-up reminder worker — CLI entrypoint (owner handoff 2026-10-10, item 4;
 * CRM phase 3a).
 *
 *   bun run src/jobs/crm-reminder-send.ts
 *   # or: bun run crm-reminders   (package.json script)
 *
 * ONE RUN against the live DB: it rechecks every opted-in account's entitlement,
 * finds the saved-bid follow-up dates that have come due IN THAT USER'S TIMEZONE, and
 * sends at most one email per (user, saved bid, follow-up date) window through the
 * delivery ledger that makes a duplicate impossible. `.github/workflows/crm-reminders.yml`
 * calls it once a day.
 *
 * This is the ONLY thing in the feature that sends: runCrmReminderSweep() sends
 * nothing for an account whose `reminders_opt_in` is false, and nothing for an
 * account that is not entitled at the moment of the run. A window that has already
 * been delivered (or whose outcome is unknown) is never emailed again.
 *
 * Required env: DATABASE_URL (the run refuses to start without it). RESEND_API_KEY is
 * required for delivery — without it the mail adapter reports a failed attempt, which
 * is recorded on the ledger and retried on a later run (never silently lost).
 */
import { sendCrmFollowUpReminderEmail } from "../lib/email";
import {
  crmReminderEntitlementChecker,
  neonCrmReminderStore,
  runCrmReminderSweep,
  type ReminderEmailItem,
  type ReminderMailer,
} from "../lib/crm-reminders.server";

/**
 * The production mailer: the repo's existing Resend transactional helper. A false
 * result (missing key, provider error, thrown transport failure) becomes a recorded
 * failure rather than a crash, so the worker keeps going and the next run retries
 * that one window.
 */
const resendReminderMailer: ReminderMailer = {
  async send(to: string, items: ReminderEmailItem[]) {
    const ok = await sendCrmFollowUpReminderEmail(to, items);
    return ok ? { ok: true } : { ok: false, error: "provider did not accept the message" };
  },
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — cannot send follow-up reminders");
    process.exit(1);
  }
  const started = Date.now();
  const result = await runCrmReminderSweep({
    store: neonCrmReminderStore,
    entitlement: crmReminderEntitlementChecker,
    mailer: resendReminderMailer,
    now: new Date(),
  });
  console.log(
    `\n🏁 Follow-up reminders finished in ${((Date.now() - started) / 1000).toFixed(1)}s — ` +
      `users=${result.usersChecked} (opted-out=${result.usersSkippedOptOut} ` +
      `unentitled=${result.usersSkippedUnentitled} no-email=${result.usersSkippedEmail}) ` +
      `due-windows=${result.windowsDue} emails=${result.emailsSent} ` +
      `retried=${result.windowsRetried} skipped=${result.windowsSkipped} ` +
      `failures=${result.failures} follow-ups=${result.followUpsConsidered}`,
  );
  for (const line of result.notes) console.log(`  · ${line}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("💥 Follow-up reminder worker crashed:", e);
    process.exit(1);
  });
