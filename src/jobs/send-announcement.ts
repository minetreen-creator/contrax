/**
 * One-time announcement email — CLI entrypoint (`bun run announcement`), run
 * by hand from .github/workflows/announcement-email.yml (owner 2026-10-19).
 *
 * Without SEND=true it is a dry run: it only prints how many accounts would
 * get the email. Each address reached is recorded in `announcement_log` under
 * ANNOUNCEMENT_KEY, so a second run (or a retry after a failure) emails only
 * the accounts not yet reached. ANNOUNCEMENT picks which one (default
 * federal-coverage). Recipient rules: ~/lib/announcement-email.
 */
import { sql } from "~/db";
import { sendAnnouncementEmail } from "~/lib/email";
import { ANNOUNCEMENTS, announcementRecipients, type AnnouncementName, type AnnouncementUserRow } from "~/lib/announcement-email";
import { weeklyUnsubscribeUrl } from "~/lib/weekly-digest";

export async function sendAnnouncement(
  send: boolean,
  name: AnnouncementName = "federal-coverage",
): Promise<{ recipients: number; sent: number }> {
  const { key: ANNOUNCEMENT_KEY, fits, email: buildEmail } = ANNOUNCEMENTS[name];
  await sql()`
    CREATE TABLE IF NOT EXISTS announcement_log (
      announcement TEXT NOT NULL,
      email_lower TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (announcement, email_lower)
    )
  `;
  await sql()`
    CREATE TABLE IF NOT EXISTS email_preferences (
      email_lower TEXT PRIMARY KEY,
      unsubscribe_token TEXT NOT NULL UNIQUE,
      weekly_digest_unsubscribed_at TIMESTAMPTZ
    )
  `;
  await sql()`ALTER TABLE users ADD COLUMN IF NOT EXISTS starter_pass_bought_at TIMESTAMPTZ`;
  const users = (await sql()`
    SELECT email, is_admin, subscription_status, starter_pass_bought_at FROM users ORDER BY id
  `) as AnnouncementUserRow[];
  const optedOut = (await sql()`
    SELECT email_lower FROM email_preferences WHERE weekly_digest_unsubscribed_at IS NOT NULL
  `) as { email_lower: string }[];
  const done = (await sql()`
    SELECT email_lower FROM announcement_log WHERE announcement = ${ANNOUNCEMENT_KEY}
  `) as { email_lower: string }[];
  const recipients = announcementRecipients(
    users,
    new Set(optedOut.map((r) => r.email_lower)),
    new Set(done.map((r) => r.email_lower)),
    fits,
  );
  console.log(
    `📣 ${ANNOUNCEMENT_KEY}: ${users.length} account(s); ${users.filter((u) => !fits(u)).length} not this offer's audience; ${optedOut.length} unsubscribed; ${done.length} already sent; ${recipients.length} to send`,
  );
  if (!send) {
    console.log("📣 Dry run (SEND is not true): nothing sent.");
    return { recipients: recipients.length, sent: 0 };
  }
  if (recipients.length === 0) return { recipients: 0, sent: 0 };

  const lowered = recipients.map((e) => e.toLowerCase());
  await sql()`
    INSERT INTO email_preferences (email_lower, unsubscribe_token)
    SELECT e, replace(gen_random_uuid()::text, '-', '') FROM unnest(${lowered}::text[]) AS e
    ON CONFLICT (email_lower) DO NOTHING
  `;
  const tokens = (await sql()`
    SELECT email_lower, unsubscribe_token FROM email_preferences WHERE email_lower = ANY(${lowered}::text[])
  `) as { email_lower: string; unsubscribe_token: string }[];
  const tokenOf = new Map(tokens.map((t) => [t.email_lower, t.unsubscribe_token]));

  let sent = 0;
  for (const email of recipients) {
    const token = tokenOf.get(email.toLowerCase());
    if (!token) continue;
    const unsubscribeUrl = weeklyUnsubscribeUrl(token);
    const ok = await sendAnnouncementEmail(email, buildEmail(unsubscribeUrl), unsubscribeUrl);
    if (!ok) continue;
    await sql()`
      INSERT INTO announcement_log (announcement, email_lower) VALUES (${ANNOUNCEMENT_KEY}, ${email.toLowerCase()})
      ON CONFLICT DO NOTHING
    `;
    sent++;
    // Stay under Resend's default rate limit (2 requests/second).
    await new Promise((r) => setTimeout(r, 600));
  }
  console.log(`📣 Sent ${sent} of ${recipients.length}`);
  return { recipients: recipients.length, sent };
}

if (import.meta.main) {
  try {
    const name = (process.env.ANNOUNCEMENT || "federal-coverage") as AnnouncementName;
    if (!(name in ANNOUNCEMENTS)) throw new Error(`Unknown ANNOUNCEMENT "${name}"; one of: ${Object.keys(ANNOUNCEMENTS).join(", ")}`);
    await sendAnnouncement(process.env.SEND === "true", name);
    process.exit(0);
  } catch (e) {
    console.error("💥 Announcement crashed:", e);
    process.exit(1);
  }
}
