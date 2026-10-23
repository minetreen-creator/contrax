import { describe, expect, test } from "bun:test";
import {
  CONTACTED_BY_HAND,
  daysUntil,
  emailFitsSite,
  placeIsLocal,
  followupDue,
  outreachEmail,
  validPostalAddress,
  type OutreachEmailInput,
} from "./outreach";
import { unsubscribeToken, verifyUnsubscribeToken } from "./outreach.server";

const base: OutreachEmailInput = {
  kind: "first",
  business: "Acme Cleaning",
  bidId: 123,
  bidTitle: "Janitorial Services",
  buyer: "Botetourt County, Virginia",
  due: "2026-11-05",
  tradeLabel: "janitorial",
  postalAddress: "100 Main St, Richmond VA 23219",
  unsubscribeUrl: "https://www.contrax.company/api/outreach/unsubscribe?t=abc",
  contactId: 7,
};
const ENV = { OUTREACH_SECRET: "s".repeat(32) };

describe("daily bid outreach (owner 2026-10-23)", () => {
  test("every email carries the postal address and a working unsubscribe link (CAN-SPAM)", () => {
    for (const kind of ["first", "followup"] as const) {
      const m = outreachEmail({ ...base, kind });
      for (const part of [m.text, m.html]) {
        expect(part).toContain("100 Main St, Richmond VA 23219");
        expect(part).toContain(base.unsubscribeUrl);
      }
    }
  });

  test("first email names the bid, buyer and due date and links the bid with attribution", () => {
    const m = outreachEmail(base);
    expect(m.subject).toBe("Open bid near you: Janitorial Services");
    expect(m.text).toContain("fit for Acme Cleaning");
    expect(m.text).toContain("Buyer: Botetourt County, Virginia");
    expect(m.text).toContain("Due: Nov 5, 2026");
    expect(m.text).toContain("https://www.contrax.company/bid/123?utm_source=email&utm_medium=outreach&utm_campaign=bid_outreach_first&oc=7");
    expect(m.text).toContain("other open janitorial bids");
  });

  test("follow-up offers Bid Scout and threads under the first subject", () => {
    const m = outreachEmail({ ...base, kind: "followup" });
    expect(m.subject).toBe("Re: Open bid near you: Janitorial Services");
    expect(m.text).toContain("Bid Scout");
    expect(m.text).toContain("/bid-scout?source=outreach&utm_source=email");
  });

  test("HTML escapes business and bid text", () => {
    const m = outreachEmail({ ...base, business: "A&B <Cleaning>" });
    expect(m.html).toContain("A&amp;B &lt;Cleaning&gt;");
    expect(m.html).not.toContain("<Cleaning>");
  });

  test("follow-up timing and days until due", () => {
    const sent = new Date("2026-10-23T14:00:00Z");
    expect(followupDue(sent, new Date("2026-10-26T14:00:00Z"))).toBe(false);
    expect(followupDue(sent, new Date("2026-10-27T14:00:00Z"))).toBe(true);
    expect(daysUntil("2026-11-05", new Date("2026-10-26T20:00:00Z"))).toBe(10);
  });

  test("a mailing address is required", () => {
    expect(validPostalAddress("")).toBe(false);
    expect(validPostalAddress(null)).toBe(false);
    expect(validPostalAddress("Virginia")).toBe(false);
    expect(validPostalAddress("100 Main St, Richmond VA 23219")).toBe(true);
  });

  test("unsubscribe tokens name only the signed address", () => {
    const t = unsubscribeToken("Owner@Acme.com", ENV);
    expect(verifyUnsubscribeToken(t, ENV)).toBe("owner@acme.com");
    expect(verifyUnsubscribeToken(t, { OUTREACH_SECRET: "x".repeat(32) })).toBeNull();
    const forged = `${Buffer.from("other@acme.com").toString("base64url")}.${t.split(".")[1]}`;
    expect(verifyUnsubscribeToken(forged, ENV)).toBeNull();
    expect(verifyUnsubscribeToken("garbage", ENV)).toBeNull();
  });

  test("the businesses emailed by hand are never emailed again", () => {
    expect(CONTACTED_BY_HAND).toHaveLength(19);
    expect(CONTACTED_BY_HAND.every((e) => e === e.toLowerCase() && e.includes("@"))).toBe(true);
  });

  test("only addresses that belong to the business are used", () => {
    expect(emailFitsSite("info@acmecleaning.com", "acmecleaning.com")).toBe(true);
    expect(emailFitsSite("office@mail.acmecleaning.com", "acmecleaning.com")).toBe(true);
    expect(emailFitsSite("acmecleaning@gmail.com", "acmecleaning.com")).toBe(true);
    expect(emailFitsSite("team@latofonts.com", "texasranchlandscaping.com")).toBe(false);
    expect(emailFitsSite("hello@webdesigner.io", "acmecleaning.com")).toBe(false);
    expect(emailFitsSite("broken", "acmecleaning.com")).toBe(false);
  });

  test("a place must be a town, county or agency, not a state or purchasing group", () => {
    expect(placeIsLocal("Texas")).toBe(false);
    expect(placeIsLocal("TX")).toBe(false);
    expect(placeIsLocal("Texas Purchasing Group (BidNet Direct)")).toBe(false);
    expect(placeIsLocal("")).toBe(false);
    expect(placeIsLocal("Bigfork, MT")).toBe(true);
    expect(placeIsLocal("City of Huntsville")).toBe(true);
    expect(placeIsLocal("Smith Mountain, Virginia")).toBe(true);
  });
});
