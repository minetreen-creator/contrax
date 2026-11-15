/**
 * Partner outreach — CLI entrypoint (`bun run partner-outreach`), run by hand from
 * .github/workflows/partner-outreach.yml (owner 2026-11-15, "Yes go": sell through the firms that
 * already serve government contractors). Finds proposal-writing, capture and contracting
 * consultancies, reads each firm's own website for the address it publishes, and queues the
 * reseller email. Queues drafts only; nothing is sent until the owner sends them on
 * /admin/outreach. Dry run unless APPLY=true.
 *
 * Firms come from the hand-checked seeds in src/lib/outreach.ts first, then from the contractor
 * registry: consulting NAICS codes with a name that says what they do (PARTNER_NAME).
 */
import { sql } from "~/db";
import { emailFitsSite, PARTNER_NAME, PARTNER_SEEDS } from "~/lib/outreach";
import { ensureOutreach, isNewAddress, queuePartner } from "~/lib/outreach.server";
import { siteHost } from "~/lib/prospect-finder";
import { siteEmails } from "./prospect-finder";

/** Drafts per run. */
const WANTED = Math.min(Math.max(Number(process.env.WANTED) || 50, 1), 60);
/** Registry firms read at most. */
const MAX_FIRMS = 400;
/** Management, marketing and other consulting: where these firms register. */
const NAICS = ["541611", "541613", "541618", "541990"];

async function registryFirms(): Promise<{ name: string; website: string }[]> {
  try {
    const rows = (await sql()`
      SELECT name, url FROM sam_registrants
      WHERE url IS NOT NULL AND url <> ''
        AND naics && ${NAICS}::text[]
        AND name ~* ${PARTNER_NAME}
        AND (expires IS NULL OR expires >= CURRENT_DATE)
      ORDER BY md5(uei || ${String(Math.floor(Date.now() / 86_400_000))})
      LIMIT ${MAX_FIRMS}`) as { name: string; url: string }[];
    return rows.map((r) => ({ name: r.name, website: r.url }));
  } catch (e) {
    console.log(`Registry lookup failed (seeds only): ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

async function main() {
  const apply = process.env.APPLY === "true";
  await ensureOutreach();
  const firms = [...PARTNER_SEEDS.map(([name, website]) => ({ name, website })), ...(await registryFirms())];
  console.log(`${firms.length} candidate firms (${PARTNER_SEEDS.length} hand-checked).${apply ? "" : " Dry run."}`);
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
      email = (await siteEmails(website)).emails.find((e) => emailFitsSite(e, host, p.name));
    } catch {
      continue;
    }
    if (!email || !(await isNewAddress(email))) continue;
    if (!apply) {
      queued++;
      console.log(`   would queue → ${p.name}`);
      continue;
    }
    if (await queuePartner({ email, business: p.name, website })) {
      queued++;
      console.log(`   ✉️ ${p.name}`);
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
