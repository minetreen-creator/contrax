import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { outreachEmail, PARTNER_SEEDS, PARTNER_SUBJECT, partnerFirmName } from "./outreach";

// Owner 2026-11-15 ("Yes go"): sell through firms that already serve government contractors.
test("the reseller email leads with their margin, links a preview under their name in their niche, and asks one thing", () => {
  const mail = outreachEmail({
    kind: "partner", business: "Acme Proposal Group, LLC", bidId: 0, bidTitle: PARTNER_SUBJECT, buyer: null, due: "2026-12-15",
    tradeLabel: "consulting firm", place: "trades", postalAddress: "203 Homestead Dr, Colonial Heights VA 23834",
    unsubscribeUrl: "https://www.contrax.company/api/outreach/unsubscribe?t=x", contactId: 12,
  });
  expect(mail.subject).toBe("A monthly pipeline report your clients get under your name");
  expect(mail.text).toContain("https://www.contrax.company/partner-preview/acme-proposal-group-llc?utm_source=email&utm_medium=outreach&utm_campaign=bid_outreach_partner&oc=12");
  expect(mail.text).toContain("built on real construction and facilities trades contracts");
  // Owner 2026-11-15, tweak 1: the retail anchor first, then the wholesale tiers.
  expect(mail.text).toContain("for $400 to $500 a month");
  expect(mail.text).toContain("$199 per client per month, or $149 per client once you have 10 or more");
  expect(mail.text.indexOf("$400 to $500")).toBeLessThan(mail.text.indexOf("$199"));
  expect(mail.text).toContain('Reply "sample"');
  // Owner 2026-11-15, checklist before sending: the turnaround and the client-ownership promise.
  expect(mail.text).toContain("we never contact, market to or solicit your clients");
  expect(mail.text).toContain("their report is ready within 1 business day");
  // Tweak 2: plain text, a link instead of an attachment, no image of any kind.
  expect(mail.html).not.toContain("<img");
  expect(mail.text).toContain("Unsubscribe: https://www.contrax.company/api/outreach/unsubscribe?t=x");
});

test("firms are picked by what their name says they do, and seeds are real sites, not the competitor", () => {
  for (const n of ["Summit Proposal Services LLC", "GovCon Growth Partners", "Federal Contracting Advisors", "Capture Strategy Group", "RFP Experts Inc"]) expect(partnerFirmName(n)).toBe(true);
  for (const n of ["Smith Plumbing LLC", "Acme Janitorial", "Blue Ridge Software"]) expect(partnerFirmName(n)).toBe(false);
  expect(PARTNER_SEEDS.length).toBeGreaterThanOrEqual(10);
  for (const [, site] of PARTNER_SEEDS) expect(site).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/);
  expect(JSON.stringify(PARTNER_SEEDS).toLowerCase()).not.toContain("bidlab");
});

test("the job queues drafts only, skips known and Do not contact addresses, and is run by hand", () => {
  const job = readFileSync("src/jobs/partner-outreach.ts", "utf8");
  expect(job).toContain("if (!(await isNewAddress(email))) {");
  expect(job).toContain('const apply = process.env.APPLY === "true";');
  const wf = readFileSync(".github/workflows/partner-outreach.yml", "utf8");
  expect(wf).toContain("SENDS NOTHING");
  expect(wf).not.toContain("schedule:");
  expect(readFileSync("src/lib/outreach.server.ts", "utf8")).toContain("VALUES (${p.email.trim().toLowerCase()}, 'partner'");
  // Tweak 3: the preview's market is chosen from the firm's own name and home page.
  expect(job).toContain("partnerMarketFor(`${p.name} ${home}`)");
});
