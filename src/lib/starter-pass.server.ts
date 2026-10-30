/**
 * Starter 30-day pass, server side (rules and copy in starter-pass.ts).
 *
 *  - recordCheckoutPass: after a paid plan checkout (webhook and /post-checkout,
 *    both idempotent), a pass sets its end date; a subscription clears any pass
 *    so the expiry job never touches a subscriber.
 *  - starterKindForUser: which monthly Starter checkout an account gets.
 *  - runStarterPassJobs (daily, /api/cron/starter-pass): one reminder email five
 *    days before the end, then the account returns to free Basic once the pass
 *    has ended without a subscription. Nothing is ever charged automatically.
 */
import { Resend } from "resend";
import { sql } from "~/db";
import {
  PASS_ENDED_STATUS,
  passReminderEmail,
  STARTER_PASS_FLAG,
  STARTER_PASS_REMIND_DAYS,
  starterCheckoutKind,
  starterPassEligibleRequest,
  starterPassEndsAt,
  type StarterCheckoutKind,
} from "~/lib/starter-pass";

let ensured = false;
export async function ensureStarterPassColumns(): Promise<void> {
  if (ensured) return;
  await sql()`ALTER TABLE users
    ADD COLUMN IF NOT EXISTS starter_pass_bought_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS starter_pass_ends_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS starter_pass_reminded_at TIMESTAMPTZ`;
  ensured = true;
}

export async function recordCheckoutPass(
  userId: number,
  session: { metadata?: Record<string, string> | null; mode?: string | null; created: number },
): Promise<void> {
  await ensureStarterPassColumns();
  if (session.metadata?.[STARTER_PASS_FLAG] === "true") {
    const ends = starterPassEndsAt(session.created).toISOString();
    const bought = new Date(session.created * 1000).toISOString();
    await sql()`UPDATE users
      SET starter_pass_bought_at = COALESCE(starter_pass_bought_at, ${bought}),
          starter_pass_ends_at = ${ends},
          starter_pass_reminded_at = NULL
      WHERE id = ${userId}`;
  } else if (session.mode === "subscription") {
    await sql()`UPDATE users SET starter_pass_ends_at = NULL WHERE id = ${userId}`;
  }
}

export async function starterKindForUser(userId: number | null): Promise<StarterCheckoutKind> {
  if (userId == null) return starterCheckoutKind({ signedIn: false });
  await ensureStarterPassColumns();
  const [u] = (await sql()`SELECT subscription_status, starter_pass_bought_at FROM users WHERE id = ${userId}`) as {
    subscription_status: string | null;
    starter_pass_bought_at: string | Date | null;
  }[];
  return starterCheckoutKind({ signedIn: true, subscriptionStatus: u?.subscription_status, passBoughtAt: u?.starter_pass_bought_at });
}

export async function runStarterPassJobs(): Promise<{ reminded: number; failed: number; ended: number }> {
  await ensureStarterPassColumns();
  let reminded = 0;
  let failed = 0;
  const key = process.env.RESEND_API_KEY;
  const due = (await sql()`
    SELECT id, email, starter_pass_ends_at FROM users
    WHERE starter_pass_ends_at IS NOT NULL
      AND starter_pass_reminded_at IS NULL
      AND starter_pass_ends_at > NOW()
      AND starter_pass_ends_at <= NOW() + ${`${STARTER_PASS_REMIND_DAYS} days`}::interval
  `) as { id: number; email: string; starter_pass_ends_at: string | Date }[];
  if (due.length && !key) console.warn("[starter-pass] RESEND_API_KEY not set; reminders not sent");
  if (key) {
    const resend = new Resend(key);
    for (const u of due) {
      const mail = passReminderEmail(new Date(u.starter_pass_ends_at));
      try {
        const { error } = await resend.emails.send({
          from: "Contrax <hello@contrax.company>",
          replyTo: "contrax.companyllc@gmail.com",
          to: [u.email],
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        });
        if (error) throw new Error(error.message);
        await sql()`UPDATE users SET starter_pass_reminded_at = NOW() WHERE id = ${u.id}`;
        reminded++;
      } catch (e) {
        failed++;
        console.error(`[starter-pass] reminder to user ${u.id} failed:`, (e as Error).message);
      }
    }
  }
  // Passes that ran out without a subscription go back to free Basic.
  const ended = (await sql()`
    UPDATE users
    SET plan_tier = 'basic', subscription_status = ${PASS_ENDED_STATUS}, starter_pass_ends_at = NULL
    WHERE starter_pass_ends_at IS NOT NULL AND starter_pass_ends_at <= NOW()
    RETURNING id
  `) as unknown[];
  return { reminded, failed, ended: ended.length };
}

/**
 * Extra createCheckoutSession options for a plan checkout request: the $5 pass
 * for a first-time monthly Starter buyer, full price for a returning pass
 * buyer, nothing for every other checkout.
 */
export async function starterCheckoutOptions(
  body: Parameters<typeof starterPassEligibleRequest>[0],
  userId: number | null,
): Promise<{ starterPass?: true; fullPrice?: true }> {
  if (!starterPassEligibleRequest(body)) return {};
  const kind = await starterKindForUser(userId);
  if (kind === "pass") return { starterPass: true };
  if (kind === "subscription_full_price") return { fullPrice: true };
  return {};
}
