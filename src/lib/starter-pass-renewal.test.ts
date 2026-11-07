import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { passReminderEmail, PASS_RENEW_URL, type PassRecap } from "./starter-pass";
import { passRenewToken, passRenewUrl, RENEW_LINK_GRACE_DAYS, verifyPassRenewToken } from "./starter-pass.server";

// Owner 2026-11-07 ("2 only"): the day-25 reminder shows what the pass found and
// its button opens the $19/month checkout in one click.
const env = { CRON_SECRET: "test-secret" };
const ends = new Date("2026-12-04T00:05:52Z");
const recap: PassRecap = {
  since: new Date("2026-11-04T00:05:52Z"),
  newMatches: 37,
  examples: [
    { id: 101, title: "Lindsey Kyla Ct Bridge Replacement", agency: "City of Portland", dueDate: "2026-11-18T14:00:00.000Z" },
    { id: 102, title: "Asphalt Repair <Phase 2>", agency: null, dueDate: null },
    { id: 103, title: "CoSCC Utility Shed Relocation", agency: "Tennessee Board of Regents (Columbia SCC)", dueDate: "2026-12-02T20:00:00.000Z" },
    { id: 104, title: "A fourth one", agency: null, dueDate: null },
  ],
  tradePlace: "Construction in Tennessee",
};

describe("pass reminder with what the pass found", () => {
  test("leads with the count and three of the newest, linked; one-click button", () => {
    const url = passRenewUrl(42, ends, env);
    const m = passReminderEmail(ends, { recap, renewUrl: url });
    expect(m.subject).toBe("Your Contrax pass found 37 open bids. It ends December 3");
    expect(m.text).toContain("Since your pass started on November 3, Contrax has matched 37 new bids in Construction in Tennessee that are still open.");
    expect(m.text).toContain("3 of the newest:");
    expect(m.text).toContain("- Lindsey Kyla Ct Bridge Replacement · City of Portland · due Nov 18: https://www.contrax.company/bid/101?source=pass_reminder");
    expect(m.text).not.toContain("A fourth one");
    expect(m.text).toContain(`Keep my bid emails ($19/month): ${url}`);
    expect(m.text).toContain("you won't be charged");
    expect(m.html).toContain("Asphalt Repair &lt;Phase 2&gt;");
    expect(m.html).toContain("Keep my bid emails ($19/month)");
    expect(m.html).toContain(url);
  });

  test("no matches or no recap: the plain reminder, never a made-up number", () => {
    for (const r of [null, { ...recap, newMatches: 0, examples: [] }]) {
      const m = passReminderEmail(ends, { recap: r });
      expect(m.subject).toBe("Your Contrax bid emails stop on December 3");
      expect(m.text).not.toContain("Since your pass started");
      expect(m.html).toContain(PASS_RENEW_URL);
    }
    expect(passReminderEmail(ends, { recap: { ...recap, newMatches: 1, examples: [recap.examples[0]] } }).subject).toBe("Your Contrax pass found 1 open bid. It ends December 3");
  });
});

describe("signed one-click renewal link", () => {
  test("names one account, verifies, expires 14 days after the pass, rejects tampering", () => {
    const t = passRenewToken(42, ends, env);
    expect(verifyPassRenewToken(t, ends.getTime(), env)).toBe(42);
    expect(verifyPassRenewToken(t, ends.getTime() + (RENEW_LINK_GRACE_DAYS - 1) * 86_400_000, env)).toBe(42);
    expect(verifyPassRenewToken(t, ends.getTime() + (RENEW_LINK_GRACE_DAYS + 1) * 86_400_000, env)).toBeNull();
    const forged = `${Buffer.from(`43.${Math.floor(ends.getTime() / 1000) + 99_999_999}`).toString("base64url")}.${t.split(".")[1]}`;
    expect(verifyPassRenewToken(forged, ends.getTime(), env)).toBeNull();
    expect(verifyPassRenewToken(t, ends.getTime(), { CRON_SECRET: "other" })).toBeNull();
    expect(verifyPassRenewToken("garbage", ends.getTime(), env)).toBeNull();
    expect(passRenewUrl(42, ends, env)).toStartWith("https://www.contrax.company/api/renew-pass?t=");
  });

  test("wired: the job sends recap + link; the route opens a full-price Starter checkout or falls back", () => {
    const job = readFileSync("src/lib/starter-pass.server.ts", "utf8");
    expect(job).toContain("passReminderEmail(endsAt, { recap: await loadPassRecap(u.id, since), renewUrl })");
    const route = readFileSync("src/routes/api/renew-pass.ts", "utf8");
    expect(route).toContain('createCheckoutSession("starter", { userId: u.id, fullPrice: true, mode: "subscription", interval: "month" })');
    expect(route).toContain("const FALLBACK = \"https://www.contrax.company/upgrade?plan=starter&source=pass_reminder\"");
    expect(route).toContain("status: 303");
  });
});
