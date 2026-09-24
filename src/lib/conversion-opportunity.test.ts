import { describe, expect, test } from "bun:test";
import { buildConversionOpportunity, type ConversionOpportunitySignals } from "./conversion-opportunity";

const base: ConversionOpportunitySignals = {
  signedUp: false, signupStarted: false, radarCompleted: true, pricingViewed: false,
  savedBid: false, incumbentViewed: false, briefViewed: false,
  autopsyAwardFound: false, autopsyReportViewed: false, emailKnown: false, reasons: [],
};

describe("conversion opportunity contactability", () => {
  test("anonymous visitors get on-site guidance, never a send instruction", () => {
    const result = buildConversionOpportunity(base);
    expect(result.channel).toBe("onsite");
    expect(result.best_next).toContain("on-site");
    expect(result.best_next.toLowerCase()).not.toContain("send");
  });

  test("a captured email makes an abandoned signup directly actionable", () => {
    const result = buildConversionOpportunity({ ...base, emailKnown: true, signupStarted: true, radarCompleted: false });
    expect(result.channel).toBe("outreach");
    expect(result.best_next).toContain("send one useful reminder");
  });

  test("anonymous incumbent interest remains an on-site action", () => {
    const result = buildConversionOpportunity({ ...base, incumbentViewed: true });
    expect(result.channel).toBe("onsite");
    expect(result.obstacle).toContain("outreach is not possible");
  });
});
