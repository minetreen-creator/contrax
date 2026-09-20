/**
 * IOWA ARTS COUNCIL GRANTS (fixtures) — the deterministic half of the state's
 * verification. Everything below runs on the REAL trimmed captures in
 * `./fixtures/` (one per fetched page) joined with the shared multi-page
 * delimiters, exactly as `fetch()` joins them. ZERO network.
 *
 * The live half is `iowa.source-validation.test.ts` (opt-in).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  STATE_GRANT_STATUSES,
  parseGrantOpportunities,
  type SourceGrantRecord,
} from "~/lib/state-grants/connector";
import { joinSourcePages } from "~/lib/state-grants/connectors/multi-page";
import { stripTags } from "~/lib/state-grants/connectors/source-support";
import {
  IOWA_APPROVED_HOSTS,
  IOWA_CHILD_MARKER,
  IOWA_CHILD_PAGES,
  IOWA_INDEX_MARKER,
  IOWA_PROGRAMME_PATHS,
  IOWA_SOURCE_HOST,
  IOWA_SOURCE_URL,
  iowaConnector,
} from "~/lib/state-grants/connectors/iowa";
/** One fixed clock for every classification below (2026-09-19, US Eastern). */
const NOW = new Date("2026-09-19T12:00:00Z");
function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}
/** The fixture file for one pinned programme path (the generator's own rule). */
function fileFor(path: string): string {
  const slug = path.replace(/^\/community\/arts-culture\/grants-programs\//, "").replace(/\//g, "-");
  return `iowa-${slug}.html`;
}
const INDEX_FILE = "iowa-grants-programs-index.html";
const PAYLOAD = () =>
  joinSourcePages(
    IOWA_SOURCE_URL,
    fixture(INDEX_FILE),
    IOWA_PROGRAMME_PATHS.map((path, i) => ({
      url: IOWA_CHILD_PAGES[i]!,
      html: fixture(fileFor(path)),
    })),
  );
const IA = (now: Date = NOW) =>
  parseGrantOpportunities(iowaConnector, PAYLOAD(), now).opportunities;
const byStatus = (status: string) => IA().filter((o) => o.status === status);
const parsed = (raw: string): SourceGrantRecord[] => iowaConnector.parse(raw);
const byId = (id: string) => IA().find((o) => o.externalId.endsWith(id));
/** The concatenated fixture text, for the "source really says this" checks. */
const FIXTURE_TEXT = () => stripTags(PAYLOAD());

describe("Iowa Arts Council grants & programs (fixtures)", () => {
  test("reads one record per pinned programme, plus a second for a role-scoped window", () => {
    const records = IA();
    // 18 pinned pages; the Mural program publishes one labelled deadline per
    // applicant role, so it contributes two records.
    expect(records.length).toBe(19);
    expect(byStatus("open").length).toBe(2);
    expect(byStatus("rolling").length).toBe(2);
    expect(byStatus("closed").length).toBe(12);
    expect(byStatus("unverified").length).toBe(3);
    // Every pinned page contributes exactly one record except the Mural program.
    const urls = new Set(records.map((o) => o.url));
    expect(urls.size).toBe(IOWA_CHILD_PAGES.length);
  });
  test("the owner's five statuses only — `forecast` is gone", () => {
    for (const o of IA()) {
      expect(STATE_GRANT_STATUSES).toContain(o.status);
      expect(o.status as string).not.toBe("forecast");
      expect(o.closeDate === null || o.estimatedCloseDate === null).toBe(true);
      expect(o.estimatedCloseDate).toBeNull();
    }
  });
  test("every record points at a pinned page on the FINAL host, never the listing", () => {
    for (const o of IA()) {
      expect(IOWA_CHILD_PAGES).toContain(o.url);
      expect(o.sourceUrl).toBe(IOWA_SOURCE_URL);
      expect(new URL(o.url).host).toBe("opportunityiowa.gov");
      expect(IOWA_APPROVED_HOSTS).toContain(new URL(o.url).host);
      expect(o.url).not.toBe(IOWA_SOURCE_URL);
      expect(o.externalId.startsWith("ia-arts-council-grants-")).toBe(true);
    }
  });
  test("the off-host redirect is never replayed: the connector pins the FINAL host", () => {
    // `iowaculture.gov/grants` 301s off-host onto opportunityiowa.gov. The
    // connector hard-codes that FINAL URL and allowlists only that host, so the
    // harness's off-host-redirect refusal never has to fire.
    expect(IOWA_SOURCE_HOST).toBe("opportunityiowa.gov");
    expect(IOWA_SOURCE_URL.startsWith(`https://${IOWA_SOURCE_HOST}/`)).toBe(true);
    expect(IOWA_SOURCE_URL).not.toContain("iowaculture");
    expect(IOWA_APPROVED_HOSTS.every((h) => h.endsWith("opportunityiowa.gov"))).toBe(true);
  });
  test("the listing contributes no record and no date of its own", () => {
    const listingOnly = joinSourcePages(IOWA_SOURCE_URL, fixture(INDEX_FILE), []);
    expect(parsed(listingOnly)).toEqual([]);
  });
  test("the two catalogue tiles this connector does NOT read are never fetched", () => {
    for (const excluded of [
      "artist-professional-development-grant/artist-professional-development-grant-program-guidelines",
      "reimbursements-and-final-reports-faq",
    ]) {
      expect(IOWA_CHILD_PAGES.some((u) => u.includes(excluded))).toBe(false);
    }
    // …because the first restates a window its programme page already publishes,
    // and the second is a grantee support FAQ, not a funding programme.
    expect(IOWA_CHILD_PAGES.length).toBe(18);
  });
  test("the Mural program's two labelled deadlines are read as two role-scoped records", () => {
    const communities = byId("iowans-create-community-mural-program-communities");
    const artists = byId("iowans-create-community-mural-program-artists");
    expect(communities).toBeDefined();
    expect(artists).toBeDefined();
    expect(communities!.closeDate).toBe("2026-10-28");
    expect(artists!.closeDate).toBe("2026-10-30");
    expect(communities!.status).toBe("open");
    expect(artists!.status).toBe("open");
    // The role words are the agency's own h3 headings, and they are what tells
    // the two rows apart — neither row is titled with the section heading.
    expect(communities!.raw.applicantRole).toBe("Communities");
    expect(artists!.raw.applicantRole).toBe("Artists");
    expect(communities!.title).toBe("Iowans Create Community Mural Program — Communities");
    expect(artists!.title).toBe("Iowans Create Community Mural Program — Artists");
    for (const row of [communities!, artists!]) {
      expect(row.raw.windowLabel).toBe("Deadline");
      expect(row.url).toBe(
        "https://opportunityiowa.gov/community/arts-culture/grants-programs/iowans-create-community-mural-program",
      );
    }
  });
  test("a lone sub-heading under Application Process never becomes a role", () => {
    // The Fellowship page writes `<h3>Timeline</h3><ul><li>The deadline …`.
    // "Timeline" is a topic, so the record keeps the page's own h1 as its title.
    const fellowship = byId("artist-fellowship-program");
    expect(fellowship!.title).toBe("Iowa Artist Fellowship Program");
    expect(fellowship!.raw.applicantRole).toBeNull();
  });
  test("a programme the agency itself says is not accepting is `closed`, with no date", () => {
    const notAccepting = [
      "cultural-capacity-building-grant",
      "cultural-leadership-partners",
      "greenlight-grant",
      "inspire-iowa",
      "iowa-artist-career-accelerator",
      "iowa-certified-film-festivals-grant",
      "iowa-culture-leadership-cohort",
      "iowa-traditional-arts-apprenticeship-grant",
      "partnership-grant",
    ];
    for (const id of notAccepting) {
      const row = byId(id);
      expect(row).toBeDefined();
      expect(row!.status).toBe("closed");
      expect(row!.closeDate).toBeNull();
      expect(row!.raw.sourceClosedDeclaredBySource).toBe(true);
      expect(String(row!.raw.closedSentence)).toMatch(/not\s+(?:currently\s+|be\s+)?accepting applications/i);
    }
    // The agency's own words are on the page, so no status was inferred.
    expect(FIXTURE_TEXT()).toContain("not currently accepting applications");
    expect(FIXTURE_TEXT()).toContain("will not be accepting applications");
  });
  test("a past published deadline is served `closed`, and a future one `open`", () => {
    expect(byId("artist-fellowship-program")!.closeDate).toBe("2026-04-01");
    expect(byId("iowa-scholarship-arts")!.closeDate).toBe("2026-04-01");
    expect(byId("iowa-scholarship-arts")!.status).toBe("closed");
    expect(byId("iowa-film-rebate-program")!.closeDate).toBe("2026-03-16");
    expect(byId("iowa-film-rebate-program")!.status).toBe("closed");
    // …and the same corpus re-classified after the Mural deadlines pass flips
    // those two rows to closed rather than leaving them open forever.
    const later = IA(new Date("2026-11-05T12:00:00Z"));
    expect(later.filter((o) => o.status === "open").length).toBe(0);
    expect(later.length).toBe(19);
  });
  test("`rolling` only where the agency says so in its own words, with no deadline", () => {
    const rolling = byStatus("rolling");
    expect(rolling.length).toBe(2);
    for (const o of rolling) {
      expect(o.raw.rollingDeclaredBySource).toBe(true);
      expect(String(o.raw.rollingSentence)).toMatch(/rolling basis/i);
      // The "until" day is the end of an open acceptance, never a deadline this
      // connector may expire — so it stays out of `closeDate`.
      expect(o.closeDate).toBeNull();
      expect(o.ongoing).toBe(true);
    }
    const ids = rolling.map((o) => o.externalId).sort();
    expect(ids).toEqual([
      "ia-arts-council-grants-art-project-grant-art-project-grant-organizations-program-guidelines-creative-abundance-special-round",
      "ia-arts-council-grants-artist-professional-development-grant",
    ]);
  });
  test("a grantee's report, a review milestone and a funding PERIOD are never deadlines", () => {
    for (const o of IA()) {
      // None of these days exists on the source as an application deadline.
      expect(o.closeDate).not.toBe("2027-08-02"); // Final Report Deadline
      expect(o.closeDate).not.toBe("2026-04-23"); // Finalist Applicant Interviews
      expect(o.closeDate).not.toBe("2026-05-12"); // Award Notification
      expect(o.closeDate).not.toBe("2027-06-30"); // Eligible Funding Period
      expect(o.closeDate).not.toBe("2026-06-30"); // funding period / fund availability
      expect(o.closeDate).not.toBe("2026-08-01"); // Final reports are due by
    }
    // The refusals are recorded verbatim for a reviewer instead of being dropped.
    const refused = IA().flatMap((o) => (o.raw.refusedDates as string[]) ?? []);
    expect(refused.join(" | ")).toContain("Final Report Deadline: August 2, 2027");
    expect(refused.join(" | ")).toContain("Finalist Applicant Interviews: April 23, 2026");
    expect(refused.join(" | ")).toContain("Award Notification: May 12, 2026");
    expect(refused.join(" | ")).toContain("Eligible Funding Period: June 30, 2027");
    expect(refused.join(" | ")).toContain("funding period → October 1, 2025");
    expect(refused.join(" | ")).toContain("Final reports → August 1, 2026");
    for (const o of IA()) expect(o.raw.refusedDatesNeverCloseDates).toBe(true);
  });
  test("the Scholarship page's duplicated deadline is ONE record, not two", () => {
    const scholarship = IA().filter((o) => o.externalId.endsWith("iowa-scholarship-arts"));
    expect(scholarship.length).toBe(1);
    // Its Timeline labels the deadline, and the sentence below repeats it.
    expect(FIXTURE_TEXT()).toContain("Fiscal Year 2025 Application Deadline");
    expect(scholarship[0]!.closeDate).toBe("2026-04-01");
  });
  test("every title is the agency's own page heading, verbatim on its own page", () => {
    const text = FIXTURE_TEXT().replace(/\s+/g, " ");
    for (const o of IA()) {
      const key = o.title.replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ");
      expect(text).toContain(key);
      expect(o.raw.readOnlyFromThisProgrammesOwnPage).toBe(true);
      expect(o.raw.programmePageUrl).toBe(o.url);
      expect(o.agency).toBe("Iowa Economic Development Authority");
    }
    // The publishing body names itself on the pages (agency is not inferred).
    expect(text).toContain("Iowa Economic Development Authority");
  });
  test("no record's title or reason carries an internal heading mark", () => {
    for (const o of IA()) {
      expect(o.title).not.toMatch(/[\u0001-\u0004]/);
      expect(String(o.raw.windowLabel ?? "")).not.toMatch(/[\u0001-\u0004]/);
      for (const r of (o.raw.refusedDates as string[]) ?? []) expect(r).not.toMatch(/[\u0001-\u0004]/);
    }
  });
  test("parsing the same payload twice is identical (no churn on re-run)", () => {
    const first = IA();
    const second = IA();
    expect(second.map((o) => o.externalId)).toEqual(first.map((o) => o.externalId));
    expect(second.map((o) => o.fingerprint)).toEqual(first.map((o) => o.fingerprint));
  });
  test("a payload that is not this source fails the gate loudly", () => {
    for (const junk of ["<html><body>nope</body></html>", ""]) {
      let thrown: unknown = null;
      try {
        iowaConnector.parse(junk);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).not.toBeNull();
      expect((thrown as { stage?: string }).stage).toBe("parse");
    }
  });
  test("the fetch gate is bound to this source's own listing and child markers", () => {
    expect(PAYLOAD()).toContain(IOWA_INDEX_MARKER);
    expect(PAYLOAD()).toContain(IOWA_CHILD_MARKER);
    // The listing's marker is the catalogue's own results block: it appears on
    // the listing and on none of the programme pages.
    expect(fixture(INDEX_FILE)).toContain(IOWA_INDEX_MARKER);
    for (const path of IOWA_PROGRAMME_PATHS) {
      expect(fixture(fileFor(path))).not.toContain(IOWA_INDEX_MARKER);
      expect(fixture(fileFor(path))).toContain(IOWA_CHILD_MARKER);
    }
  });
});
