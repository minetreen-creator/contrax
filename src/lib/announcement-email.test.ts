import { describe, expect, test } from "bun:test";
import { announcementRecipients, federalUpgradeEmail } from "./announcement-email";

describe("announcementRecipients", () => {
  test("every account once, minus admins, test accounts, unsubscribes and earlier sends", () => {
    const users = [
      { email: "a@biz.com" },
      { email: "A@Biz.com" },
      { email: "owner@contrax.company", is_admin: true },
      { email: "qa@test.contrax" },
      { email: "gone@biz.com" },
      { email: "done@biz.com" },
      { email: "" },
      { email: null },
      { email: " b@biz.com " },
    ];
    expect(announcementRecipients(users, new Set(["gone@biz.com"]), new Set(["done@biz.com"]))).toEqual([
      "a@biz.com",
      "b@biz.com",
    ]);
  });
});

describe("federalUpgradeEmail", () => {
  const e = federalUpgradeEmail("https://www.contrax.company/api/email/weekly-unsubscribe?token=abc");
  test("subject, measured-safe numbers and the unsubscribe link", () => {
    expect(e.subject).toBe("Contrax now tracks nearly 3× more federal bids");
    expect(e.html).toContain("Over 5,700 open federal bids");
    expect(e.html).toContain("All 50 states + DC");
    expect(e.html).toContain("weekly-unsubscribe?token=abc");
    expect(e.text).toContain("weekly-unsubscribe?token=abc");
  });
  test("owner wording rules: no 'free', no 'get started'", () => {
    for (const body of [e.html, e.text]) {
      expect(body.toLowerCase()).not.toContain("free");
      expect(body.toLowerCase()).not.toContain("get started");
    }
  });
});
