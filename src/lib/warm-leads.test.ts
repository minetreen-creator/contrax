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
  expect(api.indexOf("Admin access required")).toBeLessThan(api.indexOf("FROM users u"));
  expect(api).toContain("COALESCE(u.subscription_status, '') <> 'active'");
  expect(api).toContain("qaExternalUserSQL()");
  expect(readFileSync("src/routes/admin/outreach.tsx", "utf8")).toContain("<WarmLeadsCard />");
});
