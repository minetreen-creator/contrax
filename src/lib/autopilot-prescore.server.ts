/**
 * Auto-Pilot's early-morning scoring on Vercel (owner 2026-11-09: "github isn't reliable").
 * Vercel Cron calls /api/cron/autopilot every 10 minutes from 08:00 to 10:50 UTC (3 to 6 AM
 * Eastern in winter). Each call scores members' new matching bids for up to ~40 seconds and saves
 * the answers; the 6 AM email (GitHub) then only reads them. Same bids and members as the email
 * (src/lib/digest-inputs.server.ts). At most AUTOPILOT_RUN_CAP AI calls a day.
 */
import { sql } from "~/db";
import { isDigestEligible } from "~/lib/digest-recipients";
import { loadDigestBids, loadDigestMembers } from "~/lib/digest-inputs.server";
import { autopilotBidsOf, autopilotProfileOf, memberDigestBids } from "~/lib/digest-member";
import { AUTOPILOT_RUN_CAP, autopilotEnabled, autopilotForMember, ensureAutopilotTable, newAutopilotBudget } from "~/lib/autopilot.server";

/** How long one call keeps starting new AI calls. */
export const PRESCORE_SECONDS = 40;

export interface PrescoreResult {
  enabled: boolean;
  bids: number;
  members: number;
  scored: number;
  failed: number;
  savedToday: number;
}

export async function prescoreAutopilot(now = new Date()): Promise<PrescoreResult> {
  const deadline = now.getTime() + PRESCORE_SECONDS * 1000;
  if (!autopilotEnabled()) return { enabled: false, bids: 0, members: 0, scored: 0, failed: 0, savedToday: 0 };
  await ensureAutopilotTable();
  const today = (await sql()`
    SELECT COUNT(*)::int AS n FROM autopilot_verdicts WHERE created_at > NOW() - INTERVAL '20 hours'
  `) as { n: number }[];
  const savedToday = Number(today[0]?.n ?? 0);
  const budget = newAutopilotBudget(Math.max(0, AUTOPILOT_RUN_CAP - savedToday));
  const { bids } = await loadDigestBids(now);
  if (bids.length === 0 || budget.left === 0) return { enabled: true, bids: bids.length, members: 0, scored: 0, failed: 0, savedToday };

  const members = await loadDigestMembers();
  const seen = new Set<string>();
  let n = 0;
  for (const u of members) {
    if (Date.now() > deadline || budget.left <= 0) break;
    if (!isDigestEligible(u) || !u.user_id) continue;
    const email = String(u.email).trim().toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    const { matcher, main, openToAll } = memberDigestBids(u, bids);
    if (!matcher.personal || main.length + openToAll.length === 0) continue;
    n++;
    await autopilotForMember(Number(u.user_id), autopilotProfileOf(u), autopilotBidsOf(main, openToAll), budget, { deadline });
  }
  return { enabled: true, bids: bids.length, members: n, scored: budget.calls - budget.failures, failed: budget.failures, savedToday };
}
