/**
 * NEW JERSEY FIXTURE TESTS — deterministic, ZERO network (owner guardrail
 * 2026-09-19: ordinary CI never touches a live website). The payload is the real
 * trimmed capture in `./fixtures/new-jersey-njda-grants.html` (NJDA's own grants
 * page, fetched live 2026-09-20), parsed through the real connector.
 *
 * The live half is `new-jersey.source-validation.test.ts` (opt-in).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  STATE_GRANT_STATUSES,
  parseGrantOpportunities,
  type SourceGrantRecord,
} from "~/lib/state-grants/connector";
import { stripTags } from "~/lib/state-grants/connectors/source-support";
import {
  NEW_JERSEY_SOURCE_URL,
  newJerseyConnector,
} from "~/lib/state-grants/connectors/new-jersey";

/** One fixed clock for every classification below (2026-09-20, US Eastern). */
const NOW = new Date("2026-09-20T12:00:00Z");
function fixture(): string {
  return readFileSync(new URL("./fixtures/new-jersey-njda-grants.html", import.meta.url), "utf8");
}
const NJ = (): SourceGrantRecord[] =>
  parseGrantOpportunities(newJerseyConnector, fixture(), NOW).opportunities;
const byStatus = (status: string) => NJ().filter((o) => o.status === status);
const byId = (fragment: string): SourceGrantRecord => {
  const found = NJ().find((o) => o.externalId.includes(fragment));
  if (found === undefined) throw new Error(`no New Jersey record whose id contains ${fragment}`);
  return found;
};

describe("New Jersey NJDA page — the corpus the page actually publishes", () => {
  test("14 programmes: the page's own buckets decide which are served", () => {
    const records = NJ();
    expect(records.length).toBe(14);
    // open bucket: 3, closed bucket: 8, SADC bucket: 3.
    expect(records.filter((o) => o.raw.pageBucket === "open").length).toBe(3);
    expect(records.filter((o) => o.raw.pageBucket === "closed").length).toBe(8);
    expect(records.filter((o) => o.raw.pageBucket === "sadc").length).toBe(3);
    for (const o of records) {
      expect(o.stateCode).toBe("NJ");
      expect(o.sourceKey).toBe(newJerseyConnector.id);
      expect(STATE_GRANT_STATUSES).toContain(o.status);
      expect(JSON.stringify(o)).not.toContain("forecast");
      // Every link stays on the state's own host.
      expect(o.url).toContain("nj.gov");
      expect(o.sourceUrl).toBe(NEW_JERSEY_SOURCE_URL);
      // The page publishes no posting date and no estimate for a programme.
      expect(o.postedDate).toBeNull();
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.raw.closeDateLabelReadFromThisProgramsOwnSection).toBe(true);
      expect(o.raw.refusedDatesNeverCloseDates).toBe(true);
    }
  });

  test("a close date exists ONLY where the source labelled one, and it is a real day", () => {
    const dated = NJ().filter((o) => o.closeDate !== null);
    expect(dated.map((o) => o.externalId).sort()).toEqual(
      [
        "njda-farm-gleaning-and-seafood-recovery-support-program",
        "njda-new-jersey-wine-industry-project-grants",
        "njda-resilient-food-systems-infrastructure-program",
        "njda-spotted-lanternfly-slf-grant-program-2024-2026",
        "njda-usda-ams-specialty-crop-multi-state-program-scmp",
        "njda-underserved-beginning-and-military-veteran-farmers-mini-grant-program",
      ].sort(),
    );
    for (const o of dated) {
      expect(o.closeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // The source's own label, verbatim, is kept beside the parsed day.
    expect(byId("scmp").raw.closeDateLabelText).toBe("October 16, 2026");
    expect(byId("scmp").closeDate).toBe("2026-10-16");
    expect(byId("scmp").status).toBe("open");
    // "on or before March 15, 2024" — the Resilient Food Systems round.
    expect(byId("resilient-food-systems").closeDate).toBe("2024-03-15");
    expect(byId("resilient-food-systems").status).toBe("closed");
    // "Applications received after November 30, 2024, will not be considered."
    expect(byId("lanternfly").closeDate).toBe("2024-11-30");
    // "no later than noon, 12:00 P.M., on July 31st, 2026".
    expect(byId("gleaning").closeDate).toBe("2026-07-31");
  });

  test("`rolling` comes only from the source's own open-ended declaration", () => {
    const rolling = byStatus("rolling");
    expect(rolling.map((o) => o.title).sort()).toEqual(
      [
        "Wildlife Fence Cost-Share Grants - For Preserved Farms",
        "Wildlife Fence Cost-Share Program (Unpreserved Farms)",
      ].sort(),
    );
    expect(byId("unpreserved").raw.rollingDeclarationText).toBe("There is no deadline to apply");
    for (const o of rolling) {
      expect(o.ongoing).toBe(true);
      expect(o.closeDate).toBeNull();
      expect(o.sourceClosed).toBe(false);
    }
  });

  test("`closed` comes only from the source's own past-tense statement", () => {
    const closed = byStatus("closed");
    expect(closed.length).toBe(8);
    for (const o of closed) {
      expect(o.sourceClosed).toBe(true);
      expect(o.raw.sourceClosedDeclaredBySource).toBe(true);
      expect(String(o.raw.sourceClosedStatementText).toLowerCase()).toContain("clos");
    }
    // NJATP mentions a "rolling basis" for LATE applications — the source's own
    // closure wins and the rolling wording is NEVER promoted into `ongoing`.
    const njatp = byId("njatp");
    expect(njatp.status).toBe("closed");
    expect(njatp.ongoing).toBe(false);
    expect(njatp.closeDate).toBeNull();
  });

  test("an open programme with NO published deadline is `unverified`, never dated", () => {
    const awmp = byId("animal-waste-management");
    expect(awmp.status).toBe("unverified");
    expect(awmp.closeDate).toBeNull();
    expect(awmp.raw.listedUnderOpenProgramsBySource).toBe(true);
    expect(awmp.raw.closeDateLabelText).toBeNull();
    // Its only per-programme link is the NOFA document the source publishes.
    expect(awmp.url).toContain("NJDA_NOFA");
    for (const o of byStatus("unverified")) {
      expect(o.closeDate).toBeNull();
    }
  });

  test("every date the source publishes but does not label as a deadline is REFUSED", () => {
    const unpreserved = byId("unpreserved").raw.refusedDates as {
      text: string;
      kind: string;
      reason: string;
    }[];
    const availability = unpreserved.find((r) => r.text === "April 1, 2025");
    expect(availability?.kind).toBe("funding-availability");
    expect(availability?.reason).toContain("never an application deadline");
    // A year-less cut-off can never become a close date (SCBGP's "May 14th").
    const scbgp = byId("scbgp").raw.refusedDates as { text: string; kind: string }[];
    expect(scbgp.some((r) => r.text === "May 14th" && r.kind === "year-less")).toBe(true);
    expect(byId("scbgp").closeDate).toBeNull();
    // A month-and-year period is refused rather than completed (AFT: "June 2027").
    const aft = byId("farm-transition").raw.refusedDates as { text: string; kind: string }[];
    expect(aft.some((r) => r.text === "June 2027")).toBe(true);
    // The gleaning round's year-less email cut-off is refused while its own
    // labelled deadline is read.
    const gleaning = byId("gleaning").raw.refusedDates as { text: string; kind: string }[];
    expect(gleaning.some((r) => r.text === "July 31st" && r.kind === "year-less")).toBe(true);
  });

  test("amounts are only derived where the source's own wording supports them", () => {
    // "Funding for projects up to $5,000" — one ceiling.
    expect(byId("unpreserved").awardMaxAmount).toBe(5000);
    expect(byId("unpreserved").awardMinAmount).toBeNull();
    // "up to $100,000" (the AWMP grant) — one ceiling.
    expect(byId("animal-waste-management").awardMaxAmount).toBe(100000);
    // "ranging between $250,000 and $1,000,000" — one range.
    expect(byId("scmp").awardMinAmount).toBe(250000);
    expect(byId("scmp").awardMaxAmount).toBe(1000000);
    // Two application tracks plus a total allotment: wording kept, no arithmetic.
    const rfsi = byId("resilient-food-systems");
    expect(rfsi.awardRange).toContain("3,437,002");
    expect(rfsi.awardMinAmount).toBeNull();
    expect(rfsi.awardMaxAmount).toBeNull();
    // Per-county AND per-municipality tiers are not one ceiling either.
    expect(byId("lanternfly").awardMaxAmount).toBeNull();
    expect(byId("lanternfly").awardRange).toContain("$50,000 per county");
  });

  test("the third-party bucket is NEVER served, and it is named in the record", () => {
    const excluded = byId("animal-waste-management").raw.thirdPartyProgramsExcluded as string[];
    expect(excluded.length).toBe(4);
    expect(excluded.join(" | ")).toContain("Fulfill");
    expect(excluded.join(" | ")).toContain("Community FoodBank");
    expect(excluded.join(" | ")).toContain("Junior Breeder");
    const served = NJ().map((o) => o.title).join(" | ");
    for (const title of excluded) {
      expect(served).not.toContain(title);
    }
    expect(byId("animal-waste-management").raw.otherFundingOpportunitiesAreNotNjdaPrograms).toBe(true);
  });

  test("the labelled fields the page publishes are carried through verbatim", () => {
    const awmp = byId("animal-waste-management");
    expect(awmp.summary).toContain("NJDA Animal Waste Management rules");
    expect(awmp.eligibleApplicants).toContain("Soil Conservation District");
    expect(awmp.raw.howToApplyText).toContain("denise.cannuli@ag.nj.gov");
    // Nothing invented: no geography or category the source did not publish.
    expect(awmp.eligibleGeography).toBe("Not specified");
    expect(awmp.categories).toEqual([]);
    expect(awmp.totalFunding).toBe("Not specified");
    expect(awmp.matchingRequirement).toBe("Not specified");
  });

  test("deterministic: the same bytes parse to the same records, twice", () => {
    const first = JSON.stringify(NJ());
    const second = JSON.stringify(NJ());
    expect(second).toBe(first);
    expect(parseGrantOpportunities(newJerseyConnector, fixture(), NOW).collisions).toEqual([]);
  });

  test("a payload that is not the NJDA page fails loudly", () => {
    expect(() => parseGrantOpportunities(newJerseyConnector, "<html>hi</html>", NOW)).toThrow(
      /not the expected NJDA grants page/,
    );
    // The right marker but no buckets at all is a changed page, not an empty corpus.
    expect(() =>
      parseGrantOpportunities(
        newJerseyConnector,
        `<html>${"NJDA Grant Opportunities"}</html>`,
        NOW,
      ),
    ).toThrow(/Open Opportunities/);
    expect(stripTags(fixture())).toContain("NJDA Grant Opportunities");
  });
});
