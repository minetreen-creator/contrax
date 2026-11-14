/**
 * Teams outreach — CLI entrypoint (`bun run teams-outreach`), run by hand from
 * .github/workflows/teams-outreach.yml (owner 2026-11-14: "so we can sell to
 * the big buyers not small businesses"). For one state and trade, counts the
 * federal contracts ending in the next 12 months, then queues an email to
 * companies in the contractor registry that are registered for that trade,
 * pointing at Contracts Ending Soon and at /teams. Queues drafts only; nothing
 * is sent until the owner approves the list on /admin/outreach.
 *
 * Dry run unless APPLY=true.
 */
import { STATE_NAMES } from "~/lib/contract-map";
import { queryRecompetes } from "~/lib/federal-trade-data.server";
import { emailFitsSite } from "~/lib/outreach";
import { ensureOutreach, isNewAddress, queueTeams } from "~/lib/outreach.server";
import { siteHost } from "~/lib/prospect-finder";
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { searchRegistrants, siteEmails } from "./prospect-finder";

/** Drafts per run. */
const WANTED = 30;
/** Below this many ending contracts the email has nothing worth saying. */
const MIN_CONTRACTS = 10;
/** Registry pages read at most (40 businesses each). */
const MAX_ROUNDS = 6;

/**
 * The scheduled run's markets, one a weekday (owner 2026-11-14: "do that" to
 * selling Professional to companies with a government sales team): states with
 * many federal contractors, in the two trades where such companies have
 * someone chasing the work. A hand run names its own state and trade.
 */
export const TEAMS_ROTATION: readonly (readonly [string, string])[] = [
  ["VA", "it-services"], ["MD", "it-services"], ["DC", "it-services"], ["TX", "it-services"], ["CA", "it-services"],
  ["FL", "it-services"], ["VA", "construction"], ["TX", "construction"], ["GA", "it-services"], ["CO", "it-services"],
];

/** The market for a given day: the rotation moves one step each calendar day. PURE. */
export function teamsMarketFor(dayNumber: number): readonly [string, string] {
  const n = TEAMS_ROTATION.length;
  return TEAMS_ROTATION[((Math.floor(dayNumber) % n) + n) % n];
}

async function main() {
  const apply = process.env.APPLY === "true";
  const named = (process.env.STATE ?? "").trim() && (process.env.TRADE ?? "").trim();
  const [rotState, rotTrade] = teamsMarketFor(Date.now() / 86_400_000);
  const state = (named ? process.env.STATE! : rotState).trim().toUpperCase();
  const trade = (named ? process.env.TRADE! : rotTrade).trim().toLowerCase();
  if (!named) console.log(`No state and trade given: today's market in the rotation is ${state} ${trade}.`);
  const tradeRow = SEO_TRADE_BY_SLUG[trade];
  const place = STATE_NAMES[state];
  if (!tradeRow || !place) throw new Error(`Unknown STATE "${state}" or TRADE "${trade}"`);
  await ensureOutreach();
  const { count } = await queryRecompetes({ trade, state, months: 12, limit: 1 });
  console.log(`${count} federal ${tradeRow.label} contracts in ${place} end in the next 12 months.${apply ? "" : " Dry run."}`);
  if (count < MIN_CONTRACTS) {
    console.log(`Fewer than ${MIN_CONTRACTS}: nothing queued.`);
    return;
  }
  const headline = `${count.toLocaleString("en-US")} federal ${tradeRow.label} contracts in ${place} end in the next 12 months`;
  const seenHosts = new Set<string>();
  let queued = 0;
  for (let round = 0; round < MAX_ROUNDS && queued < WANTED; round++) {
    // A different seed each round, and each day, reaches different registrants.
    const seed = Math.floor(Date.now() / 86_400_000) * 10 + round;
    const firms = await searchRegistrants({ state, label: tradeRow.label, place: "", bidId: seed, limit: 40 });
    if (!firms.length) break;
    for (const p of firms) {
      if (queued >= WANTED) break;
      const host = p.website ? siteHost(p.website) : null;
      if (!p.website || !host || seenHosts.has(host)) continue;
      seenHosts.add(host);
      const { emails } = await siteEmails(p.website);
      const email = emails.find((e) => emailFitsSite(e, host, p.name));
      if (!email || !(await isNewAddress(email))) continue;
      if (!apply) {
        queued++;
        console.log(`   would queue → ${p.name} — ${email}`);
        continue;
      }
      const ok = await queueTeams({ email, business: p.name, website: p.website, headline, query: `trade=${trade}&state=${state}`, tradeLabel: tradeRow.label, place });
      if (ok) {
        queued++;
        console.log(`   ✉️ ${p.name} — ${email}`);
      }
    }
  }
  console.log(apply ? `\nTeams emails queued: ${queued}. Approve them at https://www.contrax.company/admin/outreach` : `\nWould queue ${queued}. Re-run with apply = true.`);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("💥 Teams outreach crashed:", e);
      process.exit(1);
    });
}
