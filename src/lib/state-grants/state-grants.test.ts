/**
 * Contrax Grants — State Grants unit tests (owner ROLLOUT order 2026-09-18;
 * corrected by the owner's 2026-09-19 P1 review / R1).
 *
 * No database, no network: everything here is the pure half of the rollout — the
 * connector contract, the Virginia parser, the honesty classifier and the owner's
 * ordered status model, dedupe/identity, the sources registry and the fail-closed
 * state registry.
 *
 * The live-source gate lives in virginia.source-validation.test.ts and the
 * database behaviour (identity, last_seen, the stale flip) in
 * state-grants.integration.test.ts.
 */
import { describe, expect, test } from "bun:test";
import {
  ANNOUNCED_CYCLE_STATUS,
  NOT_SPECIFIED,
  STATE_GRANT_STATUSES,
  classifyStateGrant,
  contentFingerprint,
  dedupeByExternalId,
  isEstimatedText,
  parseGrantOpportunities,
  parseStateDay,
  slugify,
  stateDayEpoch,
  stripEstimateMarkers,
  toOpportunity,
  type SourceGrantRecord,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";
import {
  VIRGINIA_AGENCY,
  VIRGINIA_CONNECTOR_ID,
  VIRGINIA_SOURCE_NAME,
  VIRGINIA_SOURCE_URL,
  awardAmounts,
  classifyVirginiaRecord,
  dollarAmounts,
  externalIdFor,
  extractFacts,
  officialUrl,
  parseVirginiaGrantsPage,
  stripTags,
  virginiaConnector,
} from "~/lib/state-grants/connectors/virginia";
import {
  APPROVED_SOURCE_HOSTS,
  CONNECTED_MIN_SOURCES,
  STATE_CODES,
  STATE_NAMES,
  coverageCounts,
  deriveStateRegistry,
  getConnector,
  getStateEntry,
  getStateStatus,
  isStateConnected,
  isStateValidated,
  listStates,
  validatedStates,
} from "~/lib/state-grants/registry";
import {
  STATE_GRANT_SOURCES,
  getStateSource,
  listStateSources,
  sourcesForState,
} from "~/lib/state-grants/sources";

// ── A realistic Virginia-shaped page (the shapes verified live 2026-09-19) ────
//
// Deliberately includes the awkward cases the real page has: labels sharing one
// line, a curly apostrophe, curvy punctuation, an entity-encoded ampersand, a
// program with no dates at all, a program with no description, a link off the
// official host, and a stray paragraph that is not a program.
const VA_FIXTURE = `<!doctype html><html><head><title>Grants and Funding — VTC</title></head>
<body><nav><ul><li><a href="https://www.vatc.org/other/">Navigation item</a></li></ul></nav>
<article><div class="entry-content">
<p class="wp-block-paragraph">Virginia Tourism Corporation (VTC) offers several funding programs to support Virginia&rsquo;s tourism industry.</p>
<p class="has-text-align-center wp-block-paragraph">&raquo; <em>click map for larger view</em> &laquo;</p>
<h2 class="wp-block-heading"><strong>Virginia Tourism Corporation Grant Programs</strong></h2>
<p class="wp-block-paragraph"><a href="https://vatc.org/grants/leverageprogram/" target="_blank"><strong>(VTC) Marketing Leverage Program</strong></a></p>
<ul class="wp-block-list">
<li>Reimbursable grant program to leverage existing marketing funds &amp; drive tourism to Virginia</li>
<li><strong>Who is eligible:&nbsp;</strong>Virginia travel industry partners including small businesses</li>
<li><strong>Opened:</strong> February 10, 2026.  <strong>Closed:</strong> March 19, 2026</li>
<li><strong>Award Tiers:</strong></li>
<li><strong>Tier One:</strong>&nbsp;1:1 minimum cash match for award of up to $20,000</li>
<li><strong>How:&nbsp;</strong>Online application portal</li>
<li>For information and questions, please email&nbsp;<a href="mailto:vtcgrants@virginia.org">vtcgrants@virginia.org</a></li>
</ul>
<hr class="wp-block-separator"/>
<p class="wp-block-paragraph"><strong><strong><a href="https://vatc.org/grants/mmlp/" target="_blank">(VTC) MMLP Grant Program</a></strong></strong></p>
<ul class="wp-block-list">
<li><strong>Marketing Focus:&nbsp;</strong>Small business and shoulder season marketing</li>
<li><strong>Who is eligible:&nbsp;</strong>Small tourism-related business with 20 or fewer employees</li>
<li><strong>Opened: </strong>June 23, 2026 <strong>Closed: </strong>July 30, 2026</li>
<li><strong>Max Award:</strong>&nbsp;<strong>$5,000</strong></li>
<li><strong>Match:</strong> 1:1 cash or in-kind</li>
</ul>
<hr class="wp-block-separator"/>
<p class="wp-block-paragraph"><a href="https://vatc.org/grants/virginia-special-events-festivals-program/" target="_blank"><u><strong>Virginia Special Events and Festivals Program</strong></u></a></p>
<ul class="wp-block-list">
<li><strong>Who is eligible:&nbsp;</strong>Virginia based special events and festivals</li>
<li><strong>Opens:</strong> September 22, 2026 <strong>Closes: </strong>October 29, 2026</li>
<li><strong>How:&nbsp;</strong>Online application portal</li>
</ul>
<hr class="wp-block-separator"/>
<p class="wp-block-paragraph"><a href="https://vatc.org/drivetourism/" target="_blank"><strong>Development Initiative Coming Soon!</strong></a></p>
<ul class="wp-block-list">
<li><strong>Contact:</strong>&nbsp;Caitlin Johnson&nbsp;<a href="mailto:ccjohnson@virginia.org">ccjohnson@virginia.org</a></li>
</ul>
<hr class="wp-block-separator"/>
<p class="wp-block-paragraph"><a href="https://vatc.org/tdfp/" target="_blank"><strong>Tourism Development Financing Program (TDFP)</strong></a></p>
<ul class="wp-block-list">
<li><strong>What&rsquo;s available:&nbsp;</strong>Gap financing towards the capital investment of new tourism product development</li>
<li><strong>Who is eligible:&nbsp;</strong>Economic Development Organizations</li>
<li><strong>When:</strong>&nbsp;Year-round; no time limitations</li>
<li>Please contact Wirt Confroy at&nbsp;<a href="mailto:wconfroy@virginia.org">wconfroy@virginia.org</a></li>
</ul>
<hr class="wp-block-separator"/>
<p class="wp-block-paragraph"><a href="https://example.com/not-official/" target="_blank"><strong>Off-Site Program</strong></a></p>
<ul class="wp-block-list">
<li><strong>Opened:</strong> January 2, 2026 <strong>Closes:</strong> December 31, 2026</li>
</ul>
</div></article><footer class="site-footer"><p>Footer</p></footer></html>`;

/**
 * The estimate / normalization shapes: a program whose ONLY date is an estimate
 * (owner's rule: unverified), and one that publishes the normalized fields.
 */
const ESTIMATE_FIXTURE = `<html><body><article><div class="entry-content">
<p class="wp-block-paragraph"><a href="https://vatc.org/grants/estimated-only/"><strong>Estimated Only Program</strong></a></p>
<ul class="wp-block-list">
<li><strong>Who is eligible:</strong> Virginia nonprofits</li>
<li><strong>Closes (estimated):</strong> est. October 29, 2026</li>
</ul>
<hr class="wp-block-separator"/>
<p class="wp-block-paragraph"><a href="https://vatc.org/grants/announced-cycle/"><strong>Announced Cycle Program</strong></a></p>
<ul class="wp-block-list">
<li><strong>Opens:</strong> October 1, 2026 <strong>Closes:</strong> November 30, 2026</li>
<li><strong>Eligible geography:</strong> Virginia localities west of the Blue Ridge</li>
<li><strong>Eligible applicants:</strong> Virginia localities and their DMOs</li>
<li><strong>Matching requirement:</strong> 1:1 cash</li>
<li><strong>Total funding:</strong> $250,000 across all awards</li>
<li><strong>Category:</strong> Destination marketing</li>
<li><strong>Award amount:</strong> $10,000 to $40,000</li>
</ul>
</div></article></body></html>`;

const FIXTURE_NOW = new Date("2026-09-19T12:00:00Z");

function record(overrides: Partial<SourceGrantRecord> = {}): SourceGrantRecord {
  return {
    sourceKey: VIRGINIA_CONNECTOR_ID,
    stateCode: "VA",
    externalId: "x",
    title: "Test Program",
    agency: VIRGINIA_AGENCY,
    summary: NOT_SPECIFIED,
    url: "https://www.vatc.org/grants/x/",
    sourceUrl: VIRGINIA_SOURCE_URL,
    postedDate: null,
    closeDate: null,
    estimatedCloseDate: null,
    ongoing: false,
    sourceClosed: false,
    sourceUpdatedAt: null,
    eligibleApplicants: NOT_SPECIFIED,
    eligibleGeography: NOT_SPECIFIED,
    categories: [],
    awardRange: NOT_SPECIFIED,
    awardMinAmount: null,
    awardMaxAmount: null,
    totalFunding: NOT_SPECIFIED,
    matchingRequirement: NOT_SPECIFIED,
    raw: {},
    ...overrides,
  };
}

// ── 1. Source date parsing (no guessing, ever) ───────────────────────────────

describe("state date parsing", () => {
  test("accepts the long form the Virginia source uses, plus ISO and US numeric", () => {
    expect(parseStateDay("February 10, 2026")).toBe("2026-02-10");
    expect(parseStateDay("February 10, 2026.")).toBe("2026-02-10");
    expect(parseStateDay("  September 22, 2026 ")).toBe("2026-09-22");
    expect(parseStateDay("Feb 10, 2026")).toBe("2026-02-10");
    expect(parseStateDay("10 February 2026")).toBe("2026-02-10");
    expect(parseStateDay("2026-09-22")).toBe("2026-09-22");
    expect(parseStateDay("09/22/2026")).toBe("2026-09-22");
  });

  test("returns null for anything it cannot be certain about", () => {
    for (const bad of [
      "sometime in 2026",
      "TBD",
      "Summer 2026",
      "2/2026",
      "10/05/26", // two-digit year: ambiguous, never guessed
      "February 30, 2026",
      "2026-13-01",
      "",
      "   ",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(parseStateDay(bad as unknown)).toBeNull();
    }
  });

  test("stateDayEpoch is UTC midnight of the calendar day", () => {
    expect(stateDayEpoch("2026-09-22")).toBe(Date.UTC(2026, 8, 22));
    expect(stateDayEpoch("nonsense")).toBeNull();
  });

  test("slugify is deterministic and drops punctuation", () => {
    expect(slugify("(VTC) MMLP Grant Program!")).toBe("vtc-mmlp-grant-program");
    expect(slugify("A & B / C")).toBe("a-b-c");
  });
});

// ── 2. Estimates are recognised, never invented ──────────────────────────────

describe("estimate markers", () => {
  test("detects the ways a source marks a date as an estimate", () => {
    for (const text of [
      "est. 2026-10-29",
      "Estimated: October 29, 2026",
      "October 29, 2026 (estimated)",
      "approx. October 29, 2026",
      "Tentative closing date",
      "Anticipated close",
      "expected November 2026",
      "Closes (estimated): October 29, 2026",
    ]) {
      expect(isEstimatedText(text)).toBe(true);
    }
  });

  test("does not treat a published date label or value as an estimate", () => {
    for (const text of [
      "October 29, 2026",
      "Opens: September 22, 2026",
      "Closes: October 29, 2026",
      "Closes:",
      "Opened: May 5, 2026",
      "Virginia localities west of the Blue Ridge",
    ]) {
      expect(isEstimatedText(text)).toBe(false);
    }
  });

  test("strips the marker so the underlying date parses exactly", () => {
    expect(stripEstimateMarkers("est. 2026-10-29")).toBe("2026-10-29");
    expect(stripEstimateMarkers("October 29, 2026 (estimated)")).toBe("October 29, 2026");
    expect(parseStateDay(stripEstimateMarkers("est. October 29, 2026"))).toBe("2026-10-29");
  });
});

// ── 3. Parsing a realistic page ──────────────────────────────────────────────

describe("virginia parser", () => {
  const records = parseVirginiaGrantsPage(VA_FIXTURE, FIXTURE_NOW);

  test("finds every program block and nothing else", () => {
    expect(records.length).toBe(6);
    expect(records.map((r) => r.title)).toEqual([
      "(VTC) Marketing Leverage Program",
      "(VTC) MMLP Grant Program",
      "Virginia Special Events and Festivals Program",
      "Development Initiative Coming Soon!",
      "Tourism Development Financing Program (TDFP)",
      "Off-Site Program",
    ]);
  });

  test("records are already normalised and unclassified at this stage", () => {
    for (const r of records) {
      expect(r.stateCode).toBe("VA");
      expect(r.sourceKey).toBe(VIRGINIA_CONNECTOR_ID);
      expect(r.sourceUrl).toBe(VIRGINIA_SOURCE_URL);
      expect("fingerprint" in r).toBe(false); // classification/fingerprint is a later stage
      expect("status" in r).toBe(false);
      expect(r.title.length).toBeGreaterThan(0);
    }
  });

  test("dates, entities and curly apostrophes are read from the source verbatim", () => {
    const mmlp = records.find((r) => r.externalId === "mmlp")!;
    expect(mmlp.postedDate).toBe("2026-06-23");
    expect(mmlp.closeDate).toBe("2026-07-30");
    expect(mmlp.estimatedCloseDate).toBeNull();
    const leverage = records.find((r) => r.externalId === "leverageprogram")!;
    expect(leverage.summary).toBe(
      "Reimbursable grant program to leverage existing marketing funds & drive tourism to Virginia",
    );
    const tdfp = records.find((r) => r.externalId === "tdfp")!;
    // &rsquo; in the label, and the label itself must not leak into the value.
    expect(tdfp.summary).toBe(
      "Gap financing towards the capital investment of new tourism product development",
    );
    expect(tdfp.ongoing).toBe(true);
  });

  test("a missing source value becomes Not specified — never an invented one", () => {
    const dev = records.find((r) => r.externalId === "drivetourism")!;
    expect(dev.summary).toBe(NOT_SPECIFIED);
    expect(dev.postedDate).toBeNull();
    expect(dev.closeDate).toBeNull();
    expect(dev.estimatedCloseDate).toBeNull();
    expect(dev.raw.eligibility).toBe(NOT_SPECIFIED);
    expect(dev.raw.award).toBe(NOT_SPECIFIED);
    // The normalized columns are populated too — with the honesty sentinel.
    expect(dev.eligibleApplicants).toBe(NOT_SPECIFIED);
    expect(dev.eligibleGeography).toBe(NOT_SPECIFIED);
    expect(dev.totalFunding).toBe(NOT_SPECIFIED);
    expect(dev.matchingRequirement).toBe(NOT_SPECIFIED);
    expect(dev.categories).toEqual([]);
  });

  test("external ids come from the source's own page slug", () => {
    expect(externalIdFor("https://www.vatc.org/grants/mmlp/", "whatever")).toBe("mmlp");
    expect(externalIdFor("https://www.vatc.org/vtc-va250-x/", "whatever")).toBe("vtc-va250-x");
    expect(externalIdFor("not a url", "(VTC) MMLP Grant Program")).toBe("vtc-mmlp-grant-program");
  });

  test("a record URL off the official host falls back to the listing page", () => {
    const offSite = records.find((r) => r.title === "Off-Site Program")!;
    expect(offSite.url).toBe(VIRGINIA_SOURCE_URL);
    expect(officialUrl("https://vatc.org/grants/mmlp/")).toBe("https://www.vatc.org/grants/mmlp/");
    expect(officialUrl(null)).toBe(VIRGINIA_SOURCE_URL);
    expect(officialUrl("https://evil.example/x")).toBe(VIRGINIA_SOURCE_URL);
  });

  test("nav links are never parsed as programs", () => {
    expect(records.some((r) => r.title === "Navigation item")).toBe(false);
    expect(records.some((r) => r.title.includes("Footer"))).toBe(false);
  });

  test("malformed markup does not crash the parser", () => {
    const messy = VA_FIXTURE.replace(/<\/li>/g, "")
      .replace(/<strong>/g, "")
      .replace(/&amp;/g, "&")
      .replace("<a href=", "<a  href = ");
    const parsed = parseVirginiaGrantsPage(messy, FIXTURE_NOW);
    expect(parsed.length).toBeGreaterThan(0);
    for (const r of parsed) {
      expect(typeof r.title).toBe("string");
      expect(r.externalId.length).toBeGreaterThan(0);
    }
  });

  test("a payload that is not the VA grants page is rejected, not silently empty", () => {
    expect(() => parseVirginiaGrantsPage("<html><body>hello</body></html>")).toThrow(
      /entry-content/,
    );
    expect(() => parseVirginiaGrantsPage("")).toThrow(/entry-content/);
    const empty = `<div class="entry-content"><p>no programs here</p></div>`;
    expect(() => parseVirginiaGrantsPage(empty)).toThrow(/zero program blocks/);
    expect(() => parseVirginiaGrantsPage(null as unknown as string)).toThrow();
  });

  test("stripTags / extractFacts handle the label-per-line and shared-line shapes", () => {
    expect(stripTags("<strong>Opened:</strong>&nbsp;May 5, 2026")).toBe("Opened: May 5, 2026");
    const shared = extractFacts(
      `<ul><li><strong>Opened:</strong> May 5, 2026 <strong>Closed:</strong> May 28, 2026</li></ul>`,
    );
    expect(shared.values["opened"]).toBe("May 5, 2026");
    expect(shared.values["closed"]).toBe("May 28, 2026");
    // A parenthetical estimate marker is captured, not dropped.
    const estimated = extractFacts(
      `<ul><li><strong>Closes (estimated):</strong> est. October 29, 2026</li></ul>`,
    );
    expect(estimated.values["closes"]).toBe("est. October 29, 2026");
    expect(estimated.estimatedLabels["closes"]).toBe(true);
  });
});

// ── 4. Normalized fields (owner correction 4) ────────────────────────────────

describe("normalized source fields", () => {
  const records = parseVirginiaGrantsPage(VA_FIXTURE, FIXTURE_NOW);
  const byExternalId = (id: string) => records.find((r) => r.externalId === id)!;

  test("eligibility, categories, award range and matching come from the source", () => {
    const mmlp = byExternalId("mmlp");
    expect(mmlp.eligibleApplicants).toBe("Small tourism-related business with 20 or fewer employees");
    expect(mmlp.categories).toEqual(["Small business and shoulder season marketing"]);
    expect(mmlp.awardRange).toBe("$5,000");
    expect(mmlp.awardMaxAmount).toBe(5000);
    expect(mmlp.awardMinAmount).toBeNull();
    expect(mmlp.matchingRequirement).toBe("1:1 cash or in-kind");
  });

  test("award tiers published as their own lines are still captured", () => {
    const leverage = byExternalId("leverageprogram");
    // The block labels "Award Tiers:" and puts the tiers on the following lines.
    expect(leverage.awardRange).toMatch(/Tier One: 1:1 minimum cash match for award of up to \$20,000/);
    expect(leverage.awardMaxAmount).toBe(20000);
    // The match phrase inside the source's own award wording is quoted verbatim.
    expect(leverage.matchingRequirement).toBe("1:1 minimum cash match");
  });

  test("every normalized field is present, and absent means Not specified", () => {
    for (const r of records) {
      for (const value of [
        r.eligibleApplicants,
        r.eligibleGeography,
        r.awardRange,
        r.totalFunding,
        r.matchingRequirement,
      ]) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
      expect(Array.isArray(r.categories)).toBe(true);
      // VA's source publishes no geography field at all — so it says so.
      expect(r.eligibleGeography).toBe(NOT_SPECIFIED);
    }
  });

  test("the ESTIMATE fixture: normalized fields and estimates round-trip", () => {
    const parsed = parseVirginiaGrantsPage(ESTIMATE_FIXTURE, FIXTURE_NOW);
    const estimated = parsed.find((r) => r.externalId === "estimated-only")!;
    expect(estimated.closeDate).toBeNull(); // an estimate is never a close date
    expect(estimated.estimatedCloseDate).toBe("2026-10-29");
    expect(estimated.raw.closingEstimated).toBe(true);

    const announced = parsed.find((r) => r.externalId === "announced-cycle")!;
    expect(announced.postedDate).toBe("2026-10-01");
    expect(announced.closeDate).toBe("2026-11-30");
    expect(announced.estimatedCloseDate).toBeNull();
    expect(announced.eligibleGeography).toBe("Virginia localities west of the Blue Ridge");
    expect(announced.eligibleApplicants).toBe("Virginia localities and their DMOs");
    expect(announced.matchingRequirement).toBe("1:1 cash");
    expect(announced.totalFunding).toBe("$250,000 across all awards");
    expect(announced.categories).toEqual(["Destination marketing"]);
    expect(announced.awardRange).toBe("$10,000 to $40,000");
    expect(announced.awardMinAmount).toBe(10000);
    expect(announced.awardMaxAmount).toBe(40000);
  });

  test("dollar-amount parsing is arithmetic on the source's own text, nothing more", () => {
    expect(dollarAmounts("up to $20,000")).toEqual([20000]);
    expect(dollarAmounts("$10,000 to $40,000")).toEqual([10000, 40000]);
    expect(dollarAmounts("no money here")).toEqual([]);
    expect(awardAmounts("up to $5,000")).toEqual({ min: null, max: 5000 });
    expect(awardAmounts("$10,000 to $40,000")).toEqual({ min: 10000, max: 40000 });
    expect(awardAmounts("no money here")).toEqual({ min: null, max: null });
  });
});

// ── 5. Status classification — the owner's ordered model (2026-09-19) ────────

describe("state status classification", () => {
  const now = FIXTURE_NOW; // 2026-09-19

  test("the model is exactly the owner's five statuses, in order", () => {
    expect(STATE_GRANT_STATUSES).toEqual(["open", "upcoming", "rolling", "closed", "unverified"]);
  });

  test("open: a published closing date that has not passed", () => {
    const c = classifyStateGrant(
      record({ postedDate: "2026-06-23", closeDate: "2026-10-29" }),
      now,
    );
    expect(c.status).toBe("open");
    expect(c.closeDate).toBe("2026-10-29");
    expect(c.estimatedCloseDate).toBeNull();
  });

  test("open: the deadline DAY ITSELF is still open (US Eastern day boundary)", () => {
    // 2026-09-19 is the ET and UTC day here; a 09/19/2026 deadline has not passed.
    expect(classifyStateGrant(record({ postedDate: "2026-01-01", closeDate: "2026-09-19" }), now).status).toBe(
      "open",
    );
    // ... but the previous day has.
    expect(classifyStateGrant(record({ postedDate: "2026-01-01", closeDate: "2026-09-18" }), now).status).toBe(
      "closed",
    );
  });

  test("open: a future published deadline with no opening date and no closed marker", () => {
    // A published closing date that has not passed IS the source confirming there
    // is something to apply for until that date.
    const c = classifyStateGrant(record({ closeDate: "2026-12-31" }), now);
    expect(c.status).toBe("open");
    expect(c.closeDate).toBe("2026-12-31");
  });

  test("rolling: only when the source itself declares the program ongoing", () => {
    const c = classifyStateGrant(record({ ongoing: true }), now);
    expect(c.status).toBe("rolling");
    expect(c.closeDate).toBeNull();
    expect(c.estimatedCloseDate).toBeNull();
    expect(c.reason).toMatch(/ongoing/);
    // An ongoing declaration wins even when the source also printed dates: a
    // program with no deadline cannot be "closed" by a stray date either.
    expect(classifyStateGrant(record({ ongoing: true, closeDate: "2020-01-01" }), now).status).toBe(
      "rolling",
    );
  });

  test("upcoming: a published cycle whose opening date has not arrived", () => {
    const c = classifyStateGrant(
      record({ postedDate: "2026-10-01", closeDate: "2026-11-30" }),
      now,
    );
    expect(c.status).toBe("upcoming");
    // Both dates are PUBLISHED by the source, so they stay published columns —
    // and the estimate column stays empty.
    expect(c.closeDate).toBe("2026-11-30");
    expect(c.estimatedCloseDate).toBeNull();
    expect(c.reason).toMatch(/not arrived/);
  });

  test("the announced-cycle policy is one explicit constant, pinned here", () => {
    // The owner's review note called Virginia's Special Events cycle "est. only";
    // the live page publishes its dates with no estimate marker, and the owner's
    // own definition of `upcoming` is "announced not-yet-open cycle (published,
    // non-estimated dates)" — so `upcoming` is the faithful classification. If
    // that reading is ever reversed, flip ANNOUNCED_CYCLE_STATUS and this test
    // goes red on purpose, forcing the docs and the validator to be updated too.
    expect(ANNOUNCED_CYCLE_STATUS).toBe("upcoming");
    const specialEvents = classifyStateGrant(
      record({ postedDate: "2026-09-22", closeDate: "2026-10-29" }),
      now,
    );
    expect(specialEvents.status).toBe("upcoming");
    expect(specialEvents.closeDate).toBe("2026-10-29");
    expect(specialEvents.estimatedCloseDate).toBeNull();
  });

  test("closed: a past deadline, and a source-declared closed cycle", () => {
    const past = classifyStateGrant(
      record({ postedDate: "2026-02-10", closeDate: "2026-03-19" }),
      now,
    );
    expect(past.status).toBe("closed");
    expect(past.closeDate).toBe("2026-03-19");
    const declared = classifyStateGrant(
      record({ postedDate: "2026-08-01", closeDate: "2026-12-01", sourceClosed: true }),
      now,
    );
    // The source's own past-tense "Closed" label wins over a future-looking date.
    expect(declared.status).toBe("closed");
    expect(declared.reason).toMatch(/marks this cycle closed/);
  });

  test("unverified: no usable dates at all — never open, never a forecast", () => {
    const c = classifyStateGrant(record({}), now);
    expect(c.status).toBe("unverified");
    expect(c.closeDate).toBeNull();
    expect(c.reason).toMatch(/no usable dates/);
  });

  test("unverified: an opening date with no closing date is NOT promoted to rolling", () => {
    // Only the SOURCE may declare a program rolling. An opening date alone is
    // not a declaration, and we will not claim continuous acceptance on our own.
    const c = classifyStateGrant(record({ postedDate: "2026-06-23" }), now);
    expect(c.status).toBe("unverified");
    expect(c.reason).toMatch(/opening date but no closing date/);
  });

  test("unverified: an ambiguous date is never turned into a cycle", () => {
    for (const closeDate of ["TBD", "TBA", "Fall 2026", "rolling basis"]) {
      const c = classifyStateGrant(record({ postedDate: "2026-09-01", closeDate }), now);
      expect(c.status).toBe("unverified");
      expect(c.closeDate).toBeNull();
    }
    // ...and `forecast` no longer exists as a status at all.
    expect(STATE_GRANT_STATUSES).not.toContain("forecast" as never);
  });

  test("unverified: an ESTIMATE-only record keeps the estimate, labelled as one", () => {
    const c = classifyStateGrant(record({ estimatedCloseDate: "2026-10-29" }), now);
    expect(c.status).toBe("unverified");
    expect(c.closeDate).toBeNull();
    expect(c.estimatedCloseDate).toBe("2026-10-29");
    expect(c.reason).toMatch(/ESTIMATED/);
  });

  test("an estimate never coexists with a published close date", () => {
    // One date slot: a published close date wins the deadline, and the estimate
    // is not stored alongside it (it stays in the raw payload).
    for (const [closeDate, status] of [
      ["2026-11-30", "open"],
      ["2026-03-19", "closed"],
    ] as const) {
      const c = classifyStateGrant(record({ closeDate, estimatedCloseDate: "2026-10-29" }), now);
      expect(c.status).toBe(status);
      expect(c.closeDate).toBe(closeDate);
      expect(c.estimatedCloseDate).toBeNull();
    }
  });

  test("every decision carries a reason a reviewer can re-derive", () => {
    for (const r of [
      record({ closeDate: "2026-12-01" }),
      record({ postedDate: "2026-12-01", closeDate: "2026-12-31" }),
      record({ closeDate: "2020-01-01" }),
      record({}),
      record({ ongoing: true }),
      record({ postedDate: "2026-01-01" }),
      record({ estimatedCloseDate: "2026-10-29" }),
    ]) {
      expect(classifyStateGrant(r, now).reason.length).toBeGreaterThan(10);
    }
  });

  test("the Virginia connector uses the shared classifier unchanged", () => {
    const r = record({ postedDate: "2026-10-01", closeDate: "2026-11-30" });
    expect(classifyVirginiaRecord(r, now)).toEqual(classifyStateGrant(r, now));
  });

  test("the fixture's records classify into the owner's model end to end", () => {
    const { opportunities } = parseGrantOpportunities(virginiaConnector, VA_FIXTURE, now);
    const byId = new Map(opportunities.map((o) => [o.externalId, o]));
    // past deadlines (the owner's "past-deadline → closed")
    expect(byId.get("leverageprogram")!.status).toBe("closed");
    expect(byId.get("mmlp")!.status).toBe("closed");
    // an announced cycle with published dates → upcoming
    expect(byId.get("virginia-special-events-festivals-program")!.status).toBe("upcoming");
    expect(byId.get("virginia-special-events-festivals-program")!.closeDate).toBe("2026-10-29");
    expect(byId.get("virginia-special-events-festivals-program")!.estimatedCloseDate).toBeNull();
    // "Development Initiative Coming Soon!" (no dates) → unverified
    expect(byId.get("drivetourism")!.status).toBe("unverified");
    // "Year-round; no time limitations" → rolling (the owner's reclassification)
    expect(byId.get("tdfp")!.status).toBe("rolling");
    // a live published deadline → open
    const offSite = opportunities.find((o) => o.title === "Off-Site Program")!;
    expect(offSite.status).toBe("open");
    expect(offSite.closeDate).toBe("2026-12-31");
    expect(offSite.url).toBe(VIRGINIA_SOURCE_URL); // off-host link falls back
    // every status is one of the five, and no unverified row claims a deadline
    for (const o of opportunities) {
      expect(STATE_GRANT_STATUSES).toContain(o.status);
      if (o.status === "unverified" || o.status === "rolling") expect(o.closeDate).toBeNull();
    }
  });
});

// ── 6. Dedupe, identity, fingerprints, amendments ────────────────────────────

describe("identity, dedupe and change detection", () => {
  test("the same external_id twice from ONE source yields one record + a collision", () => {
    const dup = dedupeByExternalId([
      record({ externalId: "same", title: "First" }),
      record({ externalId: "same", title: "Second" }),
      record({ externalId: "other", title: "Other" }),
    ]);
    expect(dup.records.length).toBe(2);
    expect(dup.records.map((r) => r.title)).toEqual(["First", "Other"]);
    expect(dup.collisions).toEqual(["va-vtc-grants:same"]);
  });

  test("the SAME external id from TWO sources is two records — never an overwrite", () => {
    // Owner correction 1: two agencies in one state routinely reuse short program
    // ids. Identity is (source, external_id), so neither may displace the other.
    const two = dedupeByExternalId([
      record({ sourceKey: "va-vtc-grants", externalId: "winter", title: "Tourism Winter Fund" }),
      record({ sourceKey: "va-dhcd-grants", externalId: "winter", title: "Housing Winter Fund" }),
    ]);
    expect(two.records.length).toBe(2);
    expect(two.collisions).toEqual([]);
    expect(two.records.map((r) => r.title)).toEqual(["Tourism Winter Fund", "Housing Winter Fund"]);
  });

  test("the same external id in a different state is still its own record", () => {
    const dup = dedupeByExternalId([
      record({ sourceKey: "va-x", stateCode: "VA", externalId: "same" }),
      record({ sourceKey: "md-x", stateCode: "MD", externalId: "same" }),
    ]);
    expect(dup.records.length).toBe(2);
    expect(dup.collisions).toEqual([]);
  });

  test("fingerprints are stable for identical content and change with the content", () => {
    const a = toOpportunity(record({ title: "Same", closeDate: "2026-12-31" }));
    const b = toOpportunity(record({ title: "Same", closeDate: "2026-12-31" }));
    const moved = toOpportunity(record({ title: "Same", closeDate: "2027-01-15" }));
    const retitled = toOpportunity(record({ title: "Renamed", closeDate: "2026-12-31" }));
    const touched = toOpportunity(
      record({ title: "Same", closeDate: "2026-12-31", sourceUpdatedAt: "2026-09-19T00:00:00Z" }),
    );
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(moved.fingerprint);
    expect(a.fingerprint).not.toBe(retitled.fingerprint);
    // A source_updated_at change alone is an amendment signal too.
    expect(a.fingerprint).not.toBe(touched.fingerprint);
    expect(touched.fingerprint).toBe(
      toOpportunity(
        record({
          title: "Same",
          closeDate: "2026-12-31",
          sourceUpdatedAt: "2026-09-19T00:00:00Z",
        }),
      ).fingerprint,
    );
  });

  test("a normalized-field change is an amendment; the identity does not move", () => {
    const before = toOpportunity(record({ externalId: "mmlp", eligibleApplicants: "old wording" }));
    const after = toOpportunity(record({ externalId: "mmlp", eligibleApplicants: "new wording" }));
    expect(after.externalId).toBe(before.externalId);
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  test("fingerprints are key-order independent and 32 hex chars", () => {
    const one = contentFingerprint({ a: 1, b: [2, { c: 3 }] });
    const two = contentFingerprint({ b: [2, { c: 3 }], a: 1 });
    expect(one).toBe(two);
    expect(one).toMatch(/^[0-9a-f]{32}$/);
  });

  test("parseGrantOpportunities stamps the SOURCE from the connector, not the payload", () => {
    const imposter: StateGrantConnector<string> = {
      ...virginiaConnector,
      id: "va-other-source",
      sourceName: "Another Virginia source",
    };
    const { opportunities } = parseGrantOpportunities(imposter, VA_FIXTURE, FIXTURE_NOW);
    expect(opportunities.length).toBeGreaterThan(0);
    for (const o of opportunities) {
      expect(o.sourceKey).toBe("va-other-source");
      expect(o.raw.labels).toBeDefined();
    }
  });
});

// ── 7. The sources registry (owner correction 1) ─────────────────────────────

describe("sources registry", () => {
  test("the code-level sources are derived from connectors and agree with them", () => {
    expect(STATE_GRANT_SOURCES.length).toBeGreaterThanOrEqual(1);
    const va = getStateSource(VIRGINIA_CONNECTOR_ID)!;
    expect(va).toBeDefined();
    expect(va.stateCode).toBe("VA");
    expect(va.name).toBe(VIRGINIA_SOURCE_NAME);
    expect(va.agency).toBe(VIRGINIA_AGENCY);
    expect(va.officialUrl).toBe(VIRGINIA_SOURCE_URL);
    expect(va.officialHost).toBe("www.vatc.org");
    expect(APPROVED_SOURCE_HOSTS).toContain(va.officialHost);
    // One source per connector, on an approved host, with a non-empty key.
    for (const source of listStateSources()) {
      expect(source.sourceKey.length).toBeGreaterThan(0);
      expect(validatedStates()).toContain(source.stateCode);
      expect(source.name.length).toBeGreaterThan(0);
      expect(source.agency.length).toBeGreaterThan(0);
      expect(APPROVED_SOURCE_HOSTS).toContain(source.officialHost);
      expect(source.officialUrl.startsWith("https://")).toBe(true);
    }
  });

  test("a state can hold several sources, and unknown keys resolve to null", () => {
    expect(sourcesForState("VA").map((s) => s.sourceKey)).toEqual([VIRGINIA_CONNECTOR_ID]);
    expect(sourcesForState("va")).toHaveLength(1); // case-insensitive
    expect(sourcesForState("MD")).toEqual([]);
    expect(getStateSource("nope")).toBeNull();
  });
});

// ── 8. The registry — fail-closed, with the owner's coverage ladder ──────────

describe("state registry", () => {
  const fakeConnector = (stateCode: string, host = "example.gov"): StateGrantConnector<never> =>
    ({
      id: `fake-${stateCode.toLowerCase()}`,
      stateCode,
      stateName: stateCode,
      sourceName: `${stateCode} source`,
      agency: `${stateCode} agency`,
      sourceUrl: `https://${host}/grants`,
      officialHost: host,
      sourceValidationTest: "some/test.ts",
      async fetch() {
        return "" as never;
      },
      parse() {
        return [];
      },
      classify(r) {
        return classifyStateGrant(r);
      },
    }) as unknown as StateGrantConnector<never>;

  const entry = (tier: "limited" | "curated" | "connected", overrides = {}) => ({
    connectorId: "fake-va",
    sourceUrl: "https://example.gov/grants",
    testFile: "t",
    verifiedOn: "x",
    tier,
    note: null as string | null,
    ...overrides,
  });

  test("every state and DC is present exactly once, with a real name", () => {
    const states = listStates();
    expect(states.length).toBe(51);
    expect(new Set(states.map((s) => s.stateCode)).size).toBe(51);
    expect(STATE_CODES.length).toBe(51);
    expect(states.map((s) => s.stateCode).sort()).toEqual([...STATE_CODES].sort());
    for (const s of states) expect(s.name).toBe(STATE_NAMES[s.stateCode]);
  });

  test("Virginia is LIMITED — one tourism source is not a statewide view", () => {
    const va = getStateEntry("VA")!;
    expect(va.status).toBe("limited");
    expect(va.connectorId).toBe(VIRGINIA_CONNECTOR_ID);
    expect(va.sourceUrl).toBe(VIRGINIA_SOURCE_URL);
    expect(va.sourceValidationTest).toMatch(/virginia\.source-validation\.test\.ts$/);
    expect(va.sourceCount).toBe(1);
    expect(va.note).toMatch(/not statewide coverage/);
    expect(va.reason).toMatch(/verified against/);
    expect(isStateValidated("va")).toBe(true); // case-insensitive lookup
    expect(isStateConnected("VA")).toBe(false); // limited is NOT the top tier
    // A limited state IS syncable — that is the owner's correction to part 1.
    expect(getConnector("VA")?.id).toBe(VIRGINIA_CONNECTOR_ID);
    expect(validatedStates()).toEqual(["AL", "AZ", "AR", "CA", "CO", "DE", "DC", "HI", "IL", "IN", "KS", "KY", "ME", "MN", "MT", "NV", "NH", "NM", "ND", "OK", "PA", "RI", "SC", "TN", "UT", "VA", "WA", "WV"]);
  });

  test("every other state is unavailable — the registry is NOT coverage", () => {
    const others = listStates().filter((s) => !validatedStates().includes(s.stateCode));
    expect(others.length).toBe(23);
    for (const s of others) {
      expect(s.status).toBe("unavailable");
      expect(s.connectorId).toBeNull();
      expect(s.reason).toMatch(/no connector registered/);
      expect(getConnector(s.stateCode)).toBeNull();
    }
    expect(coverageCounts()).toEqual({
      total: 51,
      connected: 0,
      curated: 0,
      limited: 28,
      unavailable: 23,
      validated: 28,
    });
  });

  test("a connector WITHOUT a source-validation test can never be validated", () => {
    const registry = deriveStateRegistry({
      connectors: { VA: fakeConnector("VA") },
      validations: {},
      approvedHosts: ["example.gov"],
      states: ["VA"],
      names: { VA: "Virginia" },
    });
    expect(registry[0].status).toBe("unavailable");
    expect(registry[0].reason).toMatch(/no source-validation test/);
  });

  test("a manifest that disagrees with the connector can never be validated", () => {
    const wrongId = deriveStateRegistry({
      connectors: { VA: fakeConnector("VA") },
      validations: { VA: entry("limited", { connectorId: "other" }) },
      approvedHosts: ["example.gov"],
      states: ["VA"],
      names: { VA: "Virginia" },
    });
    expect(wrongId[0].status).toBe("unavailable");
    expect(wrongId[0].reason).toMatch(/disagrees with the connector/);

    const wrongUrl = deriveStateRegistry({
      connectors: { VA: fakeConnector("VA") },
      validations: { VA: entry("limited", { sourceUrl: "https://example.gov/other" }) },
      approvedHosts: ["example.gov"],
      states: ["VA"],
      names: { VA: "Virginia" },
    });
    expect(wrongUrl[0].status).toBe("unavailable");
    expect(wrongUrl[0].reason).toMatch(/disagrees with the connector/);
  });

  test("a host that is not on the approved allowlist can never be validated", () => {
    const registry = deriveStateRegistry({
      connectors: { VA: fakeConnector("VA", "not-approved.example") },
      validations: {
        VA: entry("limited", {
          connectorId: "fake-va",
          sourceUrl: "https://not-approved.example/grants",
        }),
      },
      approvedHosts: ["example.gov"],
      states: ["VA"],
      names: { VA: "Virginia" },
    });
    expect(registry[0].status).toBe("unavailable");
    expect(registry[0].reason).toMatch(/not on the approved-source allowlist/);
  });

  test("a manifest with no valid tier is fail-closed, not permissive", () => {
    const registry = deriveStateRegistry({
      connectors: { VA: fakeConnector("VA") },
      validations: {
        VA: { ...entry("limited"), tier: "whatever" as unknown as "limited" },
      },
      approvedHosts: ["example.gov"],
      states: ["VA"],
      names: { VA: "Virginia" },
    });
    expect(registry[0].status).toBe("unavailable");
    expect(registry[0].reason).toMatch(/no valid coverage tier/);
  });

  test("the ladder: limited and curated pass through with the full gate", () => {
    for (const tier of ["limited", "curated"] as const) {
      const registry = deriveStateRegistry({
        connectors: { VA: fakeConnector("VA") },
        validations: { VA: entry(tier) },
        approvedHosts: ["example.gov"],
        states: ["VA"],
        names: { VA: "Virginia" },
        sourcesByState: { VA: ["fake-va"] },
      });
      expect(registry[0].status).toBe(tier);
      expect(registry[0].sourceCount).toBe(1);
    }
  });

  test("connected requires MULTI-SOURCE coverage — a single source is downgraded", () => {
    const oneSource = deriveStateRegistry({
      connectors: { VA: fakeConnector("VA") },
      validations: { VA: entry("connected") },
      approvedHosts: ["example.gov"],
      states: ["VA"],
      names: { VA: "Virginia" },
      sourcesByState: { VA: ["fake-va"] },
    });
    expect(oneSource[0].status).toBe("limited");
    expect(oneSource[0].reason).toMatch(
      new RegExp(`requires at least ${CONNECTED_MIN_SOURCES}`),
    );

    const twoSources = deriveStateRegistry({
      connectors: { VA: fakeConnector("VA") },
      validations: { VA: entry("connected") },
      approvedHosts: ["example.gov"],
      states: ["VA"],
      names: { VA: "Virginia" },
      sourcesByState: { VA: ["fake-va", "va-other"] },
    });
    expect(twoSources[0].status).toBe("connected");
    expect(twoSources[0].sourceCount).toBe(2);
  });

  test("unknown state codes are unavailable and have no connector", () => {
    for (const code of ["ZZ", "", "  ", "Virginia", "va-", "12"]) {
      expect(getStateStatus(code)).toBe("unavailable");
      expect(getConnector(code)).toBeNull();
      expect(isStateValidated(code)).toBe(false);
    }
    expect(getStateEntry("ZZ")).toBeNull();
  });

  test("status is DERIVED on every read, never cached from a stored value", () => {
    // Two reads of the same state must be equal AND re-derived; nothing here
    // accepts a status as an input.
    expect(listStates()).toEqual(listStates());
    expect(getStateStatus("VA")).toBe(listStates().find((s) => s.stateCode === "VA")!.status);
  });
});
