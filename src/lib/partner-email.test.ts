import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { outreachEmail, PARTNER_SEEDS, PARTNER_SUBJECT, partnerFirmName } from "./outreach";

// Owner 2026-11-15 ("Yes go"): sell through firms that already serve government contractors.
test("the reseller email offers the report under the firm's name, names no price, and asks one thing", () => {
  const mail = outreachEmail({
    kind: "partner", business: "Acme Proposal Group", bidId: 0, bidTitle: PARTNER_SUBJECT, buyer: null, due: "2026-12-15",
    tradeLabel: "consulting firm", postalAddress: "203 Homestead Dr, Colonial Heights VA 23834",
    unsubscribeUrl: "https://www.contrax.company/api/outreach/unsubscribe?t=x", contactId: 12,
  });
  expect(mail.subject).toBe("A monthly pipeline report your clients get under your name");
  expect(mail.text).toContain("Acme Proposal Group helps companies win government contracts");
  expect(mail.text).toContain("https://www.contrax.company/sample-report?utm_source=email&utm_medium=outreach&utm_campaign=bid_outreach_partner&oc=12");
  expect(mail.text).toContain("under your firm's name");
  expect(mail.text).toContain('Reply "sample"');
  // The wholesale price is agreed on reply; the owner has not set one.
  expect(mail.text).not.toContain("$");
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
  expect(job).toContain("if (!email || !(await isNewAddress(email))) continue;");
  expect(job).toContain('const apply = process.env.APPLY === "true";');
  const wf = readFileSync(".github/workflows/partner-outreach.yml", "utf8");
  expect(wf).toContain("SENDS NOTHING");
  expect(wf).not.toContain("schedule:");
  expect(readFileSync("src/lib/outreach.server.ts", "utf8")).toContain("VALUES (${p.email.trim().toLowerCase()}, 'partner'");
});
