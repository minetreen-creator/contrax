/**
 * Vermont — LIVE source validation (opt-in: `bun run validate:live-sources`).
 *
 * The shared gate lives in `connectors/live-validation-harness.test.ts`. What is
 * Vermont-specific is the multi-page corpus (the agency's Funding and Incentives
 * listing + the programme pages it publishes + the VCDP applicant-guidance page)
 * and the fact that this source's dated blocks are mostly dates the connector must
 * REFUSE: a public-comment deadline on a draft federal report, a TIF
 * debt-incurrence timeline, an incentive/activity period, and the board-meeting
 * dates a rolling programme only recommends.
 */
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";
import {
  VERMONT_AGENCY,
  VERMONT_APPROVED_HOSTS,
  VERMONT_INDEX_MARKER,
  VERMONT_LISTING_URL,
  VERMONT_PROGRAMME_PAGES,
  VERMONT_SOURCE_NAME,
  VERMONT_SOURCE_VALIDATION_TEST,
  VERMONT_SUBMISSION_COLUMN_LABEL,
  VERMONT_VCDP_APPLICANT_GUIDANCE_URL,
  vermontConnector,
} from "~/lib/state-grants/connectors/vermont";

await runLiveSourceValidation({
  connector: vermontConnector,
  approvedHosts: VERMONT_APPROVED_HOSTS,
  sourceName: VERMONT_SOURCE_NAME,
  validationTestFile: VERMONT_SOURCE_VALIDATION_TEST,
  expectLive: (opportunities, liveText) => {
    // The agency's own listing sentence, its published column label, its rolling
    // wording and the publishing body all exist on the live pages we read.
    expect(liveText).toContain(VERMONT_INDEX_MARKER);
    expect(liveText).toContain(VERMONT_SUBMISSION_COLUMN_LABEL);
    expect(liveText).toContain("on a rolling basis");
    expect(liveText).toContain(VERMONT_AGENCY);
    expect(opportunities.length).toBeGreaterThanOrEqual(5);

    for (const o of opportunities) {
      // Every record is attributed to ONE of the pages this connector reads —
      // never to the listing and never to a page we do not fetch.
      expect(VERMONT_PROGRAMME_PAGES).toContain(o.url);
      expect(o.raw.listedBy).toBe(VERMONT_LISTING_URL);
      // The five statuses only; `forecast` is gone (owner 2026-09-19).
      expect(o.status as string).not.toBe("forecast");
    }

    // The programme record is rolling ONLY because the agency says so, in its own
    // words, and it therefore carries no deadline.
    const rolling = opportunities.filter((o) => o.status === "rolling");
    expect(rolling.length).toBeGreaterThanOrEqual(1);
    for (const o of rolling) {
      expect(o.raw.rollingDeclaredBySource).toBe(true);
      expect(String(o.raw.rollingSentence)).toContain("on a rolling basis");
      expect(o.closeDate).toBeNull();
    }

    // The Downtown Transportation Fund page is closed in the agency's own words.
    const closed = opportunities.filter((o) => o.raw.sourceClosedDeclaredBySource === true);
    expect(closed.length).toBeGreaterThanOrEqual(1);
    for (const o of closed) {
      expect(o.status).toBe("closed");
      expect(String(o.raw.closedSentence)).toContain("is now closed");
    }

    // The dates this source publishes for something OTHER than an application stay
    // refused on live bytes: TIF debt incurrence and the VEGI activity period.
    const tif = opportunities.find((o) => String(o.url).endsWith("/vepc/tif"))!;
    expect(tif).toBeDefined();
    expect(tif.status).toBe("unverified");
    expect(tif.closeDate).toBeNull();
    const tifRefusals = tif.raw.refusedDates as { kind: string; text: string; reason: string }[];
    expect(tifRefusals.some((r) => r.kind === "debt-incurrence")).toBe(true);
    expect(tifRefusals.some((r) => r.text.includes("March 31, 2027"))).toBe(true);
    expect(tif.raw.refusedDatesNeverCloseDates).toBe(true);

    const vegi = opportunities.find((o) => String(o.url).endsWith("/vepc/vegi"))!;
    expect(vegi).toBeDefined();
    expect(vegi.status).toBe("unverified");
    expect(vegi.closeDate).toBeNull();
    const vegiRefusals = vegi.raw.refusedDates as { kind: string; text: string; reason: string }[];
    expect(vegiRefusals.some((r) => r.kind === "incentive-period")).toBe(true);

    // The public-comment deadline on the draft federal report is refused, never
    // served as a VCDP application deadline.
    const vcdp = opportunities.find((o) => String(o.url).endsWith("/funding-incentives/vcdp"))!;
    expect(vcdp).toBeDefined();
    expect(vcdp.status).toBe("rolling");
    expect(vcdp.closeDate).toBeNull();
    const vcdpRefusals = vcdp.raw.refusedDates as { kind: string; text: string; reason: string }[];
    expect(vcdpRefusals.some((r) => r.kind === "public-comment")).toBe(true);
    for (const o of opportunities) expect(o.closeDate).not.toBe("2026-09-28");

    // The dated records are the agency's own submission-schedule rows: each one
    // carries the value of the column the agency labels itself, from its own row.
    const dated = opportunities.filter((o) => o.closeDate !== null);
    expect(dated.length).toBeGreaterThanOrEqual(1);
    for (const o of dated) {
      expect(o.url).toBe(VERMONT_VCDP_APPLICANT_GUIDANCE_URL);
      expect(o.raw.submissionColumnLabel).toBe(VERMONT_SUBMISSION_COLUMN_LABEL);
      expect(o.raw.datesReadFromOwnRowCell).toBe(true);
      expect(o.closeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(o.estimatedCloseDate).toBeNull();
      // A published submission date is either still ahead of us (open) or passed
      // (closed on a still-live page) — never a forecast and never rolling.
      expect(["open", "upcoming", "closed"]).toContain(o.status);
    }
  },
});
