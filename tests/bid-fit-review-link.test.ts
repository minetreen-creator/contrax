import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { bidFitReviewHref, deadlineDateText, isHttpUrl, MIN_DAYS_BEFORE_DEADLINE } from "~/lib/bid-fit-review-link";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const NOTICE = "https://mvendor.cgieva.com/Vendor/public/IVDetails.jsp?PageTitle=SO%20Details&rfp_id_lot=128951&rfp_id_round=1";

describe("Bid Fit Review link next to a bid", () => {
  test("pre-fills the notice link and the deadline date", () => {
    const href = bidFitReviewHref({ source_url: NOTICE, due_date: "2026-10-12T14:00:00.000Z" }, NOW)!;
    const url = new URL(href, "https://x");
    expect(url.pathname).toBe("/bid-fit-review");
    expect(url.searchParams.get("url")).toBe(NOTICE);
    expect(url.searchParams.get("deadline")).toBe("October 12, 2026");
  });

  test("not offered when the deadline is too close to deliver in time", () => {
    const soon = new Date(NOW + (MIN_DAYS_BEFORE_DEADLINE - 1) * 86_400_000).toISOString();
    expect(bidFitReviewHref({ source_url: NOTICE, due_date: soon }, NOW)).toBeNull();
    expect(bidFitReviewHref({ source_url: NOTICE, due_date: "2026-09-30T00:00:00Z" }, NOW)).toBeNull();
  });

  test("not offered without a deadline or a real link", () => {
    expect(bidFitReviewHref({ source_url: NOTICE, due_date: null }, NOW)).toBeNull();
    expect(bidFitReviewHref({ source_url: null, due_date: "2026-11-01T00:00:00Z" }, NOW)).toBeNull();
    expect(bidFitReviewHref({ source_url: "javascript:alert(1)", due_date: "2026-11-01T00:00:00Z" }, NOW)).toBeNull();
  });

  test("helpers", () => {
    expect(isHttpUrl("https://www.flyorf.com/airport-business/")).toBe(true);
    expect(isHttpUrl("ftp://example.com")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
    expect(deadlineDateText("2026-11-09T14:00:00Z")).toBe("November 9, 2026");
  });

  test("the form reads the pre-fill and the bid views show the link", () => {
    const form = readFileSync(new URL("../src/routes/bid-fit-review.tsx", import.meta.url), "utf8");
    expect(form).toContain("validateSearch");
    expect(form).toContain("defaultValue={prefill.url");
    expect(form).toContain("defaultValue={prefill.deadline");
    const cards = readFileSync(new URL("../src/lib/seo-landing.tsx", import.meta.url), "utf8");
    expect(cards).toContain("bidFitReviewHref(b)");
    expect(cards).not.toContain("Open original notice on SAM.gov");
    const detail = readFileSync(new URL("../src/routes/bid.$bidId.tsx", import.meta.url), "utf8");
    expect(detail).toContain("bidFitReviewHref(bid)");
  });
});
