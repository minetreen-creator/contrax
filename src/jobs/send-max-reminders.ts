/**
 * Send Max's deadline reminders (src/lib/max-reminders.server.ts) — CLI entrypoint.
 *
 *   bun run max-reminders   (package.json script)
 *
 * Runs from the Daily Emails workflow each morning: every reminder now due,
 * for a confirmed lead, whose bid is still open, is emailed once.
 */
import { sendDueBidReminders } from "../lib/max-reminders.server";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — cannot send Max reminders");
    process.exit(1);
  }
  const r = await sendDueBidReminders();
  console.log(`🏁 Max reminders: due=${r.due} sent=${r.sent}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("💥 Max reminders crashed:", e);
    process.exit(1);
  });
