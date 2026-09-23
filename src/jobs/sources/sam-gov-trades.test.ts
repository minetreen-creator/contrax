/**
 * SAM.gov trade-filter passes — janitorial + trucking ingestion
 * (owner PRIORITY 09-21, R1 / R2).
 *
 * DETERMINISTIC, ZERO NETWORK. Every SAM.gov byte read here is a VERBATIM fixture
 * captured from the official API on 2026-09-21 (page payloads trimmed to their
 * first 3 results to keep the repo small — the `page` block, including
 * `totalElements`, is unmodified); the per-opportunity detail endpoint is
 * INJECTED, so the default suite never fetches anything. Live-source validation
 * is a separate, explicitly-invoked check (see the module header of
 * sam-gov-trades.ts and WORKFLOW.md's live-validation gate).
 *
 * PR B2 (fix ④) added the three zero-yield trucking pages — `naics-484110`,
 * `naics-484121`, `naics-484122` — captured VERBATIM on 2026-09-23 (untrimmed:
 * 3, 0 and 1 items), plus two AUTHORED envelope fixtures that reproduce the
 * response shapes an unreadable reply takes. Provenance for every file is in
 * `fixtures/sam-trades/README.md`; the authored ones are labelled as authored.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  JANITORIAL_TRADE_FILTERS,
  SAM_TRADE_FILTERS,
  TRUCKING_TRADE_FILTERS,
  TradeResponseShapeError,
  buildTradeSearchUrl,
  fetchTradeFilter,
  fetchTradeFilterDetailed,
  readSearchEnvelope,
  type SamTradeFilter,
} from "./sam-gov-trades";
import { normalizePsc, type OpportunityDetail } from "./sam-gov";
import { classifyPassOutcome } from "../pass-outcome";

function fixture(name: string): any {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/sam-trades/${name}`, import.meta.url), "utf8"),
  );
}

const NAICS_561720 = fixture("naics-561720-page0.json");
const PSC_S201 = fixture("psc-s201-page0.json");
const NAICS_484210 = fixture("naics-484210-page0.json");
const PSC_V112 = fixture("psc-v112-page0.json");
const PSC_R602 = fixture("psc-r602-page0.json");

const janitorialFilter = JANITORIAL_TRADE_FILTERS.find((f) => f.name === "sam_naics_561720")!;
const pscS201Filter = JANITORIAL_TRADE_FILTERS.find((f) => f.name === "sam_psc_s201")!;

/** A stand-in detail response; the real parse of a saved detail payload is
 *  asserted separately below (see "the saved detail payload yields the PSC"). */
const DETAIL: OpportunityDetail = {
  setAside: "8(a)",
  naicsCode: "541990",
  psc: "S201",
  noticeType: "Solicitation",
  solicitationNumber: "DH-377725",
};

function pageFetcher(page: any) {
  const calls: string[] = [];
  return {
    calls,
    fetchJson: async (url: string) => {
      calls.push(url);
      return page;
    },
  };
}

describe("R1 — the structured filters the API actually honours", () => {
  test("every registered filter is valid and the names are unique", () => {
    expect(SAM_TRADE_FILTERS.length).toBe(JANITORIAL_TRADE_FILTERS.length + TRUCKING_TRADE_FILTERS.length);
    expect(new Set(SAM_TRADE_FILTERS.map((f) => f.name)).size).toBe(SAM_TRADE_FILTERS.length);
    // janitorial = NAICS 561720 + PSC S201 (the CORRECTED mapping — live SAM data
    // shows S201 is the janitorial set and R602 is courier/delivery)
    expect(JANITORIAL_TRADE_FILTERS.map((f) => `${f.kind}=${f.code}`)).toEqual([
      "naics=561720",
      "psc=S201",
    ]);
    expect(TRUCKING_TRADE_FILTERS.map((f) => `${f.kind}=${f.code}`)).toEqual([
      "naics=484110",
      "naics=484121",
      "naics=484122",
      "naics=484210",
      "naics=484220",
      "naics=484230",
      "naics=492110",
      "psc=V112",
      "psc=R602",
    ]);
  });

  test("the URL sends naics=/psc= and NEVER the silently-ignored place-of-performance filter", () => {
    const naicsUrl = buildTradeSearchUrl(janitorialFilter, 0);
    expect(naicsUrl).toContain("naics=561720");
    expect(naicsUrl).toContain("is_active=true");
    expect(naicsUrl).toContain("mode=opportunities");
    expect(naicsUrl).toContain("size=25");
    expect(naicsUrl).not.toContain("placeOfPerformance");
    expect(naicsUrl).not.toContain("state=");
    expect(buildTradeSearchUrl(pscS201Filter, 2)).toContain("psc=S201");
    expect(buildTradeSearchUrl(pscS201Filter, 2)).toContain("page=2");
  });

  test("the saved detail payload yields the PSC / NAICS / solicitation number", () => {
    const detail = fixture("detail-561720.json");
    expect(normalizePsc(detail.data2.classificationCode)).toBe("S201");
    expect(detail.data2.naics[0].code[0]).toBe("561720");
    expect(detail.data2.solicitationNumber).toBe("DH-377725");
  });

  test("normalizePsc accepts real PSCs and rejects junk", () => {
    expect(normalizePsc("s201")).toBe("S201");
    expect(normalizePsc("V112")).toBe("V112");
    expect(normalizePsc("")).toBe(null);
    expect(normalizePsc("561720")).toBe(null);
    expect(normalizePsc(null)).toBe(null);
  });
});

describe("R1/R2 — rows carry the filter's code plus the preserved notice fields", () => {
  test("a naics pass: the code is authoritative, provenance fields are preserved", async () => {
    const { fetchJson, calls } = pageFetcher(NAICS_561720);
    const rows = await fetchTradeFilter(janitorialFilter, {
      fetchJson,
      detailFetcher: async () => DETAIL,
      delayMs: 0,
    });
    // The trimmed fixture holds 3 results (< size 25), so paging stops at page 0.
    expect(calls.length).toBe(1);
    expect(rows.length).toBe(3);
    const items = NAICS_561720._embedded.results;
    rows.forEach((row, i) => {
      const item = items[i];
      expect(row.naics_code).toBe("561720"); // authoritative: the pass filtered on it
      expect(row.psc).toBe("S201"); // from the detail endpoint
      expect(row.notice_type).toBe(item.type.value); // preserved from the summary
      // SAM's own value, preserved (only surrounding whitespace is trimmed)
      expect(row.solicitation_number).toBe(
        item.solicitationNumber == null ? null : String(item.solicitationNumber).trim(),
      );
      expect(row.source_label).toBe("sam_naics_561720");
      expect(row.external_id.startsWith("sam-")).toBe(true);
      expect(row.due_date).toBe(item.responseDate ?? item.responseDateActual ?? null);
      expect(row.source_url).toContain(item.parentNoticeId ?? item._id);
      expect(row.set_aside).toBe("8(a)");
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.agency.length).toBeGreaterThan(0);
      expect(row.location.length).toBeGreaterThan(0);
      expect(row.category.length).toBeGreaterThan(0);
    });
  });

  test("a psc pass: the PSC is authoritative and the NAICS comes from the detail", async () => {
    const { fetchJson } = pageFetcher(PSC_S201);
    const rows = await fetchTradeFilter(pscS201Filter, {
      fetchJson,
      detailFetcher: async () => DETAIL,
      delayMs: 0,
    });
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.psc).toBe("S201");
      expect(row.naics_code).toBe("541990"); // whatever the detail endpoint says
      expect(row.source_label).toBe("sam_psc_s201");
    }
  });

  test("an unanswerable detail response leaves NULL, never a guess", async () => {
    const { fetchJson } = pageFetcher(NAICS_484210);
    const filter = SAM_TRADE_FILTERS.find((f) => f.name === "sam_naics_484210")!;
    const rows = await fetchTradeFilter(filter, {
      fetchJson,
      detailFetcher: async () => ({
        setAside: null,
        naicsCode: null,
        psc: null,
        noticeType: null,
        solicitationNumber: null,
      }),
      delayMs: 0,
    });
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.naics_code).toBe("484210"); // the pass's own filter is authoritative
      expect(row.psc).toBe(null);
      expect(row.set_aside).toBe(null);
      // the summary itself still supplies the notice type + solicitation number
      expect(row.notice_type).not.toBe(null);
      // A solicitation number SAM does not publish stays NULL (never invented).
      expect(
        row.solicitation_number === null || typeof row.solicitation_number === "string",
      ).toBe(true);
    }
  });

  test("paging stops on a short page and walks no further than the cap", async () => {
    const baseItems = NAICS_561720._embedded.results as any[];
    const fullPage = { ...NAICS_561720 };
    fullPage._embedded = {
      results: Array.from({ length: 25 }, (_, i) => ({
        ...baseItems[i % baseItems.length],
        _id: `${baseItems[i % baseItems.length]._id}-${i}`,
      })),
    };
    let served = 0;
    const rows = await fetchTradeFilter(janitorialFilter, {
      fetchJson: async () => {
        served += 1;
        return served === 1 ? fullPage : { _embedded: { results: [] } };
      },
      detailFetcher: async () => DETAIL,
      delayMs: 0,
      maxPages: 4,
    });
    expect(served).toBe(2); // page 0 full, page 1 empty → stop
    expect(rows.length).toBe(25);
  });

  test("the trucking fixtures map into the trucking sources", async () => {
    const cases: [SamTradeFilter, any][] = [
      [SAM_TRADE_FILTERS.find((f) => f.name === "sam_psc_v112")!, PSC_V112],
      [SAM_TRADE_FILTERS.find((f) => f.name === "sam_psc_r602")!, PSC_R602],
    ];
    for (const [filter, page] of cases) {
      const { fetchJson } = pageFetcher(page);
      const rows = await fetchTradeFilter(filter, {
        fetchJson,
        detailFetcher: async () => DETAIL,
        delayMs: 0,
      });
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.psc).toBe(filter.code);
        expect(row.source_label).toBe(filter.name);
      }
    }
    // The R602 pass really is courier/delivery work (the owner-facing correction):
    // its live titles name courier / delivery / transport, never janitorial.
    const r602Titles = (PSC_R602._embedded.results as any[]).map((i) => String(i.title).toLowerCase());
    expect(r602Titles.some((t) => t.includes("courier") || t.includes("delivery"))).toBe(true);
  });
});

describe("R4 (QA F4b) — the pass refuses non-trade notices before they are stamped", () => {
  /** One page whose notices are the LIVE naics=484110 false positives plus a real one. */
  function mixedPage(titles: string[], base: any) {
    return {
      ...base,
      _embedded: {
        results: titles.map((title, i) => ({
          ...base._embedded.results[i % base._embedded.results.length],
          _id: `mixed-${i}`,
          title,
          descriptions: [{ content: "<p>See attached statement of work.</p>" }],
        })),
      },
    };
  }

  const NAICS_484110 = SAM_TRADE_FILTERS.find((f) => f.name === "sam_naics_484110")!;

  test("product / incidental notices never enter the trucking pass", async () => {
    const { fetchJson } = pageFetcher(
      mixedPage(
        [
          "Depot Consumable Parts Processing & Disposal (DEMIL)",
          "Removal of 32 FT Bathroom Trailer",
          "91--Service, Diesel Fuel and Delivery",
          "FREIGHT TIRES",
          "Office Move",
        ],
        NAICS_484210,
      ),
    );
    const res = await fetchTradeFilterDetailed(NAICS_484110, {
      fetchJson,
      detailFetcher: async () => DETAIL,
      delayMs: 0,
    });
    // Only the REAL notice survives — and it keeps the pass's authoritative code.
    expect(res.rows.length).toBe(1);
    expect(res.rows[0]!.title).toBe("Office Move");
    expect(res.rows[0]!.naics_code).toBe("484110");
    expect(res.skipped).toEqual({ product_buy: 4 });
    // every refusal is diagnosed with the notice's own SAM id + reason
    expect(res.skippedRows.length).toBe(4);
    expect(res.skippedRows.every((r) => r.reason === "product_buy" && r.id.length > 0)).toBe(true);
    // fetched = accepted + skipped holds for the pass (run-record contract)
    expect(res.rows.length + Object.values(res.skipped).reduce((a, b) => a + b, 0)).toBe(5);
  });

  test("a dump-truck listing is refused with its own reason", async () => {
    const { fetchJson } = pageFetcher(
      mixedPage(["MORR PURCHASE NEW DUMP TRUCK", "Bldgs 1469 METC Furniture Relocation and Storage"], NAICS_484210),
    );
    const res = await fetchTradeFilterDetailed(NAICS_484110, {
      fetchJson,
      detailFetcher: async () => DETAIL,
      delayMs: 0,
    });
    expect(res.rows.map((r) => r.title)).toEqual(["Bldgs 1469 METC Furniture Relocation and Storage"]);
    expect(res.skipped).toEqual({ dump_truck: 1 });
  });

  test("a janitorial pass refuses a supplies buy and specialty cleaning", async () => {
    const { fetchJson } = pageFetcher(
      mixedPage(
        [
          "Janitorial supplies (restroom paper towels)",
          "Kitchen Hood Cleaning Services",
          "S201--Janitorial Services l Chattanooga National Cemetery",
        ],
        NAICS_561720,
      ),
    );
    const res = await fetchTradeFilterDetailed(janitorialFilter, {
      fetchJson,
      detailFetcher: async () => DETAIL,
      delayMs: 0,
    });
    expect(res.rows.map((r) => r.title)).toEqual([
      "S201--Janitorial Services l Chattanooga National Cemetery",
    ]);
    expect(res.skipped).toEqual({ product_buy: 1, specialty_cleaning_only: 1 });
  });

  test("the committed fixtures are all legitimate trade notices (no fixture is gated out)", async () => {
    const cases: [SamTradeFilter, any][] = [
      [janitorialFilter, NAICS_561720],
      [pscS201Filter, PSC_S201],
      [SAM_TRADE_FILTERS.find((f) => f.name === "sam_naics_484210")!, NAICS_484210],
      [SAM_TRADE_FILTERS.find((f) => f.name === "sam_psc_v112")!, PSC_V112],
      [SAM_TRADE_FILTERS.find((f) => f.name === "sam_psc_r602")!, PSC_R602],
    ];
    for (const [filter, page] of cases) {
      const { fetchJson } = pageFetcher(page);
      const res = await fetchTradeFilterDetailed(filter, {
        fetchJson,
        detailFetcher: async () => DETAIL,
        delayMs: 0,
      });
      const fetched = (page._embedded.results as any[]).length;
      expect(`${filter.name}: ${res.rows.length}/${fetched} kept, skips=${JSON.stringify(res.skipped)}`).toBe(
        `${filter.name}: ${fetched}/${fetched} kept, skips={}`,
      );
    }
  });

  test("the runner receives the skip accounting (source returns the run-record shape)", async () => {
    const { fetchJson } = pageFetcher(
      mixedPage(["Depot Consumable Parts Processing & Disposal (DEMIL)", "Office Move"], NAICS_484210),
    );
    // createSamTradeSource uses the real fetcher; drive the detailed fn directly
    // (same function the source returns) with the injected fixture.
    const res = await fetchTradeFilterDetailed(NAICS_484110, {
      fetchJson,
      detailFetcher: async () => DETAIL,
      delayMs: 0,
    });
    expect(typeof res.skipped).toBe("object");
    expect(Array.isArray(res.skippedRows)).toBe(true);
    expect(Array.isArray(res.rows)).toBe(true);
  });
});

/**
 * FIX ④ (nationwide correctness PR B2) — HONEST ZEROS.
 *
 * The three zero-yield trucking passes failed for three DIFFERENT reasons, and
 * the run record used to present all three as "ran fine, produced nothing"
 * (readiness doc §1.2, measured on `collector_run_log` 24h):
 *
 *   sam_naics_484110  fetched 3, accepted 0, skipped 3 (product_buy) → gate veto
 *   sam_naics_484121  fetched 0, errors 0, ran_zero                → honest empty
 *   sam_naics_484122  fetched 1, accepted 1, inserted 0            → label shift
 *
 * The pins below hold the pass side of that accounting: the verbatim live pages
 * (fixtures/sam-trades/README.md), SAM's own `page.totalElements`, and the
 * `TradeResponseShapeError` that keeps an unreadable payload from being recorded
 * as a clean zero. The outcome words themselves (`all_skipped` / `zero_empty` /
 * `data_error` / `suppressed_duplicate` / `ok`) are pinned in
 * `src/jobs/pass-outcome.test.ts`; the two are joined by the run-record shape
 * assertions here.
 */
describe("FIX ④ — zero-yield passes report WHY, never a success-looking zero", () => {
  const NAICS_484110 = fixture("naics-484110-page0.json");
  const NAICS_484121 = fixture("naics-484121-page0.json");
  const NAICS_484122 = fixture("naics-484122-page0.json");
  const ENVELOPE_ERROR_500 = fixture("envelope-error-500.json");
  const ENVELOPE_COUNT_EMPTY = fixture("envelope-count-empty.json");

  const filter484110 = SAM_TRADE_FILTERS.find((f) => f.name === "sam_naics_484110")!;
  const filter484121 = SAM_TRADE_FILTERS.find((f) => f.name === "sam_naics_484121")!;
  const filter484122 = SAM_TRADE_FILTERS.find((f) => f.name === "sam_naics_484122")!;

  /** One authored page carrying the given TITLES over a committed base page. */
  function titledPage(titles: string[], base: any) {
    return {
      ...base,
      _embedded: {
        results: titles.map((title, i) => ({
          ...base._embedded.results[i % base._embedded.results.length],
          _id: `titled-${i}`,
          title,
          descriptions: [{ content: "<p>See attached statement of work.</p>" }],
        })),
      },
    };
  }

  test("484110 — the verbatim live page: 3 notices in, 0 out, SAM's own total preserved", async () => {
    const { fetchJson } = pageFetcher(NAICS_484110);
    const res = await fetchTradeFilterDetailed(filter484110, {
      fetchJson,
      detailFetcher: async () => DETAIL,
      delayMs: 0,
    });
    // The live page is the whole result set (page.totalElements = 3), so nothing
    // is hidden by the page cap or by paging.
    expect(NAICS_484110.page.totalElements).toBe(3);
    expect(NAICS_484110._embedded.results.length).toBe(3);
    expect(res.rows).toEqual([]);
    expect(res.skipped).toEqual({ product_buy: 3 });
    expect(res.responseTotal).toBe(3); // SAM says it HAD 3 — this is not "nothing"
    // Every refusal names the notice's own SAM identity (parent || _id).
    expect(res.skippedRows.map((r) => r.id).sort()).toEqual(
      [
        "ca7a25d9b8ea4c06bd7f05f5097c50d1",
        "ca7ca0a298d2422b91197d3c95ce5565",
        "e1829bc29d9e4807a20772f1e581daaf",
      ].sort(),
    );
    // run-record shape: fetched 3 = accepted 0 + skipped 3 + failed 0
    const fetched = res.rows.length + Object.values(res.skipped).reduce((a, b) => a + b, 0);
    expect(fetched).toBe(3);
    // ⇒ the run record for this pass classifies as all_skipped (never "found nothing")
    expect(
      classifyPassOutcome({
        source: filter484110.name,
        rows_fetched: fetched,
        accepted_count: res.rows.length,
        skipped_count: Object.values(res.skipped).reduce((a, b) => a + b, 0),
        failed_count: 0,
        rows_new: 0,
        errors: 0,
        skip_reasons: res.skipped,
      }).outcome,
    ).toBe("all_skipped");
  });

  test("484110 is NOT structurally incapable — real trucking-RFP titles still enter", async () => {
    // Reachability control. Every title below is REAL (Office Move and the METC
    // relocation notice are committed fixtures; the Linehaul notice is the live
    // naics=484122 capture; the courier notice is committed in psc-r602).
    const { fetchJson } = pageFetcher(
      titledPage(
        [
          "Office Move",
          "Bldgs 1469, 1475, 1479 METC Furniture Relocation and Storage",
          "SV26.2 Linehaul, MHE, AGWASH Services",
          "1 SOMDG Medical Courier Services",
        ],
        NAICS_484210,
      ),
    );
    const res = await fetchTradeFilterDetailed(filter484110, {
      fetchJson,
      detailFetcher: async () => DETAIL,
      delayMs: 0,
    });
    expect(res.rows.map((r) => r.title)).toEqual([
      "Office Move",
      "Bldgs 1469, 1475, 1479 METC Furniture Relocation and Storage",
      "SV26.2 Linehaul, MHE, AGWASH Services",
      "1 SOMDG Medical Courier Services",
    ]);
    expect(res.skipped).toEqual({});
    // …and they keep the pass's own authoritative code (the pass DID yield).
    for (const row of res.rows) expect(row.naics_code).toBe("484110");
    // The owner-pinned product/disposal titles stay refused (unchanged gate —
    // src/lib/janitorial-trucking.test.ts:264-266).
    const stillRefused = await fetchTradeFilterDetailed(filter484110, {
      fetchJson: pageFetcher(titledPage(NAICS_484110._embedded.results.map((i: any) => i.title), NAICS_484210))
        .fetchJson,
      detailFetcher: async () => DETAIL,
      delayMs: 0,
    });
    expect(stillRefused.rows).toEqual([]);
    expect(stillRefused.skipped).toEqual({ product_buy: 3 });
  });

  test("484121 — the verbatim live page IS an honest empty (SAM reports zero matches)", async () => {
    // The live response carries NO `_embedded` key at all and totalElements 0 —
    // that is SAM saying "zero active notices for naics=484121", not a swallowed
    // error body. Verified live 2026-09-23 (fixtures README).
    expect("_embedded" in NAICS_484121).toBe(false);
    expect(NAICS_484121.page).toMatchObject({ size: 0, totalElements: 0, totalPages: 0 });
    const { fetchJson, calls } = pageFetcher(NAICS_484121);
    const res = await fetchTradeFilterDetailed(filter484121, {
      fetchJson,
      detailFetcher: async () => DETAIL,
      delayMs: 0,
    });
    expect(calls.length).toBe(1); // one page, then the loop ends
    expect(res.rows).toEqual([]);
    expect(res.skipped).toEqual({});
    expect(res.skippedRows).toEqual([]);
    expect(res.responseTotal).toBe(0); // SAM's own count — the honest zero
    expect(
      classifyPassOutcome({
        source: filter484121.name,
        rows_fetched: 0,
        accepted_count: 0,
        skipped_count: 0,
        failed_count: 0,
        rows_new: 0,
        errors: 0,
        ran_zero: true,
        skip_reasons: {},
      }).outcome,
    ).toBe("zero_empty");
  });

  test("484121 — an unreadable page-0 payload THROWS (→ run-record errors → data_error)", async () => {
    // An error envelope (authored: a Spring whitelabel 5xx body) carries neither
    // `_embedded.results` nor `page.totalElements`.
    await expect(
      fetchTradeFilterDetailed(filter484121, {
        fetchJson: async () => ENVELOPE_ERROR_500,
        detailFetcher: async () => DETAIL,
        delayMs: 0,
      }),
    ).rejects.toThrow(TradeResponseShapeError);
    // SAM contradicting itself (totalElements 3, results []) is equally unreadable.
    await expect(
      fetchTradeFilterDetailed(filter484121, {
        fetchJson: async () => ENVELOPE_COUNT_EMPTY,
        detailFetcher: async () => DETAIL,
        delayMs: 0,
      }),
    ).rejects.toThrow(/SAM reports 3 matching notice\(s\) but returned an empty results array/);

    // What the runner records for such a pass is fetched 0 + 1 error — and that
    // record is data_error, NEVER zero_empty (fix ② blindness closed).
    const error = new TradeResponseShapeError(
      `${filter484121.name}: unreadable SAM.gov search response — no results array`,
    );
    expect(error.name).toBe("TradeResponseShapeError");
    expect(error.code).toBe("sam_trade_response_shape");
    expect(error.message).toContain("unreadable SAM.gov search response");
    expect(readSearchEnvelope(ENVELOPE_ERROR_500)).toEqual({
      ok: false,
      reason: "no `_embedded.results` array and no `page.totalElements` — not a SAM.gov v1 search envelope",
    });
    expect(
      classifyPassOutcome({
        source: filter484121.name,
        rows_fetched: 0,
        accepted_count: 0,
        skipped_count: 0,
        failed_count: 0,
        rows_new: 0,
        errors: 1,
        ran_zero: true,
        skip_reasons: {},
      }).outcome,
    ).toBe("data_error");
  });

  test("a mis-shapen page AFTER a good page-0 is an end-of-results, never a silent truncation", async () => {
    const baseItems = NAICS_561720._embedded.results as any[];
    const fullPage = {
      ...NAICS_561720,
      _embedded: {
        results: Array.from({ length: 25 }, (_, i) => ({
          ...baseItems[i % baseItems.length],
          _id: `${baseItems[i % baseItems.length]._id}-${i}`,
        })),
      },
    };
    let served = 0;
    const res = await fetchTradeFilterDetailed(janitorialFilter, {
      fetchJson: async () => {
        served += 1;
        return served === 1 ? fullPage : ENVELOPE_ERROR_500;
      },
      detailFetcher: async () => DETAIL,
      delayMs: 0,
      maxPages: 4,
    });
    expect(served).toBe(2);
    expect(res.rows.length).toBe(25); // page 0's rows are kept
    expect(res.responseTotal).toBe(NAICS_561720.page.totalElements);
  });

  test("readSearchEnvelope: what counts as usable, honest-empty and unusable", () => {
    // usable
    const good = readSearchEnvelope(NAICS_484110);
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.envelope.items.length).toBe(3);
      expect(good.envelope.totalElements).toBe(3);
    }
    // honest empty (no `_embedded`, totalElements 0)
    const empty = readSearchEnvelope(NAICS_484121);
    expect(empty.ok).toBe(true);
    if (empty.ok) {
      expect(empty.envelope.items).toEqual([]);
      expect(empty.envelope.totalElements).toBe(0);
    }
    // usable with no page block at all (an empty `results` array is enough)
    expect(readSearchEnvelope({ _embedded: { results: [] } })).toEqual({
      ok: true,
      envelope: { items: [], totalElements: null },
    });
    // unusable
    expect(readSearchEnvelope(null).ok).toBe(false);
    expect(readSearchEnvelope("<html>502 Bad Gateway</html>").ok).toBe(false);
    expect(readSearchEnvelope({ _embedded: {} }).ok).toBe(false);
    expect(readSearchEnvelope(ENVELOPE_COUNT_EMPTY).ok).toBe(false);
  });

  test("484122 — the verbatim live page maps one real trucking notice (label shift, not a fetch bug)", async () => {
    expect(NAICS_484122.page.totalElements).toBe(1);
    const item = NAICS_484122._embedded.results[0];
    expect(item.title).toBe("SV26.2 Linehaul, MHE, AGWASH Services");
    expect(item.solicitationNumber).toBe("W912CL-26-Q-A033");
    expect(item.parentNoticeId).toBe("81ccc8f3abff4074826cd14064221151");
    const { fetchJson } = pageFetcher(NAICS_484122);
    const res = await fetchTradeFilterDetailed(filter484122, {
      fetchJson,
      detailFetcher: async () => DETAIL,
      delayMs: 0,
    });
    expect(res.rows.length).toBe(1);
    expect(res.rows[0]!.title).toBe("SV26.2 Linehaul, MHE, AGWASH Services");
    expect(res.rows[0]!.naics_code).toBe("484122"); // the pass's own code, authoritative
    expect(res.rows[0]!.source_label).toBe("sam_naics_484122");
    expect(res.skipped).toEqual({});
    expect(res.responseTotal).toBe(1);
    // The row is NOT lost and NOT refused by the pass — it is suppressed at
    // INSERT time because the same notice is already stored (in production,
    // under `sam_gov`). The run record therefore has accepted = 1, new = 0.
    expect(
      classifyPassOutcome({
        source: filter484122.name,
        rows_fetched: 1,
        accepted_count: 1,
        skipped_count: 0,
        failed_count: 0,
        rows_new: 0,
        errors: 0,
        skip_reasons: {},
      }).outcome,
    ).toBe("suppressed_duplicate");
    // …and when the notice IS new to the corpus, the same pass reads `ok`.
    expect(
      classifyPassOutcome({
        source: filter484122.name,
        rows_fetched: 1,
        accepted_count: 1,
        skipped_count: 0,
        failed_count: 0,
        rows_new: 1,
        errors: 0,
        skip_reasons: {},
      }).outcome,
    ).toBe("ok");
  });
});
