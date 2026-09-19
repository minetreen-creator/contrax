/**
 * NATIONWIDE WORKSTREAM — DETERMINISTIC FIXTURE TESTS for the continuous tranche
 * that follows the escalation pass: the District of Columbia, West Virginia,
 * Kentucky, Alabama and Maine (owner correction 2026-09-19, ratified 243: ONE
 * continuous nationwide workstream, ONE accumulating PR — no separate batches).
 *
 * THE OWNER'S GUARDRAIL (2026-09-19): the DEFAULT suite must be deterministic and
 * touch NO network. Every page here is a SAVED, trimmed content-region fixture of
 * the real official source (`src/lib/state-grants/fixtures/…`, fetched
 * 2026-09-19), and the first test proves parsing + classifying all five produces
 * ZERO fetch calls. The live half lives in `<state>.source-validation.test.ts`,
 * which is opt-in (`bun run validate:live-sources`) and skipped loudly otherwise.
 *
 * WHAT THESE TESTS ARE FOR: the honesty traps each source carries —
 *   - an "OPEN" tag with NO published date (never open),
 *   - an "OPEN" tag whose own published closing date has PASSED (closed, not open),
 *   - the award/checklist links at the bottom of a listing (never opportunities),
 *   - "Rolling" as a value the source itself publishes (rolling) versus the words
 *     "rolling basis"/"year-round" inside a DESCRIPTION (never a status),
 *   - "Not Currently Open" as the source's own value (closed, never dated),
 *   - a final-report due date (a reporting date, never an application deadline),
 *   - a dated workshop/webinar on a card (an event, never a deadline),
 *   - a WordPress taxonomy page titled "… Archives" that is NOT a closed-cycle
 *     history (checked live before serving), and
 *   - one program published twice on one page (ONE record, not two)
 * — plus the owner's status model on real data.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  STATE_GRANT_STATUSES,
  parseGrantOpportunities,
  type GrantOpportunity,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";
import { districtOfColumbiaConnector } from "~/lib/state-grants/connectors/district-of-columbia";
import { westVirginiaConnector } from "~/lib/state-grants/connectors/west-virginia";
import { kentuckyConnector } from "~/lib/state-grants/connectors/kentucky";
import { alabamaConnector } from "~/lib/state-grants/connectors/alabama";
import { maineConnector } from "~/lib/state-grants/connectors/maine";

/** One fixed clock for every classification below (2026-09-19, US Eastern). */
const NOW = new Date("2026-09-19T12:00:00Z");
const TODAY = "2026-09-19";

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

function parse(connector: StateGrantConnector<string>, name: string): GrantOpportunity[] {
  return parseGrantOpportunities(connector, fixture(name), NOW).opportunities;
}

const DC_FILE = "district-of-columbia-dmped-grant-opportunities.html";
const WV_FILE = "west-virginia-culture-arts-grants.html";
const KY_FILE = "kentucky-arts-council-grants.html";
const AL_FILE = "alabama-adeca-funding-opportunities.html";
const ME_FILE = "maine-arts-commission-grants-home.html";

const DC = () => parse(districtOfColumbiaConnector, DC_FILE);
const WV = () => parse(westVirginiaConnector, WV_FILE);
const KY = () => parse(kentuckyConnector, KY_FILE);
const AL = () => parse(alabamaConnector, AL_FILE);
const ME = () => parse(maineConnector, ME_FILE);

const ALL = [
  ["DC", districtOfColumbiaConnector, DC, DC_FILE],
  ["WV", westVirginiaConnector, WV, WV_FILE],
  ["KY", kentuckyConnector, KY, KY_FILE],
  ["AL", alabamaConnector, AL, AL_FILE],
  ["ME", maineConnector, ME, ME_FILE],
] as const;

function count(records: GrantOpportunity[], status: string): number {
  return records.filter((o) => o.status === status).length;
}

function byTitle(records: GrantOpportunity[], needle: string): GrantOpportunity {
  const found = records.filter((o) => o.title.toLowerCase().includes(needle.toLowerCase()));
  expect(found.length).toBe(1);
  return found[0]!;
}

describe("nationwide continuous tranche (DC, WV, KY, AL, ME) — determinism and shared invariants", () => {
  test("parsing and classifying all five fixtures makes ZERO network requests", () => {
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    try {
      globalThis.fetch = ((input: unknown, init?: unknown) => {
        calls.push(String(input));
        return realFetch(input as never, init as never);
      }) as typeof fetch;
      for (const [, connector, parseFn] of ALL) {
        const records = parseFn();
        expect(records.length).toBeGreaterThan(0);
        for (const o of records) connector.classify(o, NOW);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toEqual([]);
  });

  test("every record is well formed, on an approved host, and carries no invented date", () => {
    for (const [code, connector, parseFn] of ALL) {
      const records = parseFn();
      expect(records.length).toBeGreaterThan(0);
      expect(new Set(records.map((o) => o.externalId)).size).toBe(records.length);
      for (const o of records) {
        expect(o.stateCode).toBe(code);
        expect(o.sourceKey).toBe(connector.id);
        expect(o.title.trim().length).toBeGreaterThan(2);
        expect(STATE_GRANT_STATUSES).toContain(o.status);
        // `forecast` is not a status any more (owner 2026-09-19).
        expect(o.status as string).not.toBe("forecast");
        // Every URL stays on the source's own official host.
        expect(new URL(o.url).host).toBe(new URL(connector.sourceUrl).host);
        expect(new URL(o.url).protocol).toBe("https:");
        for (const day of [o.postedDate, o.closeDate, o.estimatedCloseDate]) {
          if (day === null) continue;
          expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(Number.isNaN(Date.parse(`${day}T00:00:00Z`))).toBe(false);
        }
        // No estimate ever masquerades as a posted deadline.
        expect(o.closeDate === null || o.estimatedCloseDate === null).toBe(true);
      }
    }
  });

  test("the owner's status model holds on every record (open needs a future published date)", () => {
    for (const [, , parseFn] of ALL) {
      for (const o of parseFn()) {
        const sourceClosed =
          o.raw.sourceClosedDeclaredBySource === true ||
          o.raw.cycleClosedDeclaredBySource === true ||
          o.raw.sectionDeclaresClosed === true;
        const rollingDeclared =
          o.raw.rollingDeclaredBySource === true || o.raw.ongoingDeclaredBySource === true;
        switch (o.status) {
          case "open":
            expect(o.closeDate).not.toBeNull();
            expect(o.closeDate! >= TODAY).toBe(true);
            expect(o.sourceClosed).toBe(false);
            break;
          case "rolling":
            expect(rollingDeclared).toBe(true);
            expect(o.closeDate).toBeNull();
            break;
          case "closed":
            expect(sourceClosed || (o.closeDate !== null && o.closeDate < TODAY)).toBe(true);
            break;
          case "unverified":
            expect(o.closeDate).toBeNull();
            break;
          default:
            throw new Error(`unexpected status ${o.status}`);
        }
      }
    }
  });
});

describe("District of Columbia (dmped.dc.gov) — the source's own status token is not a date", () => {
  const records = DC;

  test("reads the listing's nine program cards", () => {
    const parsed = records();
    expect(parsed.length).toBe(9);
    expect(parseGrantOpportunities(districtOfColumbiaConnector, fixture(DC_FILE), NOW).collisions).toEqual([]);
  });

  test("the award lists and checklist after the listing are NEVER opportunities", () => {
    for (const o of records()) {
      expect(o.title).not.toMatch(/awardees|grant awards|checklist/i);
    }
  });

  test("a card tagged OPEN that publishes no closing date is `unverified`, never open", () => {
    const cpaf = byTitle(records(), "Commercial Property Acquisition Fund");
    expect(cpaf.raw.sourceStatusText).toBe("STATUS: OPEN");
    expect(cpaf.raw.sourceStatusDeclaresOpen).toBe(true);
    expect(cpaf.postedDate).toBeNull();
    expect(cpaf.closeDate).toBeNull();
    expect(cpaf.status).toBe("unverified");
    expect(cpaf.sourceClosed).toBe(false);
  });

  test("a stale \"STATUS: OPEN\" never beats the card's own published closing date", () => {
    const relief = byTitle(records(), "Special Event Relief Fund");
    expect(relief.raw.sourceStatusText).toBe("STATUS: OPEN");
    expect(relief.closeDate).toBe("2026-09-01");
    expect(relief.closeDate! < TODAY).toBe(true);
    expect(relief.status).toBe("closed");
    // The source's contradictory status line is kept verbatim so a reviewer sees both.
    expect(relief.raw.sourceStatusDeclaresOpen).toBe(true);
  });

  test("every card the source itself tags CLOSED is served closed", () => {
    const tagged = records().filter((o) => o.raw.sourceStatusText === "STATUS: CLOSED");
    expect(tagged.length).toBe(7);
    for (const o of tagged) {
      expect(o.sourceClosed).toBe(true);
      expect(o.status).toBe("closed");
    }
    // Plus the stale-OPEN card whose own published deadline has passed: 8 closed
    // in total, and not one of them is open.
    expect(count(records(), "closed")).toBe(8);
    expect(count(records(), "open")).toBe(0);
  });

  test("no record is ever rolling or carrying a guessed date from prose", () => {
    for (const o of records()) {
      expect(o.ongoing).toBe(false);
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.raw.rollingDeclaredBySource).toBe(false);
    }
  });
});

describe("West Virginia (wvculture.org) — the source's own deadline value decides", () => {
  const records = WV;

  test("reads both labelled sections: 8 dated, 4 rolling, 2 not currently open", () => {
    const parsed = records();
    expect(parsed.length).toBe(14);
    expect(count(parsed, "open")).toBe(8);
    expect(count(parsed, "rolling")).toBe(4);
    expect(count(parsed, "closed")).toBe(2);
    for (const o of parsed) {
      if (o.status === "open") expect(o.closeDate).toBe("2026-10-01");
    }
  });

  test("\"Rolling\" is the source's OWN published value, and only it makes a record rolling", () => {
    for (const o of records()) {
      if (o.raw.deadlineValue === "Rolling") {
        expect(o.ongoing).toBe(true);
        expect(o.closeDate).toBeNull();
        expect(o.status).toBe("rolling");
      } else {
        expect(o.ongoing).toBe(false);
        expect(o.raw.deadlineValue).not.toBe("Rolling");
      }
    }
  });

  test("\"Not Currently Open\" is the source's own state — never a date, never open", () => {
    const notOpen = records().filter((o) => o.raw.sourceDeclaresNotCurrentlyOpen === true);
    expect(notOpen.length).toBe(2);
    for (const o of notOpen) {
      expect(o.raw.deadlineValue).toBe("Not Currently Open");
      expect(o.sourceClosed).toBe(true);
      expect(o.status).toBe("closed");
      expect(o.closeDate).toBeNull();
      expect(o.postedDate).toBeNull();
    }
  });

  test("the final-report due date is NOT an application deadline", () => {
    // The page publishes "**Final Reports for all FY26 grants are due September
    // 28, 2026**" outside the opportunity region; no record may carry it.
    for (const o of records()) {
      expect(o.closeDate).not.toBe("2026-09-28");
      expect(o.postedDate).not.toBe("2026-09-28");
    }
  });

  test("every URL is the listing itself — the GOapply and Google-hosted links are never the source", () => {
    for (const o of records()) {
      expect(o.url).toBe(westVirginiaConnector.sourceUrl);
    }
  });
});

describe("Kentucky (artscouncil.ky.gov) — an \"… Archives\" title that is NOT a closed-cycle history", () => {
  const records = KY;

  test("reads ten programs and takes each deadline from the card's own machine-readable value", () => {
    const parsed = records();
    expect(parsed.length).toBe(10);
    for (const o of parsed) {
      expect(o.raw.deadlineValueIsMachineReadableTimeElement).toBe(true);
      expect(o.raw.listingTitleIsTaxonomyArchiveNotAClosedCycleHistory).toBe(true);
      expect(o.raw.deadlineValue).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
    }
  });

  test("a passed published deadline is closed and a future one is open — no per-record guessing", () => {
    const parsed = records();
    expect(count(parsed, "open")).toBe(2);
    expect(count(parsed, "closed")).toBe(8);
    for (const o of parsed) {
      if (o.closeDate! < TODAY) expect(o.status).toBe("closed");
      else expect(o.status).toBe("open");
    }
    expect(byTitle(parsed, "Poetry Out Loud Registration").closeDate).toBe("2026-10-03");
    expect(byTitle(parsed, "Arts Miles Program Grant").closeDate).toBe("2027-03-31");
    expect(byTitle(parsed, "America250KY").closeDate).toBe("2025-08-24");
  });

  test("description prose can NEVER flip a record to rolling", () => {
    // "Kentucky Arts Rising … year-round arts programming" and "Arts Miles …
    // accepted on a rolling basis between October and March" are prose; the card's
    // labelled deadline is what counts.
    for (const o of records()) {
      expect(o.ongoing).toBe(false);
      expect(o.raw.rollingDeclaredByTheLabelledDeadlineValue).toBe(false);
    }
    expect(byTitle(records(), "Kentucky Arts Rising").status).toBe("closed");
  });

  test("the record identity is the source's own program path, not a position", () => {
    expect(byTitle(records(), "Poetry Out Loud Registration").externalId).toBe("poetry-out-loud-program");
    expect(byTitle(records(), "Folk and Traditional Arts Apprenticeship Grant").externalId).toBe(
      "folk-and-traditional-arts-apprenticeship",
    );
  });
});

describe("Alabama (adeca.alabama.gov) — the page's intro line is not a program, and a stale listing is not open", () => {
  const records = AL;

  test("reads exactly the four program blocks and never the page's introductory heading", () => {
    const parsed = records();
    expect(parsed.length).toBe(4);
    for (const o of parsed) {
      expect(o.title).not.toMatch(/^Funding opportunities, requests for proposals/i);
    }
  });

  test("the source's own dates beat the page's \"currently open … only\" framing", () => {
    const parsed = records();
    expect(byTitle(parsed, "Highway Safety Paid Media Campaigns").closeDate).toBe("2026-09-18");
    expect(byTitle(parsed, "Land and Water Conservation Fund").closeDate).toBe("2026-09-18");
    expect(byTitle(parsed, "Highway Safety Paid Media Campaigns").status).toBe("closed");
    expect(count(parsed, "closed")).toBe(2);
    expect(count(parsed, "open")).toBe(2);
  });

  test("the VW Settlement closing is read from the source's own \"accepting applications until\" phrase", () => {
    const vw = byTitle(records(), "VW Settlement");
    expect(vw.raw.deadlineReadFromTheSourcesAcceptingApplicationsUntilPhrase).toBe(true);
    expect(vw.closeDate).toBe("2026-10-06");
    expect(vw.status).toBe("open");
  });

  test("the dated application workshop on the VW card is an EVENT, never a deadline", () => {
    const vw = byTitle(records(), "VW Settlement");
    expect(vw.raw.webinarDayIsNeverADeadline).toBe(true);
    expect(typeof vw.raw.webinarLine).toBe("string");
    for (const o of records()) {
      expect(o.postedDate).not.toBe("2026-09-01");
      expect(o.closeDate).not.toBe("2026-09-01");
    }
  });

  test("a downloadable application is never served as the opportunity's page", () => {
    for (const o of records()) {
      expect(o.url).not.toMatch(/\.(pdf|docx?|xlsx?)$/i);
    }
  });
});

describe("Maine (mainearts.maine.gov) — a closed cycle is never re-served as open, and one program is one record", () => {
  const records = ME;

  test("reads both published shapes without duplicating a program", () => {
    const parsed = records();
    expect(parsed.length).toBe(6);
    expect(new Set(parsed.map((o) => o.externalId)).size).toBe(6);
    expect(count(parsed, "open")).toBe(2);
    expect(count(parsed, "closed")).toBe(3);
    expect(count(parsed, "unverified")).toBe(1);
  });

  test("\"Current Status: Closed\" is served closed even though the page still publishes it", () => {
    const closed = records().filter((o) => o.raw.sourceStatusValue === "Closed");
    expect(closed.length).toBe(3);
    for (const o of closed) {
      expect(o.sourceClosed).toBe(true);
      expect(o.status).toBe("closed");
      expect(o.closeDate).toBeNull();
    }
  });

  test("a status that is neither open nor closed and publishes no date stays unverified", () => {
    const traditional = byTitle(records(), "Traditional Arts Apprenticeship");
    expect(traditional.raw.statusIsNeitherOpenNorClosed).toBe(true);
    expect(traditional.status).toBe("unverified");
    expect(traditional.closeDate).toBeNull();
    expect(traditional.sourceClosed).toBe(false);
  });

  test("the same program published in both shapes is ONE record, keyed on the agency's own page path", () => {
    const parsed = records();
    // "Artist Fellowship" (current opportunities) and "Maine Artist Fellowship"
    // (funding directory) are one program on one page.
    const fellowship = parsed.filter((o) => o.externalId === "individual-artist-fellowships");
    expect(fellowship.length).toBe(1);
    expect(fellowship[0]!.title).toBe("Artist Fellowship");
    const ops = parsed.filter((o) => o.externalId === "organization-operations-grant");
    expect(ops.length).toBe(1);
    expect(ops[0]!.closeDate).toBe("2026-10-15");
  });

  test("an award-notification month is never read as a deadline", () => {
    for (const o of records()) {
      expect(o.postedDate).not.toBe("2027-01-15");
      expect(o.closeDate).not.toBe("2027-01-15");
      for (const day of [o.postedDate, o.closeDate]) {
        if (day === null) continue;
        expect(day.startsWith("2026-")).toBe(true);
      }
    }
  });
});
