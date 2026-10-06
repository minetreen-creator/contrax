import { describe, expect, test } from "bun:test";
import { FEED_DEFAULT_LIMIT, FEED_MAX_LIMIT, parseFeedQuery, toFeedRow } from "./data-feed";

const q = (s: string) => parseFeedQuery(new URLSearchParams(s));

describe("data feed query (owner 2026-10-06)", () => {
  test("defaults", () => {
    expect(q("")).toEqual({ ok: true, query: { states: [], updatedSince: null, naics: [], setAside: null, limit: FEED_DEFAULT_LIMIT, after: 0 } });
  });

  test("filters parse and normalize", () => {
    const r = q("state=va,ri&updated_since=2026-10-01&naics=2382,561720&set_aside=SDVOSB&limit=500&after=42");
    expect(r).toEqual({
      ok: true,
      query: { states: ["VA", "RI"], updatedSince: "2026-10-01T00:00:00.000Z", naics: ["2382", "561720"], setAside: "SDVOSB", limit: FEED_MAX_LIMIT, after: 42 },
    });
  });

  test("bad input gets a clear 400 message", () => {
    for (const s of ["state=XX", "updated_since=soon", "naics=23a", "naics=1234567", "limit=0", "limit=501", "limit=2.5", "after=-1", `set_aside=${"x".repeat(41)}`]) {
      const r = q(s);
      expect(r.ok).toBe(false);
    }
  });

  test("rows map to the documented field names", () => {
    const row = toFeedRow({
      id: "7", title: "T", agency: "A", description: "", normalized_state: "RI", location: "Rhode Island", category: "Construction",
      naics_code: null, psc: null, set_aside: "SDVOSB", notice_type: "RFP", solicitation_number: "X1",
      due_date: new Date("2026-10-23T17:00:00Z"), estimated_value: "Not specified", source_url: "https://example.gov/x", source: "ri_osp",
      created_at: "2026-10-06T14:00:00Z", updated_at: null,
    });
    expect(row).toEqual({
      id: 7, title: "T", agency: "A", description: null, state: "RI", location: "Rhode Island", category: "Construction",
      naics_code: null, psc: null, set_aside: "SDVOSB", notice_type: "RFP", solicitation_number: "X1",
      due_date: "2026-10-23T17:00:00.000Z", estimated_value: "Not specified", source_url: "https://example.gov/x", source: "ri_osp",
      first_seen_at: "2026-10-06T14:00:00.000Z", updated_at: null,
    });
  });
});
