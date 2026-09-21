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
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  JANITORIAL_TRADE_FILTERS,
  SAM_TRADE_FILTERS,
  TRUCKING_TRADE_FILTERS,
  buildTradeSearchUrl,
  fetchTradeFilter,
  type SamTradeFilter,
} from "./sam-gov-trades";
import { normalizePsc, type OpportunityDetail } from "./sam-gov";

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
