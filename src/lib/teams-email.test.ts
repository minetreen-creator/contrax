import { expect, test } from "bun:test";
import { outreachEmail, TEAMS_FREE_REPORTS, teamsReportPath } from "./outreach";

// Owner 2026-11-15 ("go"): the sales-team email leads with the report for the reader's own state
// and trade, and the first ten who ask get the full report free.
test("the teams email opens their own market's page and offers the full report free", () => {
  expect(teamsReportPath("trade=it-services&state=VA")).toBe("/contracts-ending/virginia/it-services");
  expect(teamsReportPath("trade=construction&state=TX")).toBe("/contracts-ending/texas/construction");
  // A trade without a contracts-ending page falls back to the older view; a bad row to its index.
  expect(teamsReportPath("trade=trucking&state=VA")).toBe("/recompetes?trade=trucking&state=VA");
  expect(teamsReportPath("nonsense")).toBe("/recompetes");
  const mail = outreachEmail({
    kind: "teams",
    business: "Acme Federal Systems",
    bidId: 0,
    bidTitle: "178 federal IT services contracts in Virginia end in the next 12 months",
    buyer: "trade=it-services&state=VA",
    due: "2026-12-15",
    tradeLabel: "IT services",
    place: "Virginia",
    postalAddress: "203 Homestead Dr, Colonial Heights VA 23834",
    contactId: 77,
  } as Parameters<typeof outreachEmail>[0]);
  expect(mail.subject).toBe("178 federal IT services contracts in Virginia end in the next 12 months");
  expect(mail.text).toContain("/contracts-ending/virginia/it-services");
  expect(mail.text).toContain(`free to the first ${TEAMS_FREE_REPORTS} companies that ask`);
  expect(mail.text).toContain('Reply "report"');
  expect(mail.text).toContain("It normally costs $149");
  // One ask only: no walkthrough, no plan page.
  expect(mail.text).not.toContain("walkthrough");
  expect(mail.text).not.toContain("/teams");
});
