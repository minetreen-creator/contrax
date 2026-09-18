/**
 * Unit tests for the homepage example AI Executive Brief selection + rendering
 * rules (owner order 2026-09-18 defect fix).
 *
 * The production defect: the homepage card header rendered the bid's CURRENT
 * due date ("Due Sep 23, 2026") while the cached brief still said the submission
 * deadline was Sep 16, 2026 and listed mandatory pre-bid meetings that had
 * already happened. The old loader picked the "richest" cached ai_summary with
 * NO freshness, deadline or milestone checks.
 *
 * Everything under test is DB-free and browser-free:
 *   - selection/eligibility rules  → src/lib/brief-source.ts (pure)
 *   - the homepage embed's empty behavior → src/components/ExampleBriefView.tsx
 *     (rendered to static markup, so "renders nothing" is proven, not asserted
 *     by reading the source).
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ExampleBriefView } from "~/components/ExampleBriefView";
import type { ExampleBrief as ExampleBriefData } from "~/lib/example-brief";
import {
  evaluateExample,
  fingerprintFor,
  selectExampleBrief,
  type ExampleBidRow,
} from "~/lib/brief-source";

/** Fixed clock so every rule is deterministic: 2026-09-18T12:00:00Z. */
const NOW = Date.parse("2026-09-18T12:00:00.000Z");

const BASE_SUMMARY = {
  summary:
    "The New York City Housing Authority seeks a contractor to replace the Ron Brown cooling tower, including rigging, controls integration and commissioning at an occupied hospital campus.",
  mandatory_requirements: [
    {
      text: "Bidders must attend the mandatory pre-bid meeting",
      source:
        "The mandatory pre-bid meetings are scheduled for: Monday, September 21, 2026 at 9:00 A.M.",
    },
  ],
  key_milestones: [
    {
      event: "mandatory pre-bid meeting",
      date: "2026-09-21",
      source:
        "The mandatory pre-bid meetings are scheduled for: Monday, September 21, 2026 at 9:00 A.M.",
    },
    {
      event: "questions submission deadline",
      date: "2026-09-30",
      source:
        "Technical questions must be submitted in writing by email no later than Wednesday, September 30, 2026.",
    },
    {
      event: "bid due date",
      date: "2026-11-05",
      source: "Bids shall be due on November 5, 2026 @ 11:00AM.",
    },
  ],
  trade_category: "HVAC",
  red_flags: [],
};

/** A currently open, complete, internally consistent example bid. */
const BASE_ROW: ExampleBidRow = {
  id: 134946,
  title: "Harlem Hospital_Ron Brown Cooling Tower Replacement",
  agency: "NYC Health + Hospitals",
  description: "Cooling tower replacement at Ron Brown building, NYC Health + Hospitals.",
  category: "construction",
  set_aside: null,
  due_date: "2026-11-05T11:00:00.000Z",
  estimated_value: null,
  source_url: "https://a856-cityrecord.nyc.gov/20260902028",
  location: "New York, NY",
  naics_code: "238220",
  updated_at: "2026-09-10T15:50:45.552Z",
  latest_amendment_at: null,
  ai_summary: BASE_SUMMARY,
  ai_summary_at: "2026-09-14T17:07:42.146Z",
  ai_summary_source_hash: null,
  ai_summary_schema_version: 2,
  ai_summary_model: "gpt-4o-mini",
} as ExampleBidRow;

/** Evaluate a row with a CURRENT (matching) fingerprint. */
async function evaluate(row: ExampleBidRow) {
  const currentFingerprint = await fingerprintFor(row);
  return evaluateExample(
    { row: { ...row, ai_summary_source_hash: currentFingerprint }, currentFingerprint },
    NOW,
  );
}

describe("example brief — eligibility (never display a stale/contradictory brief)", () => {
  test("1. rejects an opportunity whose due date is already in the past", async () => {
    const ev = await evaluate({
      ...BASE_ROW,
      due_date: "2026-09-01T11:00:00.000Z",
      ai_summary: {
        ...BASE_SUMMARY,
        key_milestones: [
          { event: "bid due date", date: "2026-09-01", source: "Bids due September 1, 2026." },
        ],
      },
    });
    expect(ev.eligible).toBe(false);
    expect(ev.reasons).toContain("expired_due_date");
    expect(ev.daysRemaining).toBeLessThan(0);
  });

  test("2. rejects an opportunity whose mandatory pre-bid date has passed", async () => {
    const ev = await evaluate({
      ...BASE_ROW,
      ai_summary: {
        ...BASE_SUMMARY,
        key_milestones: [
          {
            event: "Mandatory pre-bid meeting",
            date: "2026-08-25",
            source: "The mandatory pre-bid meetings are scheduled for: Tuesday, August 25, 2026.",
          },
          { event: "bid due date", date: "2026-11-05", source: "Bids due November 5, 2026." },
        ],
      },
    });
    expect(ev.eligible).toBe(false);
    expect(ev.reasons).toContain("passed_prebid_date");
    expect(ev.bindingPrebidDays).toEqual(["2026-08-25"]);
  });

  test("2b. a date the notice itself calls non-mandatory does not hard-reject", async () => {
    const ev = await evaluate({
      ...BASE_ROW,
      ai_summary: {
        ...BASE_SUMMARY,
        key_milestones: [
          {
            event: "Non-mandatory pre-bid conference",
            date: "2026-08-25",
            source: "A non-mandatory virtual pre-bid conference will be held on 08/25/2026.",
          },
          { event: "bid due date", date: "2026-11-05", source: "Bids due November 5, 2026." },
        ],
      },
    });
    expect(ev.reasons).not.toContain("passed_prebid_date");
    expect(ev.eligible).toBe(true);
  });

  test("3. rejects a cached brief whose submission deadline conflicts with the current due date", async () => {
    // The exact production shape: header due 2026-09-23 vs cached deadline 2026-09-16.
    const ev = await evaluate({
      ...BASE_ROW,
      id: 56942,
      due_date: "2026-09-23T11:00:00.000Z",
      ai_summary: {
        ...BASE_SUMMARY,
        key_milestones: [
          {
            event: "Mandatory pre-bid meeting",
            date: "2026-09-21",
            source: "The mandatory pre-bid meetings are scheduled for: Monday, September 21, 2026.",
          },
          { event: "Bid submission deadline", date: "2026-09-16", source: "due_date" },
        ],
      },
    });
    expect(ev.eligible).toBe(false);
    expect(ev.reasons).toContain("deadline_mismatch");
    expect(ev.submissionDeadlineDay).toBe("2026-09-16");
    expect(ev.dueDateOnly).toBe("2026-09-23");
  });

  test("3b. a brief with no identifiable submission deadline is judged on the record due date", async () => {
    const ev = await evaluate({
      ...BASE_ROW,
      ai_summary: {
        ...BASE_SUMMARY,
        key_milestones: [
          {
            event: "mandatory pre-bid meeting",
            date: "2026-09-21",
            source: "The mandatory pre-bid meetings are scheduled for: September 21, 2026.",
          },
        ],
      },
    });
    expect(ev.reasons).not.toContain("deadline_mismatch");
    expect(ev.eligible).toBe(true);
  });

  test("skips incomplete cached briefs and bids with no original-notice link", async () => {
    const noReqs = await evaluate({
      ...BASE_ROW,
      ai_summary: { ...BASE_SUMMARY, mandatory_requirements: [] },
    });
    expect(noReqs.reasons).toContain("incomplete_summary");

    const noUrl = await evaluate({ ...BASE_ROW, source_url: "   " });
    expect(noUrl.reasons).toContain("missing_source_url");
  });

  test("skips a cached brief whose stored fingerprint no longer matches the source", async () => {
    const currentFingerprint = await fingerprintFor(BASE_ROW);
    // Old (pre-v2) hash value → the fingerprint changed → stale.
    const ev = evaluateExample(
      { row: { ...BASE_ROW, ai_summary_source_hash: "0".repeat(64) }, currentFingerprint },
      NOW,
    );
    expect(ev.eligible).toBe(false);
    expect(ev.reasons).toEqual(["stale_fingerprint"]);

    // Extension of the fingerprint to updated_at / amendment stamp matters:
    // a brief generated BEFORE an amendment must go stale after it.
    const beforeAmendment = await fingerprintFor({
      ...BASE_ROW,
      latest_amendment_at: null,
    });
    const amendedRow: ExampleBidRow = {
      ...BASE_ROW,
      latest_amendment_at: "2026-09-17T09:00:00.000Z",
    };
    const afterAmendment = await fingerprintFor(amendedRow);
    expect(afterAmendment).not.toBe(beforeAmendment);
    const amended = evaluateExample(
      {
        row: { ...amendedRow, ai_summary_source_hash: beforeAmendment },
        currentFingerprint: afterAmendment,
      },
      NOW,
    );
    expect(amended.reasons).toContain("stale_fingerprint");
  });

  test("4. accepts a current, internally consistent example", async () => {
    const ev = await evaluate(BASE_ROW);
    expect(ev.reasons).toEqual([]);
    expect(ev.eligible).toBe(true);
    expect(ev.atLeastOneWeekLeft).toBe(true);
    expect(ev.richness).toBe(1);

    const currentFingerprint = await fingerprintFor(BASE_ROW);
    const selection = selectExampleBrief(
      [{ row: { ...BASE_ROW, ai_summary_source_hash: currentFingerprint }, currentFingerprint }],
      NOW,
    );
    expect(selection.best?.row.id).toBe(134946);
    expect(selection.staleEligible).toHaveLength(0);
  });

  test("ranks a clean solicitation above a richer correction notice, and never picks an invalid one", async () => {
    const rows: ExampleBidRow[] = [
      {
        ...BASE_ROW,
        id: 900,
        title: "Correction: FIRE ALARM REPLACEMENT AT BELLEVUE HOSPITAL CENTER",
        due_date: "2026-09-23T11:00:00.000Z",
        ai_summary: {
          ...BASE_SUMMARY,
          mandatory_requirements: [
            ...BASE_SUMMARY.mandatory_requirements,
            { text: "Second requirement", source: "quote" },
            { text: "Third requirement", source: "quote" },
          ],
          key_milestones: [
            {
              event: "mandatory site visit",
              date: "2026-09-21",
              source: "Mandatory site visit September 21, 2026",
            },
            { event: "bid due date", date: "2026-09-23", source: "Bids due September 23, 2026" },
          ],
        },
      },
      { ...BASE_ROW, id: 901 },
    ];
    const candidates = await Promise.all(
      rows.map(async (row) => ({
        row: { ...row, ai_summary_source_hash: await fingerprintFor(row) },
        currentFingerprint: await fingerprintFor(row),
      })),
    );
    const selection = selectExampleBrief(candidates, NOW);
    expect(selection.best?.row.id).toBe(901); // clean title wins over richness
    expect(selection.eligible.map((e) => e.row.id)).toEqual([901, 900]);
    expect(selection.eligible[1].cleanTitle).toBe(false);
  });

  test("5. returns no example at all when nothing is eligible", async () => {
    const candidates = await Promise.all(
      [
        { ...BASE_ROW, id: 1, due_date: "2026-09-01T11:00:00.000Z" },
        { ...BASE_ROW, id: 2, ai_summary: { ...BASE_SUMMARY, mandatory_requirements: [] } },
      ].map(async (row) => ({
        row: { ...row, ai_summary_source_hash: await fingerprintFor(row) },
        currentFingerprint: await fingerprintFor(row),
      })),
    );
    const selection = selectExampleBrief(candidates, NOW);
    expect(selection.best).toBeNull();
    expect(selection.eligible).toHaveLength(0);
  });
});

describe("example brief — homepage embed empty state (owner: never on the homepage)", () => {
  test("5b. the embed renders NOTHING when no valid example exists", () => {
    const html = renderToStaticMarkup(
      <ExampleBriefView brief={null} variant="embed" />,
    );
    expect(html).toBe("");
    expect(html).not.toContain("No example brief");
  });

  test("the standalone page keeps an honest fallback (never a broken layout)", () => {
    const html = renderToStaticMarkup(
      <ExampleBriefView brief={null} variant="page" />,
    );
    expect(html).toContain("No example brief is available right now.");
  });

  test("the embed still renders the loading shell before the loader resolves", () => {
    const html = renderToStaticMarkup(
      <ExampleBriefView brief={undefined} variant="embed" />,
    );
    expect(html).toContain("Loading example brief");
  });
});

describe("example brief — copy", () => {
  const brief = (estimatedValue: string | null): ExampleBriefData => ({
    id: 1,
    title: "Harlem Hospital_Ron Brown Cooling Tower Replacement",
    agency: "NYC Health + Hospitals",
    set_aside: null,
    due_date: "2026-11-05T11:00:00.000Z",
    source_url: "https://a856-cityrecord.nyc.gov/20260902028",
    location: "New York, NY",
    estimated_value: estimatedValue,
    summary: {
      summary: "Cooling tower replacement.",
      mandatory_requirements: [{ text: "Must attend pre-bid", source: "quote" }],
      key_milestones: [{ event: "bid due date", date: "2026-11-05", source: "quote" }],
      trade_category: "HVAC",
      red_flags: [],
    },
    naics_code: "238220",
    generatedAt: "2026-09-14T17:07:42.146Z",
  });

  test('never renders "Not specified estimated" — it says "Value not disclosed"', () => {
    for (const placeholder of [null, "", "Not specified", "Unknown", "N/A"]) {
      const html = renderToStaticMarkup(
        <ExampleBriefView brief={brief(placeholder)} variant="embed" />,
      );
      expect(html).toContain("Value not disclosed");
      expect(html).not.toContain("Not specified estimated");
      expect(html).not.toContain("estimated estimated");
    }
  });

  test("renders the real value + “estimated” when the notice discloses one", () => {
    const html = renderToStaticMarkup(
      <ExampleBriefView brief={brief("$2,400,000")} variant="embed" />,
    );
    expect(html).toContain("$2,400,000 estimated");
    expect(html).not.toContain("Value not disclosed");
  });
});
