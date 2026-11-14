/**
 * Buyer notes — CLI entrypoint (`bun run buyer-notes`), run by hand from
 * .github/workflows/buyer-notes.yml (owner 2026-11-14). For each open bid whose
 * contractor emails have actually been SENT, finds the buyer's own address in
 * the bid text or on its official posting and queues one note telling the
 * buyer how many local contractors the bid went to. Queues drafts only;
 * nothing is sent until the owner approves the list on /admin/outreach.
 *
 * Dry run unless APPLY=true: a dry run prints what it would queue.
 */
import { buyerEmail } from "~/lib/outreach";
import { bidsOwedBuyerNote, queueBuyerNote } from "~/lib/outreach.server";
import { extractEmails } from "~/lib/prospect-finder";
import { siteEmails } from "./prospect-finder";

async function main() {
  const apply = process.env.APPLY === "true";
  const bids = await bidsOwedBuyerNote();
  console.log(`${bids.length} open bid(s) with contractor emails sent and no buyer note yet.${apply ? "" : " Dry run."}\n`);
  let found = 0;
  let queued = 0;
  for (const b of bids) {
    console.log(`#${b.bid_id} ${b.bid_title} (${b.buyer ?? "-"}, due ${b.due}) — sent to ${b.sent}`);
    // The bid's own text first; then the official posting page.
    let email = buyerEmail(extractEmails(b.description ?? ""));
    let where = "bid text";
    if (!email && /^https?:\/\//i.test(b.source_url ?? "")) {
      const { emails } = await siteEmails(b.source_url!);
      email = buyerEmail(emails);
      where = "official posting";
    }
    if (!email) {
      console.log("   no buyer address found");
      continue;
    }
    found++;
    if (!apply) {
      console.log(`   would queue → ${email} (${where})`);
      continue;
    }
    const ok = await queueBuyerNote({ email, bid: b });
    if (ok) queued++;
    console.log(ok ? `   ✉️ queued → ${email} (${where})` : `   skipped ${email}: already known or suppressed`);
  }
  console.log(
    apply
      ? `\nBuyer notes queued: ${queued}. Approve them at https://www.contrax.company/admin/outreach`
      : `\nBuyer addresses found: ${found} of ${bids.length}. Re-run with apply = true to queue the drafts.`,
  );
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("💥 Buyer notes crashed:", e);
      process.exit(1);
    });
}
