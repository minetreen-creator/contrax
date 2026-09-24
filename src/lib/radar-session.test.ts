import { describe, expect, test } from "bun:test";
import {
  freshRadarSeen,
  RADAR_SEEN_MAX_AGE_MS,
  type RadarSeen,
  type RadarSeenMatch,
} from "./radar-session";

const NOW = Date.parse("2026-09-24T12:00:00.000Z");

function match(id: number, dueDate: string | null = "2026-09-25"): RadarSeenMatch {
  return {
    id,
    title: `Opportunity ${id}`,
    agency: "Agency",
    score: 80,
    score_label: "Strong Match",
    due_date: dueDate,
    source_url: `https://example.test/${id}`,
    category: "Janitorial",
    location: "Virginia",
    set_aside: "SBA",
    set_aside_label: "Small Business",
    naics_code: "561720",
    estimated_value: null,
    estimated_value_num: null,
    days_remaining: 1,
    reasons: [],
    qualifications: [],
    requirements: [],
    next_action: "Review the solicitation",
    trade_provenance: null,
    incumbent: null,
    learned: null,
  };
}

function seen(savedAt = new Date(NOW - 60_000).toISOString()): RadarSeen {
  const open = match(1);
  return {
    savedAt,
    answers: { trade: "janitorial", state: "VA", cert: "sb", sizePref: "any" },
    certLabel: "Small Business",
    total: 1,
    seenCount: 1,
    matches: [open],
    sections: { local: [open], nationwide: [], related: [] },
  };
}

describe("freshRadarSeen", () => {
  test("restores a timestamped open result inside the 72-hour window", () => {
    expect(freshRadarSeen(seen(), NOW)?.matches.map((row) => row.id)).toEqual([1]);
  });

  test("fails closed for legacy, stale, future, and malformed timestamps", () => {
    expect(freshRadarSeen({ ...seen(), savedAt: "" }, NOW)).toBeNull();
    expect(freshRadarSeen(seen(new Date(NOW - RADAR_SEEN_MAX_AGE_MS - 1).toISOString()), NOW)).toBeNull();
    expect(freshRadarSeen(seen(new Date(NOW + 1).toISOString()), NOW)).toBeNull();
    expect(freshRadarSeen(seen("not-a-date"), NOW)).toBeNull();
  });

  test("removes closed cards from both the main list and honest buckets", () => {
    const open = match(1, "2026-09-25");
    const closed = match(2, "2026-09-22");
    const snapshot: RadarSeen = {
      ...seen(),
      total: 2,
      seenCount: 2,
      matches: [open, closed],
      sections: { local: [open, closed], nationwide: [closed], related: [closed] },
    };
    const restored = freshRadarSeen(snapshot, NOW);
    expect(restored?.matches.map((row) => row.id)).toEqual([1]);
    expect(restored?.sections.local.map((row) => row.id)).toEqual([1]);
    expect(restored?.sections.nationwide).toEqual([]);
    expect(restored?.sections.related).toEqual([]);
    expect(restored?.total).toBe(1);
    expect(restored?.seenCount).toBe(1);
  });

  test("does not restore when every cached result has closed", () => {
    const closed = match(2, "2026-09-22");
    expect(freshRadarSeen({ ...seen(), matches: [closed], sections: { local: [closed], nationwide: [], related: [] } }, NOW)).toBeNull();
  });
});
