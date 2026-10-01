/**
 * Shared profile matching (profile-match.ts): state bids reach logged-in
 * feeds. Pure — the SQL predicate is decoded from a payload-shaped stub (the
 * same technique as radar-search.regression.test.ts), never executed.
 */
import { describe, expect, test } from "bun:test";
import {
  bidInStates,
  profileNaicsCodes,
  profileStateCodes,
  profileTradeExpansions,
  profileTradePred,
  profileTradeTerms,
} from "./profile-match";

function stubSql(): any {
  const tag: any = (strings: readonly string[], ...values: any[]) => ({ queryData: { strings, values } });
  tag.unsafe = (fragment: string) => ({ queryData: { strings: [fragment], values: [] } });
  return tag;
}
/** Every SQL text piece and bound value inside a (nested) fragment. */
function flatten(frag: any): { text: string; values: unknown[] } {
  const parts: string[] = [];
  const values: unknown[] = [];
  const walk = (f: any) => {
    const { strings, values: vals } = f.queryData;
    strings.forEach((s: string, i: number) => {
      parts.push(s);
      if (i < vals.length) {
        const v = vals[i];
        if (v && typeof v === "object" && "queryData" in v) walk(v);
        else {
          values.push(v);
          parts.push("?");
        }
      }
    });
  };
  walk(frag);
  return { text: parts.join(""), values };
}

describe("states — full state names count, not only 'City, ST'", () => {
  test("state portal locations match their state", () => {
    expect(bidInStates("Hamilton County, Ohio", "Ohio Department of Transportation", ["OH"])).toBe(true);
    expect(bidInStates("Ohio", null, ["OH"])).toBe(true);
    expect(bidInStates("Columbus, OH", null, ["OH"])).toBe(true); // the old rule still holds
    expect(bidInStates("Richmond, VA", null, ["OH"])).toBe(false);
    expect(bidInStates("Texas", null, ["OH", "PA"])).toBe(false);
  });

  test("no states, or every state, is no filter", () => {
    expect(bidInStates("Texas", null, [])).toBe(true);
    expect(profileStateCodes(["oh", "Ohio", "Pennsylvania", "zz"])).toEqual(["OH", "PA"]);
  });
});

describe("trade — state bids without NAICS match by trade words", () => {
  test("NAICS codes bring their curated trade words", () => {
    expect(profileNaicsCodes({ naics_codes: ["561720", "abc", 561720] })).toEqual(["561720"]);
    const terms = profileTradeTerms(profileTradeExpansions({ naics_codes: ["561720"] }));
    expect(terms).toContain("janitorial");
    expect(terms).toContain("custodial");
  });

  test("typed trade words add to the codes", () => {
    const terms = profileTradeTerms(profileTradeExpansions({ naics_codes: ["561720"], industry: "trucking" }));
    expect(terms).toContain("janitorial");
    expect(terms).toContain("trucking");
  });

  test("the SQL keeps NAICS bids on the profile's codes and lets NAICS-less bids match by text", () => {
    const { text, values } = flatten(profileTradePred({ naics_codes: ["561720"] }, stubSql));
    expect(text).toContain("naics_code = ANY(?)");
    expect(text).toContain("COALESCE(naics_code,'') = ''");
    expect(text).toContain("LOWER(COALESCE(title,'')) LIKE ?");
    expect(values).toContainEqual(["561720"]);
    expect(values).toContain("%janitorial%");
  });

  test("a profile without NAICS codes keeps no trade filter (unchanged)", () => {
    const { text, values } = flatten(profileTradePred({ industry: "janitorial" }, stubSql));
    expect(text).toBe("");
    expect(values).toEqual([]);
  });
});
