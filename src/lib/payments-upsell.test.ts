import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { awardResultsHtml, type AwardEmailItem } from "./email";
import { PAYMENTS_WON_LINE, paymentsHref } from "./payments-upsell";

// Owner 2026-11-08: introduce Contrax Payments only after a contractor wins.
const item = (outcome: AwardEmailItem["outcome"]): AwardEmailItem => ({
  bidId: 1, title: "Janitorial services", agency: "VA", awardeeName: "ACME LLC", amount: 120000, awardDate: "2026-11-01", outcome,
});

describe("Contrax Payments at the won moment", () => {
  test("the line promises only what Payments does", () => {
    expect(PAYMENTS_WON_LINE).toContain("labor hours, paperwork and invoice follow-ups");
    expect(PAYMENTS_WON_LINE).toContain("$9/month");
    expect(PAYMENTS_WON_LINE).not.toMatch(/send invoices|collect payments|payroll/i);
    expect(paymentsHref("won_email", true)).toBe("https://www.contrax.company/contract-payments?source=won_email");
  });

  test("the award email shows it only when they won, once", () => {
    const won = awardResultsHtml([item("won"), item("won")]);
    expect(won.split("contract-payments?source=won_email").length - 1).toBe(1);
    for (const o of ["lost", "submitted", "saved"] as const) {
      expect(awardResultsHtml([item(o)])).not.toContain("contract-payments");
    }
  });

  test("the pipeline shows it on a bid marked Won", () => {
    const src = readFileSync(new URL("../routes/pipeline.tsx", import.meta.url), "utf8");
    expect(src).toContain('item.pursuit_status === "won" && (');
    expect(src).toContain('paymentsHref("pipeline_won")');
  });
});
