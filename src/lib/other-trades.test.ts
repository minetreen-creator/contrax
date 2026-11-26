import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cleanOtherTrades, MAX_OTHER_TRADES } from "./other-trades";
import { buildDigestMatcher } from "./digest-match";
import { memberBiddingReminderEmail, MEMBER_BIDDING_LINK_TEXT } from "./member-bid-activity";
import { memberBiddingUrl, memberNoticeUrl, verifyMemberBidding, verifyMemberNotice, withMemberNoticeLinks } from "./member-notice-link.server";

const env = { RESEND_API_KEY: "test-key" };

// Owner 2026-11-26 ("1"): a buyer paid twice to follow construction and landscaping.
test("extra trades are tidied, de-duplicated and capped", () => {
  expect(cleanOtherTrades(["  landscaping ", "Landscaping", "tree   trimming", "x", "Construction"], "Construction")).toEqual(["landscaping", "tree trimming"]);
  expect(cleanOtherTrades(["<b>paving</b>", 7, null, "HVAC & plumbing"])).toEqual(["HVAC & plumbing"]);
  expect(cleanOtherTrades(["one a", "two b", "three c", "four d", "five e", "six f", "seven g"]).length).toBe(MAX_OTHER_TRADES);
  expect(cleanOtherTrades("landscaping")).toEqual([]);
});

test("the morning email matches a second trade from the same profile", () => {
  const one = buildDigestMatcher({ industry: "Construction", locations: ["SC"] });
  const two = buildDigestMatcher({ industry: "Construction", service_categories: ["landscaping"], locations: ["SC"] });
  const mowing = { title: "Grounds Maintenance and Lawn Mowing Services", location: "Columbia, SC" };
  expect(one.matches(mowing)).toBe(false);
  expect(two.matches(mowing)).toBe(true);
  expect(two.matches({ title: "Grounds Maintenance and Lawn Mowing Services", location: "Atlanta, GA" })).toBe(false);
});

test("settings saves the extra trades and an older page cannot wipe them", () => {
  const api = readFileSync("src/routes/api/profile.ts", "utf8");
  expect(api).toContain("service_categories = COALESCE(${otherTrades}::jsonb, service_categories)");
  expect(api).toContain("Array.isArray(d.otherTrades) ? JSON.stringify(cleanOtherTrades(d.otherTrades, industry)) : null");
  expect(readFileSync("src/routes/settings.tsx", "utf8")).toContain("More trades you bid on");
});

// Owner 2026-11-26 ("2"): "I'm bidding this" in the morning email.
test("the bidding link is signed apart from the notice link", () => {
  const bidding = new URL(memberBiddingUrl(41, 7, env)!);
  const notice = new URL(memberNoticeUrl(41, 7, env)!);
  expect(bidding.pathname).toBe("/bidding");
  const bs = bidding.searchParams.get("s")!;
  const ns = notice.searchParams.get("s")!;
  expect(bs).not.toBe(ns);
  expect(verifyMemberBidding(41, 7, bs, env)).toBe(true);
  expect(verifyMemberBidding(41, 7, ns, env)).toBe(false);
  expect(verifyMemberNotice(41, 7, bs, env)).toBe(false);
  expect(verifyMemberBidding(42, 7, bs, env)).toBe(false);
  const [row] = withMemberNoticeLinks(41, [{ source_url: "https://agency.example/1", bid_id: 7 }], env);
  expect(row.bidding_url).toBe(bidding.toString());
  expect(withMemberNoticeLinks(41, [{ source_url: "https://agency.example/1", bid_id: 7 }], {})[0].bidding_url).toBeUndefined();
});

test("following the link changes nothing: only the button's POST marks the bid", () => {
  const api = readFileSync("src/routes/api/member/bidding.ts", "utf8");
  expect(api).toContain("server: { handlers: { POST: handler } }");
  expect(api).not.toContain("GET:");
  expect(api.indexOf("verifyMemberBidding(userId, bidId")).toBeLessThan(api.indexOf("markMemberBidding(userId, bidId)"));
  const page = readFileSync("src/routes/bidding.tsx", "utf8");
  expect(page).not.toContain("markMemberBidding");
  const email = readFileSync("src/lib/email.ts", "utf8");
  expect(email).toContain('${bid.bidding_url ? `<p style="margin:8px 0 0;font-size:13px;"><a href="${bid.bidding_url}"');
  expect(MEMBER_BIDDING_LINK_TEXT).toContain("I'm bidding this");
});

test("the reminder names the bid and its due day, with bare links", () => {
  const m = memberBiddingReminderEmail({ title: "Fire Station  No. 8", due: "Tuesday, December 1", bidId: 1894122 });
  expect(m.subject).toBe("Due Tuesday, December 1: Fire Station No. 8");
  expect(m.text).toContain("www.contrax.company/bid/1894122");
  expect(m.text).not.toContain("https://");
  const server = readFileSync("src/lib/member-bidding.server.ts", "utf8");
  expect(server).toContain("sm.bidding_reminded_at IS NULL");
  expect(server).toContain("WHEN saved_matches.pursuit_status IN ('submitted', 'won', 'lost') THEN saved_matches.pursuit_status ELSE 'preparing'");
});
