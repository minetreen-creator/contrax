import { describe, expect, test } from "bun:test";
import { ANNOUNCEMENTS, announcementRecipients, federalUpgradeEmail, starterPassEmail, starterPassOfferFits } from "./announcement-email";

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

describe("starter-pass announcement", () => {
  test("skips paying accounts and anyone who already bought a pass", () => {
    const users = [
      { email: "basic@biz.com", subscription_status: null },
      { email: "canceled@biz.com", subscription_status: "canceled" },
      { email: "ended@biz.com", subscription_status: "pass_ended", starter_pass_bought_at: "2026-10-01" },
      { email: "paying@biz.com", subscription_status: "active" },
      { email: "trial@biz.com", subscription_status: "trialing" },
      { email: "late@biz.com", subscription_status: "past_due" },
      { email: "owner@contrax.company", is_admin: true },
    ];
    expect(announcementRecipients(users, new Set(), new Set(), starterPassOfferFits)).toEqual([
      "basic@biz.com",
      "canceled@biz.com",
    ]);
    expect(ANNOUNCEMENTS["starter-pass"].fits).toBe(starterPassOfferFits);
    expect(ANNOUNCEMENTS["starter-pass"].key).not.toBe(ANNOUNCEMENTS["federal-coverage"].key);
  });

  const e = starterPassEmail("https://www.contrax.company/api/email/weekly-unsubscribe?token=abc");
  test("the offer's terms, the pricing link and the unsubscribe link", () => {
    for (const body of [e.html, e.text]) {
      expect(body).toContain("$5 one time for your first 30 days");
      expect(body).toContain("No automatic renewal");
      expect(body).toContain("$19/month");
      expect(body).toContain("https://www.contrax.company/pricing?utm_source=email&utm_campaign=starter_pass");
      expect(body).toContain("weekly-unsubscribe?token=abc");
    }
  });
  test("owner wording rules: no 'free', no 'get started'", () => {
    for (const body of [e.subject, e.html, e.text]) {
      expect(body.toLowerCase()).not.toContain("free");
      expect(body.toLowerCase()).not.toContain("get started");
    }
  });
});
