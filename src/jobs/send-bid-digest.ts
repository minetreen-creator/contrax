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
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { sendPersonalBidDigests, type NewBidSummary } from "~/lib/email";
import { digestWindowStart, isDigestEligible, type DigestUserRow } from "~/lib/digest-recipients";
import { buildDigestMatcher, type DigestBidFields, type DigestProfile } from "~/lib/digest-match";
import { splitDigestBids } from "~/lib/digest-open-to-all";
import { autopilotEmailHtml, profileList, strongPicks, type AutopilotProfile } from "~/lib/autopilot";
import { autopilotEnabled, autopilotForMember, ensureAutopilotTable, newAutopilotBudget } from "~/lib/autopilot.server";

export async function ensureBidDigestLog(): Promise<void> {
  await sql()`
    CREATE TABLE IF NOT EXISTS bid_digest_log (
      id SERIAL PRIMARY KEY,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      window_start TIMESTAMPTZ NOT NULL,
      bids INTEGER NOT NULL,
      recipients INTEGER NOT NULL
    )
  `;
}

export async function sendMorningBidDigest(): Promise<{ bids: number; recipients: number; sent: boolean }> {
  await ensureBidDigestLog();
  const last = (await sql()`SELECT MAX(sent_at) AS last FROM bid_digest_log`) as { last: string | null }[];
  const since = digestWindowStart(last[0]?.last ?? null);
  const now = new Date();

  const bids = (await sql()`
    SELECT id AS bid_id, title, agency, source_url, location, due_date, set_aside, source,
           description, category, naics_code
    FROM bids
    WHERE created_at > ${since.toISOString()}
      AND created_at <= ${now.toISOString()}
      AND due_date > NOW()
      AND ${sql().unsafe(LOW_CONTENT_SQL)}
      AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
  `) as any[];
  const newBids: (NewBidSummary & { match: DigestBidFields })[] = bids.map((b) => ({
    bid_id: Number(b.bid_id),
    title: String(b.title ?? ""),
    agency: String(b.agency ?? ""),
    source_url: String(b.source_url ?? ""),
    location: String(b.location ?? ""),
    due_date: b.due_date ? new Date(b.due_date).toISOString() : null,
    set_aside: b.set_aside ?? null,
    source: b.source ?? undefined,
    match: {
      title: b.title ?? null,
      description: b.description ?? null,
      category: b.category ?? null,
      location: b.location ?? null,
      agency: b.agency ?? null,
      naics_code: b.naics_code ?? null,
    },
  }));
  console.log(`📧 Morning digest window ${since.toISOString()} → ${now.toISOString()}: ${newBids.length} new open bid(s)`);
  if (newBids.length === 0) return { bids: 0, recipients: 0, sent: false };

  // Each member with their primary business profile (the first one created;
  // agencies with several profiles get the email for their primary entity).
  const users = (await sql()`
    SELECT u.id AS user_id, u.email, u.is_admin, u.plan_tier, u.trial_started_at, u.subscription_status,
           u.access_expires_at, u.full_access,
           EXISTS (
             SELECT 1 FROM bid_scout_subscriptions s
             WHERE s.user_id = u.id AND s.status = 'active'
           ) AS has_bid_scout,
           bp.locations, bp.naics_codes, bp.industry, bp.service_categories,
           bp.business_name, bp.certifications, bp.licenses, bp.years_in_business, bp.employee_count,
           bp.typical_contract_value, bp.past_performance_summary, bp.capability_statement
    FROM users u
    LEFT JOIN LATERAL (
      SELECT locations, naics_codes, industry, service_categories,
             business_name, certifications, licenses, years_in_business, employee_count,
             typical_contract_value, past_performance_summary, capability_statement
      FROM business_profiles p WHERE p.user_id = u.id ORDER BY p.id ASC LIMIT 1
    ) bp ON true
  `) as (DigestUserRow & DigestProfile & Record<string, any>)[];

  // Auto-Pilot (owner 2026-11-09): for members with a profile, the AI reads their new matching
  // bids and the email leads with the strong fits (src/lib/autopilot.ts). Skipped without a key.
  const autopilotOn = autopilotEnabled();
  if (autopilotOn) {
    try {
      await ensureAutopilotTable();
    } catch (e) {
      console.warn(`[autopilot] table check failed: ${(e as Error).message}`);
    }
  }
  const budget = newAutopilotBudget();
  let autopilotMembers = 0;

  const seen = new Set<string>();
  const emails: Parameters<typeof sendPersonalBidDigests>[0] = [];
  let noMatches = 0;
  for (const u of users) {
    if (!isDigestEligible(u)) continue;
    const to = String(u.email).trim();
    if (seen.has(to.toLowerCase())) continue;
    seen.add(to.toLowerCase());
    const matcher = buildDigestMatcher(u);
    const matched = matcher.personal ? newBids.filter((b) => matcher.matches(b.match)) : newBids;
    // Federal bids with no set-aside go in their own block; market research and overseas work
    // are left out (owner 2026-11-09, src/lib/digest-open-to-all.ts).
    const { main: mine, openToAll } = splitDigestBids(matched.map((b) => ({ ...b, location: b.location })));
    if (mine.length === 0 && openToAll.length === 0) {
      noMatches++;
      continue;
    }
    const strip = (list: typeof mine) => list.map(({ match: _match, ...b }) => b);
    let autopilotHtml = "";
    let autopilotPicks = 0;
    if (autopilotOn && matcher.personal && u.user_id) {
      const profile: AutopilotProfile = {
        businessName: u.business_name ?? null,
        industry: u.industry ?? null,
        naicsCodes: profileList(u.naics_codes),
        serviceCategories: profileList(u.service_categories),
        locations: profileList(u.locations),
        certifications: profileList(u.certifications),
        licenses: profileList(u.licenses),
        yearsInBusiness: u.years_in_business ?? null,
        employeeCount: u.employee_count ?? null,
        typicalContractValue: u.typical_contract_value ?? null,
        pastPerformance: u.past_performance_summary ?? null,
        capabilityStatement: u.capability_statement ?? null,
      };
      const candidates = [...mine, ...openToAll];
      const verdicts = await autopilotForMember(
        Number(u.user_id),
        profile,
        candidates.map((b) => ({ bid_id: Number(b.bid_id), title: b.title, agency: b.agency, location: b.location, due_date: b.due_date, set_aside: b.set_aside, description: b.match.description })),
        budget,
      );
      const byId = new Map(candidates.map((b) => [Number(b.bid_id), b]));
      const picks = strongPicks(verdicts).map((v) => {
        const b = byId.get(v.bid_id)!;
        return { verdict: v, title: b.title, agency: b.agency, due: b.due_date, url: `https://www.contrax.company/bid/${v.bid_id}` };
      });
      autopilotHtml = autopilotEmailHtml(picks);
      autopilotPicks = picks.length;
      if (autopilotHtml) autopilotMembers++;
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

  if (autopilotOn) console.log(`⭐ Auto-Pilot: ${budget.calls} bid(s) read by AI (${budget.failures} failed), strong picks for ${autopilotMembers} member(s)`);
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
