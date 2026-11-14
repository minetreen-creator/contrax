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
import { domainFitsAgency, GOV_DOMAINS_URL, govDomainFor, parseGovDomains, pickAgencyAddress, purchasingLinks, type GovDomain } from "~/lib/buyer-lookup";
import { buyerEmail } from "~/lib/outreach";
import { bidsOwedBuyerNote, queueBuyerNote } from "~/lib/outreach.server";
import { contactLinks, extractEmails } from "~/lib/prospect-finder";
import { fetchPage, siteEmails } from "./prospect-finder";

/** The official .gov domain list; an empty list (never a crash) when it cannot be fetched. */
async function loadGovDomains(): Promise<GovDomain[]> {
  try {
    const res = await fetch(GOV_DOMAINS_URL, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseGovDomains(await res.text());
  } catch (e) {
    console.log(`⚠️ .gov domain list unavailable (${e instanceof Error ? e.message : String(e)}); agency websites will not be looked up.`);
    return [];
  }
}

/** The purchasing (or general office) address published on an agency's own site: home page, purchasing pages, contact pages. */
async function agencySiteAddress(domain: string): Promise<{ email: string; page: string } | null> {
  for (const home of [`https://www.${domain}`, `https://${domain}`]) {
    const html = await fetchPage(home);
    if (!html) continue;
    const pages = [home, ...purchasingLinks(html, home), ...contactLinks(html, home)];
    const seen: string[] = [];
    for (const page of pages.slice(0, 6)) {
      const body = page === home ? html : await fetchPage(page);
      seen.push(...extractEmails(body, domain));
      // A purchasing mailbox ends the search; a general one only after every page was read.
      const purchasing = pickAgencyAddress(seen.filter((e) => /purchas|procure|bids?|buyer|contract/.test(e.split("@")[0])), domain);
      if (purchasing) return { email: purchasing, page };
    }
    const general = pickAgencyAddress(seen, domain);
    return general ? { email: general, page: home } : null;
  }
  return null;
}

async function main() {
  const apply = process.env.APPLY === "true";
  const bids = await bidsOwedBuyerNote();
  const govDomains = await loadGovDomains();
  if (govDomains.length) console.log(`${govDomains.length} .gov domains loaded.`);
  console.log(`${bids.length} open bid(s) with contractor emails sent and no buyer note yet.${apply ? "" : " Dry run."}\n`);
  let found = 0;
  let queued = 0;
  for (const b of bids) {
    console.log(`#${b.bid_id} ${b.bid_title} (${b.buyer ?? "-"}, due ${b.due}) — sent to ${b.sent}`);
    // The bid's own text first; then the official posting page.
    const fits = (domain: string) => domainFitsAgency(domain, b.buyer);
    let email = buyerEmail(extractEmails(b.description ?? ""), fits);
    let where = "bid text";
    if (!email && /^https?:\/\//i.test(b.source_url ?? "")) {
      const { emails } = await siteEmails(b.source_url!);
      email = buyerEmail(emails, fits);
      where = "official posting";
    }
    if (!email) {
      // The buyer's own website, from the official .gov domain list.
      const domain = govDomainFor(b.buyer, b.state, govDomains);
      const hit = domain ? await agencySiteAddress(domain) : null;
      if (hit) {
        email = hit.email;
        where = `agency site ${hit.page}`;
      } else if (domain) {
        console.log(`   ${domain}: no purchasing or office address published`);
      }
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
