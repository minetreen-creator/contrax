/**
 * New York — LIVE source validation (opt-in: `bun run validate:live-sources`).
 *
 * The shared gate lives in `connectors/live-validation-harness.test.ts`. What is
 * New York-specific is the ONE public-session handshake in this workstream: the
 * portal's listing is served only inside a session, so the live gate exercises
 * the whole thing — the portal's own public guest page, the temporary
 * public-session cookies it sets (in memory, this run only), and the grid that
 * follows — and then checks that the ONLY date any record carries came from the
 * column the portal itself labels "Due Date".
 */
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";
import {
  NEW_YORK_APPROVED_HOSTS,
  NEW_YORK_LISTING_MARKER,
  NEW_YORK_SESSION_URL,
  NEW_YORK_SOURCE_NAME,
  NEW_YORK_SOURCE_VALIDATION_TEST,
  newYorkConnector,
} from "~/lib/state-grants/connectors/new-york";

await runLiveSourceValidation({
  connector: newYorkConnector,
  approvedHosts: NEW_YORK_APPROVED_HOSTS,
  sourceName: NEW_YORK_SOURCE_NAME,
  validationTestFile: NEW_YORK_SOURCE_VALIDATION_TEST,
  // `newYorkConnector.agency` is the composed publishing-body label "New York
  // State — Statewide Financial System (SFS) Vendor Portal" — a human-readable
  // name for the publisher plus its portal, which no page prints as a sentence.
  // What the page DOES print, and what this gate asserts instead, is the
  // publisher's own name: "New York State" (in the site title and in program
  // titles such as "New York Statewide Fatherhood Engagement"). QA MED-1,
  // owner-approved 2026-09-20 — the assertion is retargeted, never dropped.
  agencyTextOnPage: "New York State",
  expectLive: (opportunities, liveText) => {
    // The portal's own words are on the page we read, and the handshake page is
    // the portal's own public guest page (never a third-party or an error page).
    expect(liveText).toContain(NEW_YORK_LISTING_MARKER);
    expect(liveText).toContain("New York State");
    expect(liveText).toContain("Due Date");
    expect(NEW_YORK_SESSION_URL).toContain("esupplier.sfs.ny.gov");
    // The live grid still yields records, each on the portal's own host.
    expect(opportunities.length).toBeGreaterThanOrEqual(1);
    for (const o of opportunities) {
      expect(o.url).toContain("esupplier.sfs.ny.gov");
      expect(o.sourceUrl).toBe("https://esupplier.sfs.ny.gov/psc/fscm/SUPPLIER/ERP/c/NY_SUPPUB_FL.AUC_RESP_INQ_AUC.GBL");
      // The source's own Event ID and Funding Agency code, read from its columns.
      expect(String(o.raw.eventId).length).toBeGreaterThan(0);
      expect(String(o.raw.fundingAgency).length).toBeGreaterThan(0);
      // The handshake is stated honestly on every live record.
      expect(o.raw.publicSessionOnly).toBe(true);
      expect(o.raw.credentialsNeverSent).toBe(true);
      // The ONLY date is the source's own Due Date column.
      expect(o.raw.closeDateColumnLabel).toBe("Due Date");
      expect(o.raw.closeDateReadFromTheDueDateColumn).toBe(true);
      expect(o.postedDate).toBeNull();
      expect(o.estimatedCloseDate).toBeNull();
      if (o.status === "unverified" || o.status === "rolling") {
        expect(o.closeDate).toBeNull();
      }
      if (o.closeDate !== null) {
        expect(o.closeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // The source's own cell text is kept beside the parsed day.
        expect(String(o.raw.closeDateCellText)).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
      }
      const refused = o.raw.refusedDates as { kind: string; text: string; reason: string }[];
      expect(Array.isArray(refused)).toBe(true);
      for (const r of refused) {
        expect(r.text.length).toBeGreaterThan(0);
        expect(r.reason.length).toBeGreaterThan(20);
        // A refused token is never the cell that was published as the deadline.
        expect(r.text).not.toBe(o.raw.closeDateCellText);
      }
    }
    // At least one live row publishes a real Due Date, and the portal's own two
    // other date columns are refused on the live corpus.
    expect(opportunities.filter((o) => o.closeDate !== null).length).toBeGreaterThanOrEqual(1);
    const refusedKinds = new Set(
      opportunities.flatMap((o) => (o.raw.refusedDates as { kind: string }[]).map((r) => r.kind)),
    );
    expect(refusedKinds.has("availability-date-column")).toBe(true);
    expect(refusedKinds.has("anticipated-release-date-column")).toBe(true);
  },
});
