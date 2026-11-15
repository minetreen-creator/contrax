/**
 * Partner outreach — CLI entrypoint (`bun run partner-outreach`), run by hand from
 * .github/workflows/partner-outreach.yml (owner 2026-11-15, "Yes go": sell through the firms that
 * already serve government contractors). Finds proposal-writing, capture and contracting
 * consultancies, reads each firm's own website for the address it publishes, and queues the
 * reseller email. Queues drafts only; nothing is sent until the owner sends them on
 * /admin/outreach. Dry run unless APPLY=true.
 *
 * Firms come from the hand-checked seeds in src/lib/outreach.ts first, then the collected leads in
 * ./partner-leads.ts (each must pass the site and name checks), then from the contractor
 * registry: a name that says what they do (PARTNER_NAME), consulting NAICS codes first.
 */
import { sql } from "~/db";
import { emailFitsSite, PARTNER_NAME, PARTNER_SEEDS } from "~/lib/outreach";
import { ensureOutreach, isNewAddress, queuePartner } from "~/lib/outreach.server";
import { extractEmails, siteHost } from "~/lib/prospect-finder";
import { partnerMarketFor, partnerSiteFits } from "~/lib/reseller";
import { CONTACT_PATHS, nameOnSite, PARTNER_LEADS } from "./partner-leads";
import { fetchPage, siteEmails } from "./prospect-finder";

/** Drafts per run. */
const WANTED = Math.min(Math.max(Number(process.env.WANTED) || 50, 1), 60);
/** Registry firms read at most. */
const MAX_FIRMS = 400;
/** Names that say it plainly. These registry firms are read first. */
const STRONG_NAME = "proposal|capture|rfp|gov ?con|bid (writ|consult|manage)";
/** Management, marketing and other consulting: where these firms register. */
const NAICS = ["541611", "541613", "541618", "541990"];

async function registryFirms(): Promise<{ name: string; website: string }[]> {
  try {
    const rows = (await sql()`
      SELECT name, url FROM sam_registrants
      WHERE url IS NOT NULL AND url <> ''
        AND name ~* ${PARTNER_NAME}
        AND (expires IS NULL OR expires >= CURRENT_DATE)
      ORDER BY (name ~* ${STRONG_NAME}) DESC, (naics && ${NAICS}::text[]) DESC, md5(uei || ${String(Math.floor(Date.now() / 86_400_000))})
      LIMIT ${MAX_FIRMS}`) as { name: string; url: string }[];
    return rows.map((r) => ({ name: r.name, website: r.url }));
  } catch (e) {
    console.log(`Registry lookup failed (seeds only): ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/**
 * The address a firm publishes for itself: its home page and the contact pages it links to, then
 * the usual contact and about pages. Never a guessed address. `loaded` is false when the home
 * page could not be read at all.
 */
async function publishedEmail(website: string, host: string, name: string): Promise<{ email?: string; loaded: boolean }> {
  const fits = (e: string) => emailFitsSite(e, host, name);
  const first = (await siteEmails(website)).emails.find(fits);
  if (first) return { email: first, loaded: true };
  const base = new URL(website).origin;
  let loaded = false;
  for (const path of CONTACT_PATHS) {
    const page = await fetchPage(base + path);
    if (!page) continue;
    loaded = true;
    const email = extractEmails(page, host).find(fits);
    if (email) return { email, loaded };
  }
  return { loaded: loaded || !!(await fetchPage(website)) };
}

async function main() {
  const apply = process.env.APPLY === "true";
  await ensureOutreach();
  const firms = [
    ...PARTNER_SEEDS.map(([name, website]) => ({ name, website })),
    ...PARTNER_LEADS.map(([name, website]) => ({ name, website })),
    ...(await registryFirms()),
  ];
  console.log(`${firms.length} candidate firms (${PARTNER_SEEDS.length} hand-checked, ${PARTNER_LEADS.length} collected leads).${apply ? "" : " Dry run."}`);
  const seeds = new Set(PARTNER_SEEDS.map(([name]) => name));
  const leads = new Set(PARTNER_LEADS.map(([name]) => name));
  const seenHosts = new Set<string>();
  let queued = 0;
  for (const p of firms) {
    if (queued >= WANTED) break;
    const website = /^https?:\/\//i.test(p.website) ? p.website : `https://${p.website}`;
    const host = siteHost(website);
    if (!host || seenHosts.has(host)) continue;
    seenHosts.add(host);
    let email: string | undefined;
    try {
      const found = await publishedEmail(website, host, p.name);
      email = found.email;
      if (!found.loaded) {
        if (leads.has(p.name)) console.log(`   skip (site did not load) → ${p.name}`);
        continue;
      }
    } catch {
      if (leads.has(p.name)) console.log(`   skip (site did not load) → ${p.name}`);
      continue;
    }
    if (!email) {
      if (leads.has(p.name)) console.log(`   skip (no address published on its site) → ${p.name}`);
      continue;
    }
    if (!(await isNewAddress(email))) {
      if (leads.has(p.name)) console.log(`   skip (already written to, or do not contact) → ${p.name}`);
      continue;
    }
    // Owner 2026-11-15: match the preview to the firm's niche, from its name and its own home page.
    let home = "";
    try {
      home = (await fetchPage(website)).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ").slice(0, 20_000);
    } catch {
      /* the name alone decides */
    }
    // A registry firm must say on its own site that it helps others win government work.
    if (!seeds.has(p.name) && !partnerSiteFits(home)) {
      console.log(`   skip (site does not read as a consultancy) → ${p.name}`);
      continue;
    }
    // A collected lead must also carry its own name on the page: the address may be someone else's.
    if (leads.has(p.name) && !nameOnSite(p.name, home)) {
      console.log(`   skip (site does not carry the firm's name) → ${p.name}`);
      continue;
    }
    // A registry firm named like a software product ("Rfp360.ai") sells a tool, not a service to clients.
    if (!seeds.has(p.name) && !leads.has(p.name) && /\.(ai|io|app)\b/i.test(p.name)) continue;
    const market = partnerMarketFor(`${p.name} ${home}`);
    if (!apply) {
      queued++;
      console.log(`   would queue → ${p.name} [${market}]`);
      continue;
    }
    if (await queuePartner({ email, business: p.name, website, market })) {
      queued++;
      console.log(`   ✉️ ${p.name} [${market}]`);
    }
  }
  console.log(apply ? `\nReseller emails queued: ${queued}. Send them at https://www.contrax.company/admin/outreach` : `\nWould queue ${queued}. Re-run with apply = true.`);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("💥 Partner outreach crashed:", e);
      process.exit(1);
    });
}
