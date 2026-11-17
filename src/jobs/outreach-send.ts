/**
 * Automatic outreach sending — CLI entrypoint (`bun run outreach-send`), run on weekdays by
 * .github/workflows/outreach-send.yml (owner 2026-11-17, away for a few days: "Send them
 * automatically").
 *
 * This job does not send email itself. It writes a one-use ticket to the database and asks the live
 * site to send the next few waiting drafts, again and again until none are left or the day's limit
 * is reached. The site renders and signs each email, so unsubscribe links work, and it never sends
 * to a do-not-contact address. Prints counts only, never an address.
 */
import { AUTO_SEND_MAX_CALLS, autoSendDone } from "~/lib/outreach";
import { issueSendTicket } from "~/lib/outreach.server";

const SITE = "https://www.contrax.company";

async function main() {
  let sent = 0, failed = 0, skipped = 0, left = 0, room = 0;
  for (let call = 1; call <= AUTO_SEND_MAX_CALLS; call++) {
    const ticket = await issueSendTicket();
    const res = await fetch(`${SITE}/api/outreach/auto-send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Site answered ${res.status} on call ${call}: ${(await res.text()).slice(0, 200)}`);
    const r = (await res.json()) as { sent: number; failed: number; skipped: number; left: number; room: number };
    sent += r.sent; failed += r.failed; skipped += r.skipped; left = r.left; room = r.room;
    console.log(`call ${call}: sent ${r.sent}, failed ${r.failed}, skipped ${r.skipped}, ${r.left} waiting, room for ${r.room} more today`);
    if (autoSendDone(r)) break;
  }
  console.log(`📬 Outreach sent automatically: ${sent} sent, ${failed} failed, ${skipped} skipped. ${left} still waiting; room for ${room} more today.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
