/**
 * The morning emails from GitHub (`bun run daily-emails`): the backup trigger. Vercel Cron is the
 * main one (/api/cron/daily-emails). Both use the same runner and the same once-a-day claims
 * (src/lib/daily-emails.server.ts), so whichever comes first sends and the other skips.
 */
import { runDailyEmails } from "~/lib/daily-emails.server";

try {
  const r = await runDailyEmails("github");
  if (!r.due) console.log(`Before 6 AM in New York (${r.day}): not yet.`);
  for (const j of r.ran) console.log(`${j.status === "done" ? "✅" : "❌"} ${j.job}: ${j.detail}`);
  if (r.skipped.length) console.log(`Already run today (${r.day}): ${r.skipped.join(", ")}`);
  process.exit(r.ran.some((j) => j.status === "failed") ? 1 : 0);
} catch (e) {
  console.error("💥 Daily emails crashed:", e);
  process.exit(1);
}
