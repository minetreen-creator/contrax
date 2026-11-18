/**
 * Supplier outreach — CLI entrypoint (`bun run supplier-outreach`), run by hand from
 * .github/workflows/supplier-outreach.yml (owner 2026-11-18: "do that"). For each business in
 * ./supplier-leads.ts in the chosen state, reads the business's own website for the address it
 * publishes and queues the supplier email (src/lib/supplier-outreach.ts), which quotes this week's
 * real rows for that state. Queues drafts only; nothing is sent until the drafts are sent from
 * /admin/outreach. Dry run unless APPLY=true.
 *
 * Addresses are never printed: the Actions log is public. Names only.
 */
import { STATE_NAMES } from "~/lib/contract-map";
import { emailFitsSite } from "~/lib/outreach";
import { ensureOutreach, isNewAddress, queueSupplier } from "~/lib/outreach.server";
import { extractEmails, siteHost } from "~/lib/prospect-finder";
import { packSupplierPitch, supplierPitch, supplierPitchSubject } from "~/lib/supplier-outreach";
import { SUPPLIER_TYPES } from "~/lib/supplier-report";
import { loadSupplierSample } from "~/lib/supplier-report.server";
import { CONTACT_PATHS, nameOnSite } from "./partner-leads";
import { fetchPage, siteEmails } from "./prospect-finder";
import { SUPPLIER_LEADS } from "./supplier-leads";

const WANTED = Math.min(Math.max(Number(process.env.WANTED) || 25, 1), 40);
const STATE = (process.env.STATE || "SC").toUpperCase();

/** The address a business publishes for itself, at its own domain. Never a guessed address. */
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
    const found = extractEmails(page, host).find(fits);
    if (found) return { email: found, loaded };
  }
  return { loaded: loaded || !!(await fetchPage(website)) };
}

async function main() {
  const apply = process.env.APPLY === "true";
  const stateName = STATE_NAMES[STATE];
  if (!stateName) throw new Error(`Unknown state: ${STATE}`);
  await ensureOutreach();
  const sample = await loadSupplierSample(STATE);
  if (!supplierPitch(sample, "materials")) {
    console.log(`No live sample for ${stateName}: nothing queued, because the email would have nothing real to quote.`);
    return;
  }
  const leads = SUPPLIER_LEADS.filter(([, , , st]) => st === STATE);
  console.log(`${leads.length} candidate businesses in ${stateName}.${apply ? "" : " Dry run."}`);
  const seenHosts = new Set<string>();
  const tally: Record<string, number> = {};
  let queued = 0;
  for (const [name, site, type] of leads) {
    if (queued >= WANTED) break;
    const website = /^https?:\/\//i.test(site) ? site : `https://${site}`;
    const host = siteHost(website);
    if (!host || seenHosts.has(host)) continue;
    seenHosts.add(host);
    const skip = (why: string) => {
      tally[why] = (tally[why] ?? 0) + 1;
      console.log(`   skip (${why}) → ${name}`);
    };
    let found: { email?: string; loaded: boolean };
    try {
      found = await publishedEmail(website, host, name);
    } catch {
      found = { loaded: false };
    }
    if (!found.loaded) {
      skip("site did not load");
      continue;
    }
    const home = (await fetchPage(website)).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ").slice(0, 40_000);
    // The web address was collected, not checked by hand: the page must carry the business's name.
    if (!nameOnSite(name, home)) {
      skip("site does not carry the business's name");
      continue;
    }
    const email = found.email;
    if (!email) {
      skip("no address published on its site");
      continue;
    }
    if (!(await isNewAddress(email))) {
      skip("already written to, or do not contact");
      continue;
    }
    const label = SUPPLIER_TYPES.find((t) => t.id === type)?.label ?? type;
    const pitch = supplierPitch(sample, type)!;
    if (!apply) {
      queued++;
      console.log(`   would queue → ${name} [${label}]`);
      continue;
    }
    if (await queueSupplier({ email, business: name, website, subject: supplierPitchSubject(stateName, pitch), packed: packSupplierPitch(pitch), typeLabel: label, place: stateName })) {
      queued++;
      console.log(`   ✉️ ${name} [${label}]`);
    }
  }
  for (const [why, n] of Object.entries(tally)) console.log(`Skipped, ${why}: ${n}`);
  console.log(apply ? `\nSupplier emails queued: ${queued}. They wait on https://www.contrax.company/admin/outreach` : `\nWould queue ${queued}. Re-run with apply = true.`);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : "supplier outreach failed");
      process.exit(1);
    });
}
