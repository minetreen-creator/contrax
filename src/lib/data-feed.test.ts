import { describe, expect, test } from "bun:test";
import {
  contraxBidUrl,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  GOVERNMENT_ONLY_EXCLUSIONS,
  parseFeedQuery,
  parseSourceExclusions,
  refCodeForEmail,
  toFeedRow,
} from "./data-feed";

const q = (s: string) => parseFeedQuery(new URLSearchParams(s));

describe("data feed query (owner 2026-10-06)", () => {
  test("defaults", () => {
    expect(q("")).toEqual({ ok: true, query: { states: [], updatedSince: null, naics: [], setAside: null, categories: [], limit: FEED_DEFAULT_LIMIT, after: 0 } });
  });

  test("filters parse and normalize", () => {
    const r = q("state=va,ri&updated_since=2026-10-01&naics=2382,561720&set_aside=SDVOSB&limit=500&after=42");
    expect(r).toEqual({
      ok: true,
      query: { states: ["VA", "RI"], updatedSince: "2026-10-01T00:00:00.000Z", naics: ["2382", "561720"], setAside: "SDVOSB", categories: [], limit: FEED_MAX_LIMIT, after: 42 },
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
      contrax_url: "https://www.contrax.company/bid/7",
    });
  });
});

describe("partner licensing (owner 2026-10-22)", () => {
  test("trade filter: known Contrax categories only", () => {
    const ok = q("category=Janitorial,Plumbing %26 Electrical");
    expect(ok.ok && ok.query.categories).toEqual(["Janitorial", "Plumbing & Electrical"]);
    const bad = q("category=Roofing");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("Unknown category");
  });

  test("each row links to Contrax with the partner's referral code", () => {
    expect(contraxBidUrl(42, "usesettle")).toBe("https://www.contrax.company/bid/42?ref=usesettle");
    expect(toFeedRow({ id: 9, title: "t", agency: "a", source: "s" }, "usesettle").contrax_url).toBe(
      "https://www.contrax.company/bid/9?ref=usesettle",
    );
    expect(refCodeForEmail("dilan@usesettle.com")).toBe("usesettle");
    expect(refCodeForEmail("someone@gmail.com")).toBeNull();
  });

  test("source exclusions are LIKE patterns; anything else is dropped", () => {
    expect(GOVERNMENT_ONLY_EXCLUSIONS).toEqual(["%_bidnet"]);
    expect(parseSourceExclusions("%_bidnet, tx_esbd")).toEqual(["%_bidnet", "tx_esbd"]);
    expect(parseSourceExclusions("x'; DROP TABLE bids;--")).toEqual([]);
    expect(parseSourceExclusions(null)).toEqual([]);
  });
});
