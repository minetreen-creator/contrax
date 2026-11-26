import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memberNoticeUrl, verifyMemberNotice, withMemberNoticeLinks } from "./member-notice-link.server";

const env = { RESEND_API_KEY: "test-key" };

// Owner 2026-11-26: the paid morning email linked straight to the government's page, so nothing
// showed whether a paying member ever opened a notice.
test("a member's link verifies for that member and bid only", () => {
  const url = memberNoticeUrl(41, 2992147, env)!;
  expect(url.startsWith("https://www.contrax.company/api/member/notice?b=2992147&u=41&s=")).toBe(true);
  const sig = new URL(url).searchParams.get("s")!;
  expect(verifyMemberNotice(41, 2992147, sig, env)).toBe(true);
  expect(verifyMemberNotice(42, 2992147, sig, env)).toBe(false);
  expect(verifyMemberNotice(41, 2992148, sig, env)).toBe(false);
  expect(verifyMemberNotice(41, 2992147, sig, { RESEND_API_KEY: "another-key" })).toBe(false);
  expect(verifyMemberNotice(41, 2992147, "", env)).toBe(false);
});

test("without a secret or an id the email keeps the bid's own link", () => {
  expect(memberNoticeUrl(41, 7, {})).toBeNull();
  expect(memberNoticeUrl(0, 7, env)).toBeNull();
  const bids = [{ source_url: "https://agency.example/bid/1", bid_id: 7, title: "A" }, { source_url: "https://agency.example/bid/2", title: "B" }];
  expect(withMemberNoticeLinks(41, bids, {}).map((b) => b.source_url)).toEqual(["https://agency.example/bid/1", "https://agency.example/bid/2"]);
  expect(withMemberNoticeLinks(null, bids, env).map((b) => b.source_url)).toEqual(["https://agency.example/bid/1", "https://agency.example/bid/2"]);
  const linked = withMemberNoticeLinks(41, bids, env);
  expect(linked[0].source_url).toContain("/api/member/notice?b=7&u=41&s=");
  expect(linked[1].source_url).toBe("https://agency.example/bid/2");
  expect(linked[0].title).toBe("A");
  expect(bids[0].source_url).toBe("https://agency.example/bid/1"); // the caller's list is not changed
});

test("the redirect never hands the official link to an unsigned request, and the email uses the signed links", () => {
  const route = readFileSync("src/routes/api/member/notice.ts", "utf8");
  expect(route.indexOf("verifyMemberNotice(userId, bidId")).toBeLessThan(route.indexOf("SELECT source_url FROM bids"));
  expect(route).toContain("return redirect(page);");
  expect(readFileSync("src/jobs/send-bid-digest.ts", "utf8")).toContain("withMemberNoticeLinks(u.user_id ? Number(u.user_id) : null");
});
