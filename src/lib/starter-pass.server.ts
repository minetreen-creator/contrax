/**
 * Starter 30-day pass, server side (rules and copy in starter-pass.ts).
 *
 *  - recordCheckoutPass: after a paid plan checkout (webhook and /post-checkout,
 *    both idempotent), a pass sets its end date; a subscription clears any pass
 *    so the expiry job never touches a subscriber.
 *    The first time an account buys a pass, the owner gets a phone push
 *    (Mission Control alerts) and an email.
 *  - starterKindForUser: which monthly Starter checkout an account gets.
 *  - runStarterPassJobs (daily, /api/cron/starter-pass): one reminder email five
 *    days before the end, then the account returns to free Basic once the pass
 *    has ended without a subscription. Nothing is ever charged automatically.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { sql } from "~/db";
import {
  PASS_ENDED_STATUS,
  passBoughtOwnerAlert,
  passConfirmationEmail,
  passReminderEmail,
  STARTER_PASS_FLAG,
  STARTER_PASS_REMIND_DAYS,
  starterCheckoutKind,
  starterPassEligibleRequest,
  starterPassEndsAt,
  type PassRecap,
  type StarterCheckoutKind,
} from "~/lib/starter-pass";

// ── One-click renewal link (owner 2026-11-07, "2 only") ─────────────────────
// The reminder's button is a signed link naming one account and an expiry
// (14 days after the pass ends). It only opens a $19/month Starter checkout for
// that account; nothing is charged unless the buyer completes Stripe's page.

export const RENEW_LINK_GRACE_DAYS = 14;
const RENEW_PATH = "https://www.contrax.company/api/renew-pass";

function renewKey(env: Record<string, string | undefined> = process.env): Buffer {
  const secret = env.CRON_SECRET || env.OUTREACH_SECRET || env.RESEND_API_KEY;
  if (!secret) throw new Error("No secret available to sign pass renewal links");
  return createHmac("sha256", "contrax-pass-renew").update(secret).digest();
}

export function passRenewToken(userId: number, endsAt: Date, env?: Record<string, string | undefined>): string {
  const exp = Math.floor(endsAt.getTime() / 1000) + RENEW_LINK_GRACE_DAYS * 86_400;
  const body = `${userId}.${exp}`;
  const sig = createHmac("sha256", renewKey(env)).update(body).digest("base64url").slice(0, 32);
  return `${Buffer.from(body).toString("base64url")}.${sig}`;
}

/** The account id a valid, unexpired token names, or null. */
export function verifyPassRenewToken(token: string, now: number = Date.now(), env?: Record<string, string | undefined>): number | null {
  const [b64, sig] = String(token ?? "").split(".");
  if (!b64 || !sig) return null;
  let body: string;
  try {
    body = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const m = /^(\d+)\.(\d+)$/.exec(body);
  if (!m) return null;
  const expected = createHmac("sha256", renewKey(env)).update(body).digest("base64url").slice(0, 32);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(m[2]) * 1000 < now) return null;
  return Number(m[1]);
}

export function passRenewUrl(userId: number, endsAt: Date, env?: Record<string, string | undefined>): string {
  return `${RENEW_PATH}?t=${encodeURIComponent(passRenewToken(userId, endsAt, env))}`;
}

/** What the pass matched for this account since it started (live bids only); null when unknown. */
async function loadPassRecap(userId: number, since: Date): Promise<PassRecap | null> {
  try {
    const { loadUpgradePitch } = await import("~/lib/upgrade-pitch.server");
    const { tradePlace } = await import("~/lib/upgrade-pitch");
    const pitch = await loadUpgradePitch(userId, since.toISOString());
    if (!pitch) return null;
    return {
      since,
      newMatches: pitch.newMatches,
      examples: pitch.examples.map((b) => ({ id: b.id, title: b.title, agency: b.agency, dueDate: b.dueDate })),
      tradePlace: tradePlace(pitch),
    };
  } catch (e) {
    console.error(`[starter-pass] recap for user ${userId} failed:`, (e as Error).message);
    return null;
  }
}

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
    // Claim the first purchase atomically: the webhook and /post-checkout both
    // land here, and only the call that sets bought_at alerts the owner.
    const firstPurchase = (await sql()`UPDATE users SET starter_pass_bought_at = ${bought}
      WHERE id = ${userId} AND starter_pass_bought_at IS NULL
      RETURNING email`) as { email: string | null }[];
    await sql()`UPDATE users
      SET starter_pass_bought_at = COALESCE(starter_pass_bought_at, ${bought}),
          starter_pass_ends_at = ${ends},
          starter_pass_reminded_at = NULL
      WHERE id = ${userId}`;
    if (firstPurchase.length) {
      await alertOwnerOfPass(firstPurchase[0].email, new Date(ends));
      await sendPassConfirmation(firstPurchase[0].email, new Date(ends));
    }
  } else if (session.mode === "subscription") {
    await sql()`UPDATE users SET starter_pass_ends_at = NULL WHERE id = ${userId}`;
  }
}

const OWNER_EMAIL = "minetreen@gmail.com";

/** Phone push and email to the owner for a new pass. Never throws: a failed alert must not fail the checkout. */
async function alertOwnerOfPass(buyerEmail: string | null, endsAt: Date): Promise<void> {
  const alert = passBoughtOwnerAlert(buyerEmail, endsAt);
  try {
    const { alertOwner } = await import("~/lib/live-push.server");
    await alertOwner(alert.push);
  } catch (e) {
    console.error("[starter-pass] owner push failed:", (e as Error).message);
  }
  if (!process.env.RESEND_API_KEY) return;
  try {
    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: "Contrax <hello@contrax.company>",
      to: OWNER_EMAIL,
      subject: alert.subject,
      text: alert.text,
    });
  } catch (e) {
    console.error("[starter-pass] owner email failed:", (e as Error).message);
  }
}

/** The buyer's written confirmation: end date, nothing renews. Never throws. */
async function sendPassConfirmation(buyerEmail: string | null, endsAt: Date): Promise<void> {
  if (!buyerEmail || !process.env.RESEND_API_KEY) return;
  const mail = passConfirmationEmail(endsAt);
  try {
    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: "Contrax <hello@contrax.company>",
      replyTo: "contrax.companyllc@gmail.com",
      to: buyerEmail,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  } catch (e) {
    console.error("[starter-pass] buyer confirmation failed:", (e as Error).message);
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
    SELECT id, email, starter_pass_ends_at, starter_pass_bought_at FROM users
    WHERE starter_pass_ends_at IS NOT NULL
      AND starter_pass_reminded_at IS NULL
      AND starter_pass_ends_at > NOW()
      AND starter_pass_ends_at <= NOW() + ${`${STARTER_PASS_REMIND_DAYS} days`}::interval
  `) as { id: number; email: string; starter_pass_ends_at: string | Date; starter_pass_bought_at: string | Date | null }[];
  if (due.length && !key) console.warn("[starter-pass] RESEND_API_KEY not set; reminders not sent");
  if (key) {
    const resend = new Resend(key);
    for (const u of due) {
      const endsAt = new Date(u.starter_pass_ends_at);
      const since = u.starter_pass_bought_at ? new Date(u.starter_pass_bought_at) : new Date(endsAt.getTime() - 30 * 86_400_000);
      let renewUrl: string | undefined;
      try {
        renewUrl = passRenewUrl(u.id, endsAt);
      } catch (e) {
        console.error("[starter-pass] renew link unavailable:", (e as Error).message);
      }
      const mail = passReminderEmail(endsAt, { recap: await loadPassRecap(u.id, since), renewUrl });
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
