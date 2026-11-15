import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { warmLeadMailto, warmLeadNote } from "./warm-leads";

// Owner 2026-11-15 ("go"): work the warm leads first, with a personal note from the owner.
test("the note is personal, names the company, and never says we watched them", () => {
  const n = warmLeadNote({ email: "brandon.smith@example.org", company: "Chippewa Sustainable Solutions" });
  expect(n.body.startsWith("Hi Brandon,")).toBe(true);
  expect(n.body).toContain("for Chippewa Sustainable Solutions");
  expect(n.body).toContain("try everything for $5");
  for (const w of ["upgrade page", "noticed you", "saw you", "tracked", "visited"]) expect(n.body.toLowerCase()).not.toContain(w);
  // An address with no clear first name gets a plain greeting, never a guess.
  expect(warmLeadNote({ email: "info@example.org", company: null }).body.startsWith("Hi,\n")).toBe(true);
  expect(warmLeadMailto({ email: "a.b@example.org", company: null })).toMatch(/^mailto:a\.b%40example\.org\?subject=Quick%20question/);
});

test("the list is admin-only, leaves out paying accounts, and sits on the outreach page", () => {
  const api = readFileSync("src/routes/api/admin/warm-leads.ts", "utf8");
  expect(api.indexOf("Admin access required")).toBeLessThan(api.indexOf("await warmLeads()"));
  const server = readFileSync("src/lib/outreach.server.ts", "utf8");
  expect(server).toContain("COALESCE(u.subscription_status, '') <> 'active'");
  expect(server).toContain("qaExternalUserSQL()");
  expect(readFileSync("src/routes/admin/outreach.tsx", "utf8")).toContain("<WarmLeadsCard />");
});

// Owner 2026-11-15: "you write the emails, not me". The note is written and queued by the system.
test("the note is queued as a draft, once per account, never to a Do not contact address", async () => {
  const { outreachEmail } = await import("./outreach");
  const server = readFileSync("src/lib/outreach.server.ts", "utf8");
  const queue = server.slice(server.indexOf("export async function queueWarmLeads"), server.indexOf("export interface QueuedPrime"));
  // isNewAddress checks the Do not contact list and every address already written to.
  expect(queue.indexOf("if (!(await isNewAddress(l.email))) continue;")).toBeGreaterThan(0);
  expect(queue.indexOf("isNewAddress")).toBeLessThan(queue.indexOf("INSERT INTO outreach_contacts"));
  expect(readFileSync("src/jobs/teams-outreach.ts", "utf8")).toContain("await queueWarmLeads()");
  const mail = outreachEmail({
    kind: "warm", business: "Chippewa Sustainable Solutions", bidId: 0, bidTitle: "Quick question about your Contrax account",
    buyer: "Brandon", due: "2026-12-15", tradeLabel: "account", place: "Chippewa Sustainable Solutions",
    postalAddress: "203 Homestead Dr, Colonial Heights VA 23834", unsubscribeUrl: "https://www.contrax.company/api/outreach/unsubscribe?t=x", contactId: 5,
  });
  expect(mail.subject).toBe("Quick question about your Contrax account");
  expect(mail.text.startsWith("Hi Brandon,")).toBe(true);
  expect(mail.text).toContain("for Chippewa Sustainable Solutions");
  expect(mail.text).toContain("You're receiving this because you have a Contrax account.");
  // One signature, from the footer.
  expect(mail.text.match(/Nathaniel Minetree/g)?.length).toBe(1);
});
