/**
 * State-keyword "doors" (+ the `cities` keyword source) — nationwide
 * correctness FIX ⑤ step A pins, plus the cross-door half of step B.
 *
 * DETERMINISTIC, ZERO NETWORK, NO DATABASE. Every SAM.gov byte read here is a
 * committed fixture: three v1 search pages and one v2 detail payload under
 * `fixtures/state-keyword/` (provenance, byte sizes and what is verbatim vs
 * adapted: `fixtures/state-keyword/README.md`), plus the repository's already
 * committed verbatim v2 payload `fixtures/sam-trades/detail-561720.json`. The
 * page fetcher AND the detail fetcher are injected, so an accidental live call
 * is impossible: the injected detail fetcher is the ONLY detail source, and a
 * notice id it does not know returns the empty payload.
 *
 * What the pins defend:
 *   - the search URL shape is UNCHANGED (`q=<StateName>`, size 25, page 0,
 *     is_active=true, no `state=`/`psc=`/`naics=` filter) — FIX ⑤ must not widen
 *     or narrow what a door asks SAM.gov for;
 *   - location keeps place-of-performance precedence and the honest "Unknown"
 *     fallback, and is NEVER the query state;
 *   - the metadata the door already fetched (PSC / notice type / solicitation
 *     number) is now stored, from the SAME single detail request per notice;
 *   - `external_id` is the canonical `sam-<parentNoticeId || _id>` and the run
 *     guard's `notice_key` is the same identity, so two doors that see one
 *     notice produce ONE accepted row (the real cross-door duplication pattern:
 *     census Q14 group 1 = the same notice stored by 16 jurisdictions);
 *   - NAICS stays inference-only (`naics_code_source='inferred'`): the door
 *     never copies the detail's NAICS as an authoritative code, and set_aside
 *     stays NULL (that is the owner-gated cert-matching decision, option E).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { inferNaics } from "~/lib/naics-infer";
import {
  applyRunNoticeGuard,
  createNoticeIdentityGuard,
} from "../notice-identity";
import {
  parseOpportunityDetail,
  type OpportunityDetailWithLocation,
} from "./sam-gov";
import { createStateKeywordSource } from "./state-keyword";
import { fetchBids as fetchCities } from "./cities";

const DIR = new URL("./fixtures/state-keyword/", import.meta.url);
function jsonFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, DIR), "utf8")) as T;
}

/** The multi-state notice: returned by the Florida AND the Virginia door query
 *  (the live group-1 pattern — see the fixture README). */
const MULTI_ID = "5c1e0f7a2d8b4a1e9f3c6b0d847a2e51";
/** A real award notice that names only Florida (and no location SAM can pin). */
const HOMESTEAD_ID = "c3b14ddce163426288dc9957bb38692e";
/** The real Fermilab notice's parent — its identity is the parentNoticeId. */
const FERMILAB_PARENT = "7a176367f4944d2a91f948411bba07c1";

const FL_PAGE = jsonFixture("doors-florida-page0.json");
const VA_PAGE = jsonFixture("doors-virginia-page0.json");
const IL_PAGE = jsonFixture("doors-illinois-page0.json");
const MULTI_DETAIL = jsonFixture<any>("detail-multistate.json");
const FERMILAB_DETAIL = JSON.parse(
  readFileSync(new URL("./fixtures/sam-trades/detail-561720.json", import.meta.url), "utf8"),
);

const EMPTY_DETAIL: OpportunityDetailWithLocation = {
  setAside: null,
  naicsCode: null,
  psc: null,
  noticeType: null,
  solicitationNumber: null,
  placeOfPerformance: null,
};

/** Saved v2 payloads by notice id — the only detail source in this file. */
const DETAILS: Record<string, any> = {
  [MULTI_ID]: MULTI_DETAIL,
  [FERMILAB_PARENT]: FERMILAB_DETAIL,
};

let detailCalls: string[] = [];
async function detailFetcher(noticeId: string): Promise<OpportunityDetailWithLocation> {
  detailCalls.push(noticeId);
  const saved = DETAILS[noticeId];
  return saved ? parseOpportunityDetail(saved) : { ...EMPTY_DETAIL };
}

/** One door with an injected page + detail source (zero network). */
function door(stateName: string, abbr: string, page: any) {
  const urls: string[] = [];
  const fetchFn = createStateKeywordSource(stateName, abbr, {
    detailDelayMs: 0,
    fetchJson: async (url: string) => {
      urls.push(url);
      return page;
    },
    detailFetcher,
  });
  return { fetchFn, urls };
}

function batch(rows: any[]) {
  return { rows, skipped: {} as Record<string, number>, skippedRows: [] as { id: string; reason: string }[] };
}

describe("state-keyword doors — FIX ⑤ step A row shape", () => {
  test("the search URL shape is unchanged (q=<StateName>, size 25, page 0, is_active, no state=/psc=/naics= filter)", async () => {
    const { fetchFn, urls } = door("Florida", "FL", FL_PAGE);
    await fetchFn();
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe(
      "https://sam.gov/api/prod/sgs/v1/search/?page=0&size=25&sort=-modifiedDate&mode=opportunities&q=Florida&is_active=true",
    );
    expect(urls[0]).not.toContain("state=");
    expect(urls[0]).not.toContain("psc=");
    expect(urls[0]).not.toContain("naics=");
  });

  test("location keeps place-of-performance precedence and is never the query state", async () => {
    const fl = await door("Florida", "FL", FL_PAGE).fetchFn();
    const va = await door("Virginia", "VA", VA_PAGE).fetchFn();
    const flMulti = fl.find((r) => r.notice_key === MULTI_ID)!;
    const vaMulti = va.find((r) => r.notice_key === MULTI_ID)!;
    // The saved v2 payload's placeOfPerformance is Annapolis, MD — neither door's
    // query state, so the door can only have used the detail POP.
    expect(MULTI_DETAIL.data2.placeOfPerformance.state).toEqual({ code: "MD", name: "Maryland" });
    expect(flMulti.location).toBe("Annapolis, MD");
    expect(vaMulti.location).toBe("Annapolis, MD");
    expect(flMulti.location).not.toContain("Florida");
    expect(vaMulti.location).not.toContain("Virginia");
  });

  test('location falls back to "Unknown" (never the query state) when the notice has no place of performance', async () => {
    const fl = await door("Florida", "FL", FL_PAGE).fetchFn();
    const homestead = fl.find((r) => r.notice_key === HOMESTEAD_ID)!;
    expect(homestead.title).toContain("Homestead ARB");
    expect(homestead.location).toBe("Unknown");
    expect(homestead.location).not.toContain("Florida");
  });

  test("psc / notice_type / solicitation_number come from the already-fetched v2 detail + the summary", async () => {
    const fl = await door("Florida", "FL", FL_PAGE).fetchFn();
    const multi = fl.find((r) => r.notice_key === MULTI_ID)!;
    expect(multi.psc).toBe("Z111"); // data2.classificationCode
    // the summary's human label wins over the detail's raw code ("k")
    expect(multi.notice_type).toBe("Combined Synopsis/Solicitation");
    expect(multi.solicitation_number).toBe("N4008526R0219");
    // untouched behaviour: category, due_date, estimated_value, agency, source_url
    expect(multi.due_date).toBe("2026-10-20T00:00:00+00:00");
    expect(multi.estimated_value).toBe("Not specified");
    expect(multi.agency).toBe("N40085 NAVFAC MID-ATLANTIC");
    expect(multi.category).toBeTruthy();
    expect(multi.source_url).toBe(`https://sam.gov/opp/${MULTI_ID}/view`);
  });

  test("a real v2 payload (Fermilab / S201) fills the Illinois door's provenance from the same one request", async () => {
    const il = await door("Illinois", "IL", IL_PAGE).fetchFn();
    expect(il).toHaveLength(1);
    const r = il[0];
    expect(r.external_id).toBe(`sam-${FERMILAB_PARENT}`); // parentNoticeId || _id
    expect(r.notice_key).toBe(FERMILAB_PARENT);
    expect(r.psc).toBe("S201");
    expect(r.notice_type).toBe("Solicitation");
    expect(r.solicitation_number).toBe("DH-377725");
    expect(r.location).toBe("IL"); // authoritative POP state from the real payload
  });

  test("canonical external_id is `sam-<noticeId>` and identical across the doors", async () => {
    const fl = await door("Florida", "FL", FL_PAGE).fetchFn();
    const va = await door("Virginia", "VA", VA_PAGE).fetchFn();
    const flMulti = fl.find((r) => r.notice_key === MULTI_ID)!;
    const vaMulti = va.find((r) => r.notice_key === MULTI_ID)!;
    expect(flMulti.external_id).toBe(`sam-${MULTI_ID}`);
    expect(vaMulti.external_id).toBe(flMulti.external_id);
    // the former per-door `<st>-<_id>` prefix is gone
    expect(flMulti.external_id.startsWith("fl-")).toBe(false);
  });

  test("step A adds NO network call: exactly one v2 detail request per fetched notice", async () => {
    detailCalls = [];
    const fl = await door("Florida", "FL", FL_PAGE).fetchFn();
    expect(fl).toHaveLength(2);
    expect(detailCalls).toEqual([MULTI_ID, HOMESTEAD_ID]);
  });

  test("NAICS stays inference-only and set_aside stays NULL (never invented)", async () => {
    const fl = await door("Florida", "FL", FL_PAGE).fetchFn();
    for (const row of fl) {
      // the saved v2 payload carries naics [238220] — the door must NOT adopt it
      expect(row.naics_code ?? null).toBeNull();
      expect(row.set_aside ?? null).toBeNull();
    }
    // the runner's rule (runner.ts): bid.naics_code ? 'authoritative' : code ? 'inferred' : null
    const il = await door("Illinois", "IL", IL_PAGE).fetchFn();
    const housekeeping = il[0];
    expect(housekeeping.naics_code ?? null).toBeNull();
    const inferred = inferNaics(housekeeping.title, housekeeping.description);
    expect(inferred).toBeTruthy();
    expect(housekeeping.naics_code ? "authoritative" : inferred ? "inferred" : null).toBe("inferred");
  });
});

describe("state-keyword doors — FIX ⑤ step B cross-door guard", () => {
  test("two doors that see the same notice accept ONE row; the other is a visible skip", async () => {
    const guard = createNoticeIdentityGuard();
    const flRows = await door("Florida", "FL", FL_PAGE).fetchFn();
    const vaRows = await door("Virginia", "VA", VA_PAGE).fetchFn();
    expect(flRows.map((r) => r.notice_key)).toEqual([MULTI_ID, HOMESTEAD_ID]);
    expect(vaRows.map((r) => r.notice_key)).toEqual([MULTI_ID]);

    const fl = applyRunNoticeGuard(batch(flRows), guard);
    const va = applyRunNoticeGuard(batch(vaRows), guard);

    expect(fl.rows.map((r) => r.notice_key)).toEqual([MULTI_ID, HOMESTEAD_ID]);
    expect(fl.skippedCount).toBe(0);
    // the second door's copy of the same notice is the one suppressed
    expect(va.rows).toHaveLength(0);
    expect(va.skipped).toEqual({ duplicate_notice: 1 });
    expect(va.skippedRows).toEqual([{ id: MULTI_ID, reason: "duplicate_notice" }]);
    // run-record invariant: fetched = rows + skipped (the skipped row is not lost)
    expect(va.fetchedCount).toBe(1);
    expect(va.fetchedCount).toBe(va.rows.length + va.skippedCount);
    // the guard kept its rows intact for the sources that follow
    const later = applyRunNoticeGuard(batch(vaRows), guard);
    expect(later.rows).toHaveLength(0);
    expect(later.skipped).toEqual({ duplicate_notice: 1 });
  });
});

describe("cities keyword source — same SAM-family contract", () => {
  test("URLs unchanged; summary provenance + canonical id; psc/naics stay NULL (no detail request)", async () => {
    const urls: string[] = [];
    const rows = await fetchCities({
      delayMs: 0,
      fetchJson: async (url: string) => {
        urls.push(url);
        return FL_PAGE;
      },
    });
    expect(urls.map((u) => u.match(/[?&]q=([^&]*)/)?.[1])).toEqual(["City%20of", "County%20of", "Metropolitan"]);
    expect(urls.every((u) => u.includes("page=0&size=25") && u.includes("is_active=true"))).toBe(true);
    expect(rows).toHaveLength(6); // 2 notices × 3 keywords
    const multi = rows[0];
    expect(multi.external_id).toBe(`sam-${MULTI_ID}`);
    expect(multi.notice_key).toBe(MULTI_ID);
    expect(multi.notice_type).toBe("Combined Synopsis/Solicitation");
    expect(multi.solicitation_number).toBe("N4008526R0219");
    expect(multi.psc ?? null).toBeNull();
    expect(multi.naics_code ?? null).toBeNull();
    expect(multi.set_aside ?? null).toBeNull();
    // the three keyword fetches return the same federal notice three times: the
    // run guard collapses them to one accepted row per notice
    const guard = createNoticeIdentityGuard();
    const g = applyRunNoticeGuard(batch(rows), guard);
    expect(g.rows.map((r) => r.notice_key)).toEqual([MULTI_ID, HOMESTEAD_ID]);
    expect(g.skipped).toEqual({ duplicate_notice: 4 });
    expect(g.fetchedCount).toBe(6);
    expect(g.fetchedCount).toBe(g.rows.length + g.skippedCount);
  });

  test("a space-padded SAM solicitation number is trimmed, never stored raw", async () => {
    const page = {
      _embedded: {
        results: [
          {
            _id: "1f2e3d4c5b6a79880716253443526170",
            title: "County of Example — Custodial Services",
            type: { code: "o", value: "Solicitation" },
            descriptions: [{ content: "<p>Custodial services for county buildings.</p>" }],
            solicitationNumber: "  RFP-2026-114  ",
            responseDate: "2026-11-01T00:00:00+00:00",
            organizationHierarchy: [{ name: "EXAMPLE COUNTY" }],
          },
        ],
      },
    };
    const rows = await fetchCities({ delayMs: 0, fetchJson: async () => page });
    const row = rows[0];
    expect(row.solicitation_number).toBe("RFP-2026-114");
    expect(row.external_id).toBe("sam-1f2e3d4c5b6a79880716253443526170");
    expect(row.notice_type).toBe("Solicitation");
  });
});
