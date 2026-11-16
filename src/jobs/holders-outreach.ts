/**
 * Holder outreach — CLI entrypoint (`bun run holders-outreach`), run by hand from
 * .github/workflows/holders-outreach.yml (owner 2026-11-16: "we need to reach agencies" = bigger
 * contractors; "go with the $149 bridge"; "maybe find bigger companies for the $499 offer too").
 *
 * Who: companies that hold an openly bid federal contract in one trade ending in the next 12
 * months, with at least HOLDER_MIN_TOTAL ending. The contractor registry told us "registered",
 * which returned one-crew firms; holding a contract this size is what makes a company mid-size.
 * Contracts awarded without open bidding (reserved by law, sole source) are left out, and so are
 * contracts the sync has not marked yet. The company's website comes from the registry by its
 * federal ID; the email is one that site publishes. Queues drafts only; nothing is sent until the
 * owner approves the list on /admin/outreach.
 *
 * Dry run unless APPLY=true. STATE is optional (blank = every state).
 */
import { sql } from "~/db";
import { STATE_NAMES } from "~/lib/contract-map";
import { addMonths, formatDollars } from "~/lib/federal-trade-data";
import { ensureFederalTradeTables } from "~/lib/federal-trade-data.server";
import { emailFitsSite, HOLDER_MIN_TOTAL, holderTier, packHolder } from "~/lib/outreach";
import { ensureOutreach, isNewAddress, queueHolder } from "~/lib/outreach.server";
import { siteHost } from "~/lib/prospect-finder";
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { siteEmails } from "./prospect-finder";

/** Drafts per run. */
const WANTED = 30;
/** Holders looked at, largest first. */
const MAX_HOLDERS = 250;
/** A state with fewer openly bid contracts ending than this gives the email nothing to say. */
const MIN_CONTRACTS = 5;

interface HolderRow {
  uei: string;
  name: string;
  n: number;
  total: number;
  states: number;
  url: string | null;
  pop_state: string;
  agency: string | null;
  sub_agency: string | null;
  end_date: string;
}

async function main() {
  const apply = process.env.APPLY === "true";
  const trade = (process.env.TRADE ?? "").trim().toLowerCase();
  const state = (process.env.STATE ?? "").trim().toUpperCase();
  const tradeRow = SEO_TRADE_BY_SLUG[trade];
  if (!tradeRow) throw new Error(`Unknown TRADE "${trade}"`);
  if (state && !STATE_NAMES[state]) throw new Error(`Unknown STATE "${state}"`);
  await ensureFederalTradeTables();
  await ensureOutreach();
  const s = sql();
  const until = addMonths(new Date().toISOString().slice(0, 10), 12);
  const statePred = state ? s`AND c.pop_state = ${state}` : s``;

  const marked = (await s`SELECT COUNT(*) FILTER (WHERE not_competed IS NOT NULL)::int AS known, COUNT(*)::int AS n FROM recompete_contracts
    WHERE trade_slug = ${trade} AND end_date >= CURRENT_DATE AND end_date <= ${until}`) as { known: number; n: number }[];
  console.log(`${tradeRow.label}: ${marked[0].n} contracts ending in 12 months, ${marked[0].known} checked for open bidding.${apply ? "" : " Dry run."}`);
  if (!marked[0].known) {
    console.log("None checked yet (the federal sync has not marked this trade): nothing queued.");
    return;
  }

  // The registry (sam_registrants) holds the website; a holder without one is listed, not guessed at.
  const holders = (await s`
    WITH h AS (
      SELECT recipient_uei AS uei, MAX(recipient_name) AS name, COUNT(*)::int AS n, SUM(amount)::float AS total, COUNT(DISTINCT pop_state)::int AS states
      FROM recompete_contracts
      WHERE trade_slug = ${trade} AND end_date >= CURRENT_DATE AND end_date <= ${until} AND not_competed = false AND recipient_uei IS NOT NULL
      GROUP BY recipient_uei HAVING SUM(amount) >= ${HOLDER_MIN_TOTAL}
    )
    SELECT h.uei, h.name, h.n, h.total, h.states, r.url, c.pop_state, c.agency, c.sub_agency, to_char(c.end_date, 'YYYY-MM-DD') AS end_date
    FROM h
    LEFT JOIN sam_registrants r ON r.uei = h.uei AND r.url IS NOT NULL AND r.url <> ''
    JOIN LATERAL (
      SELECT pop_state, agency, sub_agency, end_date FROM recompete_contracts c
      WHERE c.recipient_uei = h.uei AND c.trade_slug = ${trade} AND c.end_date >= CURRENT_DATE AND c.end_date <= ${until}
        AND c.not_competed = false AND c.pop_state IS NOT NULL ${statePred}
      ORDER BY c.end_date ASC, c.amount DESC LIMIT 1
    ) c ON true
    ORDER BY h.total DESC LIMIT ${MAX_HOLDERS}`) as HolderRow[];
  console.log(`${holders.length} holders with ${formatDollars(HOLDER_MIN_TOTAL)} or more in openly bid contracts ending${state ? ` and one in ${STATE_NAMES[state]}` : ""}.`);

  const openCount = new Map<string, number>();
  const countFor = async (st: string): Promise<number> => {
    if (!openCount.has(st)) {
      const r = (await s`SELECT COUNT(*)::int AS n FROM recompete_contracts WHERE trade_slug = ${trade} AND pop_state = ${st}
        AND end_date >= CURRENT_DATE AND end_date <= ${until} AND not_competed = false`) as { n: number }[];
      openCount.set(st, r[0].n);
    }
    return openCount.get(st)!;
  };

  const seenHosts = new Set<string>();
  const noSite: string[] = [];
  let queued = 0;
  for (const h of holders) {
    if (queued >= WANTED) break;
    const size = `${formatDollars(h.total)} in ${h.n} contract${h.n === 1 ? "" : "s"}, ${h.states} state${h.states === 1 ? "" : "s"}`;
    if (!h.url) {
      noSite.push(`${h.name} (${size})`);
      continue;
    }
    const host = siteHost(h.url);
    if (!host || seenHosts.has(host)) continue;
    seenHosts.add(host);
    const place = STATE_NAMES[h.pop_state];
    const count = place ? await countFor(h.pop_state) : 0;
    if (!place || count < MIN_CONTRACTS) continue;
    const { emails } = await siteEmails(h.url);
    const email = emails.find((e) => emailFitsSite(e, host, h.name));
    if (!email || !(await isNewAddress(email))) {
      console.log(`   skipped (${email ? "address already written to" : "no address on its site"}) → ${h.name}`);
      continue;
    }
    const tier = holderTier(h.total, h.states);
    const headline = `${count.toLocaleString("en-US")} openly bid federal ${tradeRow.label} contracts in ${place} end in the next 12 months`;
    const agency = h.sub_agency ?? h.agency;
    if (!apply) {
      queued++;
      console.log(`   would queue [${tier}] → ${h.name} — ${email} · ${size} · ${agency ?? "agency not listed"}, ${place}, ends ${h.end_date}`);
      continue;
    }
    if (await queueHolder({ email, business: h.name, website: h.url, headline, packed: packHolder(`trade=${trade}&state=${h.pop_state}`, tier, agency), endDate: h.end_date, tradeLabel: tradeRow.label, place })) {
      queued++;
      console.log(`   queued [${tier}] → ${h.name} · ${size}`);
    }
  }
  console.log(`${apply ? "Queued" : "Would queue"}: ${queued}.`);
  if (noSite.length) {
    console.log(`No website on file for ${noSite.length} holders (largest first), so none was written to:`);
    for (const line of noSite.slice(0, 25)) console.log(`   · ${line}`);
  }
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("💥 Holders outreach crashed:", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
