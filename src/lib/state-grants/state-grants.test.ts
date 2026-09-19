/**
 * Contrax Grants — State Grants, PART 1 unit tests (owner ROLLOUT order
 * 2026-09-18). No database, no network: everything here is the pure half of the
 * rollout — the connector contract, the Virginia parser, the honesty classifier,
 * dedupe/amendments, and the fail-closed state registry.
 *
 * The live-source gate lives in virginia.source-validation.test.ts and the
 * database behaviour in state-grants.integration.test.ts.
 */
import { describe, expect, test } from "bun:test";
import {
  NOT_SPECIFIED,
  classifyStateGrant,
  contentFingerprint,
  dedupeByExternalId,
  parseGrantOpportunities,
  parseStateDay,
  slugify,
  stateDayEpoch,
  toOpportunity,
  type SourceGrantRecord,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";
import {
  VIRGINIA_AGENCY,
  VIRGINIA_SOURCE_URL,
  classifyVirginiaRecord,
  externalIdFor,
  extractFacts,
  officialUrl,
  parseVirginiaGrantsPage,
  stripTags,
  virginiaConnector,
} from "~/lib/state-grants/connectors/virginia";
import {
  STATE_CODES,
  STATE_NAMES,
  coverageCounts,
  deriveStateRegistry,
  getConnector,
  getStateEntry,
  getStateStatus,
  isStateConnected,
  listStates,
} from "~/lib/state-grants/registry";

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

const FIXTURE_NOW = new Date("2026-09-19T12:00:00Z");

function record(overrides: Partial<SourceGrantRecord> = {}): SourceGrantRecord {
  return {
    stateCode: "VA",
    externalId: "x",
    title: "Test Program",
    agency: VIRGINIA_AGENCY,
    summary: NOT_SPECIFIED,
    url: "https://www.vatc.org/grants/x/",
    sourceUrl: VIRGINIA_SOURCE_URL,
    postedDate: null,
    closeDate: null,
    ongoing: false,
    sourceClosed: false,
    sourceUpdatedAt: null,
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

// ── 2. Parsing a realistic page ──────────────────────────────────────────────

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
    expect(dev.raw.eligibility).toBe(NOT_SPECIFIED);
    expect(dev.raw.award).toBe(NOT_SPECIFIED);
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
  });
});

// ── 3. Status classification (the #399 honesty rules, state side) ────────────

describe("state status classification", () => {
  const now = FIXTURE_NOW; // 2026-09-19

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

  test("open: only when the source itself declares the program ongoing", () => {
    const c = classifyStateGrant(record({ ongoing: true }), now);
    expect(c.status).toBe("open");
    expect(c.closeDate).toBeNull();
    expect(c.reason).toMatch(/ongoing/);
  });

  test("open: a future published deadline with no opening date and no closed marker", () => {
    // RULE (documented in CONVENTIONS.md): a published closing date that has not
    // passed IS the source confirming there is something to apply for until that
    // date, and the source did not mark the cycle closed. Only a FUTURE OPENING
    // date — the source saying "this cycle starts later" — demotes it to forecast.
    const c = classifyStateGrant(record({ closeDate: "2026-12-31" }), now);
    expect(c.status).toBe("open");
    expect(c.closeDate).toBe("2026-12-31");
  });

  test("open: an opening date in the PAST does not demote a live deadline", () => {
    const c = classifyStateGrant(
      record({ postedDate: "2026-06-23", closeDate: "2026-12-31" }),
      now,
    );
    expect(c.status).toBe("open");
  });

  test("forecast: the source announces a cycle that has not opened yet", () => {
    const c = classifyStateGrant(
      record({ postedDate: "2026-09-22", closeDate: "2026-10-29" }),
      now,
    );
    expect(c.status).toBe("forecast");
    expect(c.closeDate).toBeNull(); // never rendered as a deadline
    expect(c.estimatedCloseDate).toBe("2026-10-29");
    expect(c.reason).toMatch(/not opened yet/);
  });

  test("forecast: a record with no usable deadline is never open", () => {
    const c = classifyStateGrant(record({ postedDate: "2026-01-01" }), now);
    expect(c.status).toBe("forecast");
    expect(c.closeDate).toBeNull();
    expect(c.estimatedCloseDate).toBeNull();
    expect(c.reason).toMatch(/no usable closing date/);
  });

  test("forecast: a deadline-less posted record is never promoted", () => {
    const c = classifyStateGrant(record({ postedDate: "2026-09-01", closeDate: "TBD" }), now);
    expect(c.status).toBe("forecast");
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

  test("every decision carries a reason a reviewer can re-derive", () => {
    for (const r of [
      record({ closeDate: "2026-12-01" }),
      record({ postedDate: "2026-12-01", closeDate: "2026-12-31" }),
      record({ closeDate: "2020-01-01" }),
      record({}),
      record({ ongoing: true }),
    ]) {
      expect(classifyStateGrant(r, now).reason.length).toBeGreaterThan(10);
    }
  });

  test("the Virginia connector uses the shared classifier unchanged", () => {
    const r = record({ postedDate: "2026-09-22", closeDate: "2026-10-29" });
    expect(classifyVirginiaRecord(r, now)).toEqual(classifyStateGrant(r, now));
  });

  test("the fixture's records classify into all three states", () => {
    const { opportunities } = parseGrantOpportunities(virginiaConnector, VA_FIXTURE, now);
    const byId = new Map(opportunities.map((o) => [o.externalId, o]));
    expect(byId.get("leverageprogram")!.status).toBe("closed");
    expect(byId.get("mmlp")!.status).toBe("closed");
    expect(byId.get("virginia-special-events-festivals-program")!.status).toBe("forecast");
    expect(byId.get("virginia-special-events-festivals-program")!.estimatedCloseDate).toBe(
      "2026-10-29",
    );
    expect(byId.get("virginia-special-events-festivals-program")!.closeDate).toBeNull();
    expect(byId.get("drivetourism")!.status).toBe("forecast");
    expect(byId.get("tdfp")!.status).toBe("open");
  });
});

// ── 4. Dedupe, fingerprints, amendments ─────────────────────────────────────

describe("dedupe and change detection", () => {
  test("the same external_id twice yields ONE record, and the collision is reported", () => {
    const dup = dedupeByExternalId([
      record({ externalId: "same", title: "First" }),
      record({ externalId: "same", title: "Second" }),
      record({ externalId: "other", title: "Other" }),
    ]);
    expect(dup.records.length).toBe(2);
    expect(dup.records.map((r) => r.title)).toEqual(["First", "Other"]);
    expect(dup.collisions).toEqual(["VA:same"]);
  });

  test("the same id in a DIFFERENT state is a different record", () => {
    const dup = dedupeByExternalId([
      record({ externalId: "same" }),
      record({ stateCode: "MD", externalId: "same" }),
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

  test("fingerprints are key-order independent and 32 hex chars", () => {
    const one = contentFingerprint({ a: 1, b: [2, { c: 3 }] });
    const two = contentFingerprint({ b: [2, { c: 3 }], a: 1 });
    expect(one).toBe(two);
    expect(one).toMatch(/^[0-9a-f]{32}$/);
  });

  test("a changed summary counts as an amendment; the identity does not move", () => {
    const before = toOpportunity(
      record({ externalId: "mmlp", title: "MMLP", summary: "old wording" }),
    );
    const after = toOpportunity(
      record({ externalId: "mmlp", title: "MMLP", summary: "new wording" }),
    );
    expect(after.externalId).toBe(before.externalId);
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });
});

// ── 5. The registry — fail-closed, always ────────────────────────────────────

describe("state registry", () => {
  const fakeConnector = (stateCode: string, host = "example.gov"): StateGrantConnector<never> =>
    ({
      id: `fake-${stateCode.toLowerCase()}`,
      stateCode,
      stateName: stateCode,
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

  test("every state and DC is present exactly once, with a real name", () => {
    const states = listStates();
    expect(states.length).toBe(51);
    expect(new Set(states.map((s) => s.stateCode)).size).toBe(51);
    expect(STATE_CODES.length).toBe(51);
    expect(states.map((s) => s.stateCode).sort()).toEqual([...STATE_CODES].sort());
    for (const s of states) expect(s.name).toBe(STATE_NAMES[s.stateCode]);
  });

  test("Virginia is connected BECAUSE its connector and its validation test exist", () => {
    const entry = getStateEntry("VA")!;
    expect(entry.status).toBe("connected");
    expect(entry.connectorId).toBe("va-vtc-grants");
    expect(entry.sourceUrl).toBe(VIRGINIA_SOURCE_URL);
    expect(entry.sourceValidationTest).toMatch(/virginia\.source-validation\.test\.ts$/);
    expect(entry.reason).toMatch(/verified against/);
    expect(isStateConnected("va")).toBe(true); // case-insensitive lookup
    expect(getConnector("VA")?.id).toBe("va-vtc-grants");
  });

  test("every other state is unavailable — the registry is NOT coverage", () => {
    const others = listStates().filter((s) => s.stateCode !== "VA");
    expect(others.length).toBe(50);
    for (const s of others) {
      expect(s.status).toBe("unavailable");
      expect(s.connectorId).toBeNull();
      expect(s.reason).toMatch(/no connector registered/);
      expect(getConnector(s.stateCode)).toBeNull();
    }
    expect(coverageCounts()).toEqual({ total: 51, connected: 1, unavailable: 50 });
  });

  test("a connector WITHOUT a source-validation test can never be connected", () => {
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

  test("a manifest that disagrees with the connector can never be connected", () => {
    const wrongId = deriveStateRegistry({
      connectors: { VA: fakeConnector("VA") },
      validations: {
        VA: { connectorId: "other", sourceUrl: "https://example.gov/grants", testFile: "t", verifiedOn: "x" },
      },
      approvedHosts: ["example.gov"],
      states: ["VA"],
      names: { VA: "Virginia" },
    });
    expect(wrongId[0].status).toBe("unavailable");
    expect(wrongId[0].reason).toMatch(/disagrees with the connector/);

    const wrongUrl = deriveStateRegistry({
      connectors: { VA: fakeConnector("VA") },
      validations: {
        VA: { connectorId: "fake-va", sourceUrl: "https://example.gov/other", testFile: "t", verifiedOn: "x" },
      },
      approvedHosts: ["example.gov"],
      states: ["VA"],
      names: { VA: "Virginia" },
    });
    expect(wrongUrl[0].status).toBe("unavailable");
    expect(wrongUrl[0].reason).toMatch(/disagrees with the connector/);
  });

  test("a host that is not on the approved allowlist can never be connected", () => {
    const registry = deriveStateRegistry({
      connectors: { VA: fakeConnector("VA", "not-approved.example") },
      validations: {
        VA: {
          connectorId: "fake-va",
          sourceUrl: "https://not-approved.example/grants",
          testFile: "t",
          verifiedOn: "x",
        },
      },
      approvedHosts: ["example.gov"],
      states: ["VA"],
      names: { VA: "Virginia" },
    });
    expect(registry[0].status).toBe("unavailable");
    expect(registry[0].reason).toMatch(/not on the approved-source allowlist/);
  });

  test("the full gate CAN produce connected — otherwise the gate would be untestable", () => {
    const registry = deriveStateRegistry({
      connectors: { VA: fakeConnector("VA") },
      validations: {
        VA: {
          connectorId: "fake-va",
          sourceUrl: "https://example.gov/grants",
          testFile: "t",
          verifiedOn: "x",
        },
      },
      approvedHosts: ["example.gov"],
      states: ["VA"],
      names: { VA: "Virginia" },
    });
    expect(registry[0].status).toBe("connected");
  });

  test("unknown state codes are unavailable and have no connector", () => {
    for (const code of ["ZZ", "", "  ", "Virginia", "va-", "12"]) {
      expect(getStateStatus(code)).toBe("unavailable");
      expect(getConnector(code)).toBeNull();
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
