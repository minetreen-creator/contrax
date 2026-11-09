/**
 * Morning bid digest — CLI entrypoint (`bun run bid-digest`).
 *
 * Runs once a day from .github/workflows/daily-emails.yml (owner 2026-10-01:
 * "people shouldn't get emails every 4 hours, just once a day in the
 * morning"). The 4-hourly sync no longer emails anyone.
 *
 * It covers the open bids added since the last digest that was actually sent
 * (src/lib/digest-recipients.ts → digestWindowStart) and sends each paying /
 * trial / Bid Scout / admin member (isDigestEligible) THEIR OWN email listing
 * only the bids that match their profile's states and trade
 * (src/lib/digest-match.ts, owner 2026-10-01). A member with no trade or
 * states set gets the full list with a prompt to set them; a member with no
 * matching bids that morning gets no email. A send is recorded in
 * bid_digest_log only when Resend accepted at least one email, so a failed
 * morning is covered by the next one instead of being lost.
 */
import { sql } from "~/db";
import { sendPersonalBidDigests } from "~/lib/email";
import { isDigestEligible } from "~/lib/digest-recipients";
import { ensureBidDigestLog, loadDigestBids, loadDigestMembers } from "~/lib/digest-inputs.server";
import { autopilotBidsOf, autopilotProfileOf, memberDigestBids } from "~/lib/digest-member";
import { autopilotEmailHtml, strongPicks } from "~/lib/autopilot";
import { autopilotEnabled, autopilotForMember, ensureAutopilotTable, newAutopilotBudget } from "~/lib/autopilot.server";

export { ensureBidDigestLog };

/**
 * AI calls the email job itself may make (owner 2026-11-09: GitHub isn't reliable). Auto-Pilot's
 * scoring runs on Vercel before 6 AM (src/lib/autopilot-prescore.server.ts) and saves its answers;
 * this job reads them and only tops up a few that are missing.
 */
const EMAIL_JOB_AI_CAP = 60;

export async function sendMorningBidDigest(): Promise<{ bids: number; recipients: number; sent: boolean }> {
  const now = new Date();
  const { since, bids: newBids } = await loadDigestBids(now);
  console.log(`📧 Morning digest window ${since.toISOString()} → ${now.toISOString()}: ${newBids.length} new open bid(s)`);
  if (newBids.length === 0) return { bids: 0, recipients: 0, sent: false };

  const users = await loadDigestMembers();

  // Auto-Pilot (owner 2026-11-09): for members with a profile, the email leads with the strong
  // fits (src/lib/autopilot.ts). Answers saved before 6 AM are reused; skipped without a key.
  const autopilotOn = autopilotEnabled();
  try {
    await ensureAutopilotTable();
  } catch (e) {
    console.warn(`[autopilot] table check failed: ${(e as Error).message}`);
  }
  const budget = newAutopilotBudget(EMAIL_JOB_AI_CAP);
  // Top-ups stop after 30 seconds so the email is never held up (it runs on Vercel).
  const deadline = Date.now() + 30_000;
  let autopilotMembers = 0;

  const seen = new Set<string>();
  const emails: Parameters<typeof sendPersonalBidDigests>[0] = [];
  let noMatches = 0;
  for (const u of users) {
    if (!isDigestEligible(u)) continue;
    const to = String(u.email).trim();
    if (seen.has(to.toLowerCase())) continue;
    seen.add(to.toLowerCase());
    const { matcher, main: mine, openToAll } = memberDigestBids(u, newBids);
    if (mine.length === 0 && openToAll.length === 0) {
      noMatches++;
      continue;
    }
    const strip = (list: typeof mine) => list.map(({ match: _match, ...b }) => b);
    let autopilotHtml = "";
    let autopilotPicks = 0;
    if (matcher.personal && u.user_id) {
      try {
        const verdicts = await autopilotForMember(Number(u.user_id), autopilotProfileOf(u), autopilotBidsOf(mine, openToAll), budget, { deadline });
        const byId = new Map([...mine, ...openToAll].map((b) => [b.bid_id, b]));
        const picks = strongPicks(verdicts).map((v) => {
          const b = byId.get(v.bid_id)!;
          return { verdict: v, title: b.title, agency: b.agency, due: b.due_date, url: `https://www.contrax.company/bid/${v.bid_id}` };
        });
        autopilotHtml = autopilotEmailHtml(picks);
        autopilotPicks = picks.length;
        if (autopilotHtml) autopilotMembers++;
      } catch (e) {
        console.warn(`[autopilot] skipped for a member: ${(e as Error).message.slice(0, 160)}`);
      }
    }
    emails.push({
      to,
      bids: strip(mine),
      options: {
        ...(matcher.personal ? { matchLabel: matcher.label } : { setupHint: true }),
        ...(openToAll.length ? { openToAll: strip(openToAll) } : {}),
        ...(autopilotHtml ? { autopilotHtml, autopilotPicks } : {}),
      },
    });
  }
  if (emails.length === 0) {
    console.log(`📧 ${seen.size} paying/trial member(s), none with matching bids today (${noMatches} had no matches) — no digest sent`);
    return { bids: newBids.length, recipients: 0, sent: false };
  }

  console.log(`⭐ Auto-Pilot: strong picks for ${autopilotMembers} member(s); ${budget.calls} bid(s) topped up here${autopilotOn ? "" : " (no key here, saved answers only)"} (${budget.failures} failed)`);
  const accepted = await sendPersonalBidDigests(emails);
  console.log(`📧 ${emails.length} personal digest(s) prepared; ${noMatches} member(s) had no matching bids today`);
  if (accepted > 0) {
    await sql()`
      INSERT INTO bid_digest_log (sent_at, window_start, bids, recipients)
      VALUES (${now.toISOString()}, ${since.toISOString()}, ${newBids.length}, ${accepted})
    `;
  }
  return { bids: newBids.length, recipients: accepted, sent: accepted > 0 };
}

if (import.meta.main) {
  try {
    const r = await sendMorningBidDigest();
    console.log(`🏁 Morning digest finished — bids=${r.bids} recipients=${r.recipients} sent=${r.sent}`);
    process.exit(0);
  } catch (e) {
    console.error("💥 Morning digest crashed:", e);
    process.exit(1);
  }
}
