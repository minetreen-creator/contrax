/**
 * eVA — Virginia Business Opportunities (`va_eva`) connector pins.
 *
 * DETERMINISTIC, ZERO NETWORK, NO DATABASE. The fixtures are VERBATIM eVA
 * `solrconnect.jsp` responses captured on 2026-10-01 (see
 * fixtures/va-eva/README.md). `parseEvaDocs` is pure and takes an injected
 * reference instant, so nothing here depends on the wall clock.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import {
  EVA_MIN_BODY_BYTES,
  EVA_OPEN_QUERY,
  EVA_PAGE_SIZE,
  VA_EVA_COPY,
  VA_EVA_DUE_DATE_ZONE_UNVERIFIED,
  evaDetailUrl,
  evaLocation,
  evaQueryUrl,
  evaSetAside,
  fetchVaEvaBids,
  fixMojibake,
  parseEvaDocs,
  vaEvaCountLine,
  type EvaDoc,
  type EvaSolrResponse,
} from "./va-eva";

const fixture = (name: string): EvaSolrResponse =>
  JSON.parse(readFileSync(new URL(`./fixtures/va-eva/${name}`, import.meta.url), "utf8"));

/** The 2026-10-08 capture: rows in these fixtures were open at this moment. */
const CAPTURED_1008 = Date.parse("2026-10-08T00:50:00Z");

// The capture instant: every fixture row was open at this moment.
const CAPTURED = Date.parse("2026-10-01T12:24:00Z");

describe("va_eva — eVA open-opportunity parse (verbatim fixtures)", () => {
  test("the Norfolk Airport security RFP and the Port Authority IFB are ingested", () => {
    const docs = fixture("airport-port-2026-10-01.json").response!.docs!;
    const { rows, skipped } = parseEvaDocs(docs, CAPTURED);
    expect(skipped).toEqual({});
    expect(rows.length).toBe(3);

    const security = rows.find((r) => r.external_id === "eva-IV128951")!;
    expect(security.title).toBe("Unarmed Security Guard and Patrol Services RFP FY27-800-02");
    expect(security.agency).toBe("Norfolk Airport Authority");
    expect(security.location).toBe("Norfolk Airport Authority, Norfolk Virginia");
    expect(security.due_date).toBe("2026-10-12T14:00:00.000Z");
    expect(security.notice_type).toBe("Request for Proposals (RFP)");
    expect(security.set_aside).toBeNull();
    expect(security.source_url).toBe(
      "https://mvendor.cgieva.com/Vendor/public/IVDetails.jsp?PageTitle=SO%20Details&rfp_id_lot=128951&rfp_id_round=1",
    );

    const port = rows.find((r) => r.agency === "Virginia Port Authority")!;
    expect(port.title).toBe("IFB #2027-08-VPA Records Emergency Response Services");
    expect(port.location).toBe("Hampton Roads, VA");

    // workloc names no state → the buyer's own text + ", Virginia"
    const auction = rows.find((r) => r.external_id === "eva-IV127866")!;
    expect(auction.location).toBe("Norfolk Airport Authority, Virginia");
  });

  test("a full page of open rows parses with honest fields and no fabricated codes", () => {
    const body = fixture("open-page1-rows25-2026-10-01.json");
    const { rows, skipped } = parseEvaDocs(body.response!.docs!, CAPTURED);
    const total = rows.length + Object.values(skipped).reduce((a, b) => a + b, 0);
    expect(total).toBe(25);
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^eva-[A-Z]+[\d:A-Z]+/);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.agency.length).toBeGreaterThan(0);
      expect(r.source_url.startsWith("https://mvendor.cgieva.com/Vendor/public/")).toBe(true);
      expect(r.naics_code).toBeNull();
      expect(r.psc).toBeNull();
      expect(r.solicitation_number).toBeNull();
      // nothing double-encoded survives
      expect(`${r.title} ${r.description} ${r.location}`).not.toMatch(/â\u0080/);
      // every row resolves to Virginia on the shared write path
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: "va_eva",
      });
      expect(cols.source_jurisdiction).toBe("VA");
    }
  });

  test("non-open, sole-source and already-closed rows are skipped with a reason", () => {
    const docs = fixture("non-open-sample-2026-10-01.json").response!.docs!;
    const { rows, skipped } = parseEvaDocs(docs, CAPTURED);
    expect(rows.length).toBe(0);
    expect(Object.values(skipped).reduce((a, b) => a + b, 0)).toBe(docs.length);

    const open: EvaDoc = {
      id: "IV1",
      app: "IV",
      internalid: "1",
      version: "0",
      status: "Open",
      shortdesc: "Something",
      closedate: "2026-09-30T14:00:00Z",
    };
    expect(parseEvaDocs([open], CAPTURED).skipped).toEqual({ closed: 1 });
    expect(parseEvaDocs([{ ...open, closedate: undefined, doccd: "SS" }], CAPTURED).skipped).toEqual({ sole_source: 1 });
    expect(parseEvaDocs([{ ...open, closedate: undefined, category: "Surplus" }], CAPTURED).skipped).toEqual({
      non_procurement: 1,
    });
    // no close date is legitimate: kept with a NULL due date
    const kept = parseEvaDocs([{ ...open, closedate: undefined }], CAPTURED).rows;
    expect(kept.length).toBe(1);
    expect(kept[0].due_date).toBeNull();
  });
});

describe("va_eva — helpers", () => {
  test("fixMojibake reverses eVA's double encoding and leaves clean text alone", () => {
    expect(fixMojibake("Mooreâ\u0080\u0099s Creek")).toBe("Moore’s Creek");
    expect(fixMojibake("ST. â\u0080\u0093 MATHEWS")).toBe("ST. – MATHEWS");
    expect(fixMojibake("Plain text")).toBe("Plain text");
    expect(fixMojibake("Already ’ fine")).toBe("Already ’ fine");
  });

  test("evaLocation keeps stated places and pins the rest to Virginia", () => {
    expect(evaLocation("Loudoun County, VA")).toBe("Loudoun County, VA");
    expect(evaLocation("HRSD")).toBe("HRSD, Virginia");
    expect(evaLocation("See attached solicitation")).toBe("Virginia");
    expect(evaLocation("")).toBe("Virginia");
    expect(evaLocation(null)).toBe("Virginia");
    // street/county names the shared resolver misreads as another state
    expect(evaLocation("Petersburg Public Library201 W. Washington Street, Petersburg, VA 23803")).toBe("Virginia");
    expect(evaLocation("Tinker Creek Transfer Station, 1020 Hollins RD NE, Roanoke, VA 24012")).toBe("Virginia");
    expect(evaLocation("Washington & Smyth Counties.")).toBe("Virginia");
  });

  test("evaSetAside labels SWaM priorities as a Virginia preference, never a federal cert", () => {
    expect(evaSetAside("Small Priority")).toBe("Virginia SWaM: Small Priority");
    expect(evaSetAside(undefined)).toBeNull();
    expect(evaSetAside("  ")).toBeNull();
  });

  test("detail links match eVA's own URL builder", () => {
    expect(evaDetailUrl({ app: "QQ", externalid: "55" })).toBe(
      "https://mvendor.cgieva.com/Vendor/public/QQDetails.jsp?PageTitle=QQ%20Details&REQUEST_ID=55",
    );
    expect(
      evaDetailUrl({ app: "VBO", doccd: "IFQC", docdeptcd: "A208", internalid: "170594", externalid: "898182101", version: "0" }),
    ).toBe(
      "https://mvendor.cgieva.com/Vendor/public/VBODetails.jsp?PageTitle=SO%20Details&DOC_CD=IFQC&Details_Page=VBOSODetails.jsp&DEPT_CD=A208&BID_INTRNL_NO=170594&BID_NO=898182101&BID_VERS_NO=0",
    );
    expect(evaDetailUrl({ app: "XYZ", internalid: "1" })).toBeNull();
  });

  test("the query is the hard-coded app:IV open set, cursor-paged (2026-10-08 owner spec)", () => {
    const url = new URL(evaQueryUrl("*"));
    expect(url.pathname).toBe("/Vendor/public/solrconnect.jsp");
    // THE OPEN SET IS THE QUERY ITSELF — asserted verbatim, so dropping `app:IV`
    // (re-admitting the archived VBO row) or dropping `closedate:[NOW TO *]`
    // (re-admitting rows that already closed) turns this red.
    expect(EVA_OPEN_QUERY).toBe("app:IV AND status:Open AND closedate:[NOW TO *]");
    expect(url.searchParams.get("q")).toBe(EVA_OPEN_QUERY);
    // There is no separate `fq`: the whole scope lives in `q` (asserted above).
    expect(url.searchParams.get("fq")).toBeNull();
    expect(url.searchParams.get("sort")).toBe("closedate asc,id asc");
    expect(url.searchParams.get("rows")).toBe(String(EVA_PAGE_SIZE));
    expect(url.searchParams.get("wt")).toBe("json");
    expect(url.searchParams.get("cursorMark")).toBe("*");
    // THE ENCODING TRAP: a space must be %20 — a literal `+` gets HTTP 200 with a
    // 5-byte body (see the malformed-body fixture).
    expect(url.search).toContain("app%3AIV%20AND%20status%3AOpen");
    expect(url.search).not.toContain("+");
  });
});

describe("va_eva — open-set SCOPE: the archived app:VBO row is never ingested", () => {
  test("the one archived row whose status still says Open is refused (wrong_app)", () => {
    const docs = fixture("archived-vbo-open-2026-10-08.json").response!.docs!;
    expect(docs.length).toBe(1);
    // The source's own numbers: status:Open over the whole index = 575,
    // app:IV AND status:Open = 574. THIS row is the delta.
    expect(docs[0].id).toBe("VBO:IFQC:A208:170594");
    expect(docs[0].app).toBe("VBO");
    expect(String(docs[0].status).toLowerCase()).toBe("open");

    const { rows, skipped, skippedRows } = parseEvaDocs(docs, CAPTURED_1008);
    expect(rows).toEqual([]);
    expect(skipped).toEqual({ wrong_app: 1 });
    expect(skippedRows).toEqual([{ id: "eva-VBO:IFQC:A208:170594", reason: "wrong_app" }]);
  });

  test("an app:IV row with the same shape is still accepted (the guard is app-scoped)", () => {
    const [vbo] = fixture("archived-vbo-open-2026-10-08.json").response!.docs!;
    const ivRow: EvaDoc = {
      ...vbo,
      id: "IV900001",
      app: "IV",
      internalid: "900001",
      version: "0",
      closedate: "2026-12-01T14:00:00Z",
    };
    expect(parseEvaDocs([ivRow], CAPTURED_1008).rows.length).toBe(1);
  });

  test("a doc with NO `app` field is not refused by the scope guard (absent is not wrong)", () => {
    const noApp: EvaDoc = {
      id: "IV900002",
      internalid: "900002",
      version: "0",
      status: "Open",
      shortdesc: "Something",
      closedate: "2026-12-01T14:00:00Z",
    };
    // Absent `app` is never read as a WRONG app. (Such a doc still yields no row,
    // but for the pre-existing reason that eVA's own detail URL is built from
    // `app` — pinned here so the two causes can never be confused.)
    const { rows, skipped } = parseEvaDocs([noApp], CAPTURED_1008);
    expect(rows).toEqual([]);
    expect(skipped).toEqual({ missing_detail_link: 1 });
    expect(skipped.wrong_app).toBeUndefined();
  });
});

describe("va_eva — close-date time zone: stored as published, never shifted", () => {
  test("the fixture anchor IV129024 (ODU hauling/moving IFB) closes 2026-10-16 as eVA states it", () => {
    const docs = fixture("odu-iv129024-2026-10-08.json").response!.docs!;
    expect(docs.length).toBe(1);
    const odu = docs[0];
    expect(odu.closedate).toBe("2026-10-16T11:00:00Z");
    expect(odu.agencyname).toBe("Old Dominion University");
    expect(odu.shortdesc).toBe("IFB #27-ODU-04-CCC - Hauling, Moving, and Labor Services");
    expect(odu.doccd).toBe("IFB");

    const { rows } = parseEvaDocs(docs, CAPTURED_1008);
    const row = rows.find((r) => r.external_id === "eva-IV129024")!;
    expect(row).toBeDefined();
    // AS PUBLISHED: the bare `Z` is read as the instant it says, NOT converted
    // from Eastern (an ET→UTC conversion of 11:00 local would be 15:00Z — the
    // 4-hour shift this rule forbids).
    expect(row.due_date).toBe("2026-10-16T11:00:00.000Z");
    expect(row.due_date).not.toBe("2026-10-16T15:00:00.000Z");
    // The deeplink is the detail affordance only; the card data is eVA's own row.
    expect(row.source_url).toBe(
      "https://mvendor.cgieva.com/Vendor/public/IVDetails.jsp?PageTitle=SO%20Details&rfp_id_lot=129024&rfp_id_round=1",
    );
    // eVA publishes no set-aside on this row, and no NAICS/PSC anywhere on app:IV.
    expect(row.set_aside).toBeNull();
    expect(row.notice_type).toBe("Invitation for Bids (IFB)");
  });

  test("the open question is disclosed, and the flag a surface must read is exported", () => {
    expect(VA_EVA_DUE_DATE_ZONE_UNVERIFIED).toBe(true);
    expect(VA_EVA_COPY.timeZoneNote).toContain("never shifted");
    expect(VA_EVA_COPY.timeZoneNote).toContain("countdown");
    expect(VA_EVA_COPY.timeZoneNote).toContain("Eastern");
  });
});

describe("va_eva — read gates (fail closed, never a plausible-but-partial open set)", () => {
  /** Minimal fetch stub: no network, and it records the URLs the reader asked for. */
  function stubFetch(pages: string[]) {
    const urls: string[] = [];
    const original = globalThis.fetch;
    let i = 0;
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url));
      const body = pages[Math.min(i, pages.length - 1)];
      i++;
      return { status: 200, text: async () => body } as unknown as Response;
    }) as typeof fetch;
    return { urls, restore: () => void (globalThis.fetch = original) };
  }
  const page = (numFound: number, docs: EvaDoc[], nextCursorMark?: string) =>
    JSON.stringify({ response: { numFound, docs }, ...(nextCursorMark ? { nextCursorMark } : {}) });

  const openDoc = (id: string): EvaDoc => ({
    id,
    app: "IV",
    internalid: id.replace(/\D/g, ""),
    version: "0",
    status: "Open",
    shortdesc: `Solicitation ${id}`,
    agencyname: "Commonwealth of Virginia",
    closedate: "2026-12-01T14:00:00Z",
  });

  test("GATE ①: a read shorter than numFound is REFUSED (count gate)", async () => {
    const s = stubFetch([page(574, [openDoc("IV1")])]);
    try {
      await expect(fetchVaEvaBids(CAPTURED_1008)).rejects.toThrow(SourceUnreachableError);
      await expect(fetchVaEvaBids(CAPTURED_1008)).rejects.toThrow(/count gate: read 1 documents but the source reported numFound=574/);
    } finally {
      s.restore();
    }
  });

  test("GATE ②: numFound = 0 is REFUSED — an always-populated query cannot honestly be empty", async () => {
    const s = stubFetch([page(0, [])]);
    try {
      await expect(fetchVaEvaBids(CAPTURED_1008)).rejects.toThrow(/count gate: the open-set query reported numFound=0/);
    } finally {
      s.restore();
    }
  });

  test("GATE ③: an open set that MOVES mid-read is REFUSED", async () => {
    const s = stubFetch([page(574, [openDoc("IV1"), openDoc("IV2")], "c1"), page(575, [])]);
    try {
      await expect(fetchVaEvaBids(CAPTURED_1008)).rejects.toThrow(/page 2 reports numFound=575 but page 1 reported 574/);
    } finally {
      s.restore();
    }
  });

  test("the malformed-query body (HTTP 200, 5 bytes) is REFUSED, not read as an empty board", async () => {
    const raw = readFileSync(new URL("./fixtures/va-eva/malformed-query-body-2026-10-08.txt", import.meta.url));
    expect(raw.length).toBe(5);
    expect(raw.length).toBeLessThan(EVA_MIN_BODY_BYTES);
    expect(() => JSON.parse(raw.toString("utf8"))).toThrow();
    const s = stubFetch([raw.toString("utf8")]);
    try {
      await expect(fetchVaEvaBids(CAPTURED_1008)).rejects.toThrow(/too small to be a Solr result \(5 bytes/);
    } finally {
      s.restore();
    }
  });

  test("the real 2026-10-08 page PASSES both gates and parses end to end", async () => {
    // REAL bytes: `q=id:IV129024&fl=*&rows=1` → numFound 1, exactly 1 document, so
    // the count gate is satisfied by the source's own numbers.
    const body = readFileSync(new URL("./fixtures/va-eva/odu-iv129024-2026-10-08.json", import.meta.url), "utf8");
    const parsed = JSON.parse(body) as EvaSolrResponse;
    expect(parsed.response!.numFound).toBe(1);
    expect(parsed.response!.docs!.length).toBe(1);
    const s = stubFetch([body]);
    try {
      const { rows, skipped } = await fetchVaEvaBids(CAPTURED_1008);
      expect(s.urls.length).toBe(1);
      expect(s.urls[0]).toContain("app%3AIV%20AND%20status%3AOpen");
      expect(rows.length).toBe(1);
      expect(skipped).toEqual({});
      expect(rows[0].external_id).toBe("eva-IV129024");
      // No NAICS / PSC / solicitation number is invented for eVA (it publishes none).
      expect(rows[0].naics_code).toBeNull();
      expect(rows[0].psc).toBeNull();
      expect(rows[0].solicitation_number).toBeNull();
    } finally {
      s.restore();
    }
  });

  test("REAL BYTES: one genuine PAGE of the open set is REFUSED — 25 docs against the source's own numFound", async () => {
    // The committed 2026-10-08 first page: a REAL eVA response whose numFound is
    // the whole open set (572 that minute) while `rows=25` returned 25 documents.
    // This is exactly the partial read the gate exists to refuse: on its own it
    // would be stored as a plausible-but-crumpled Virginia corpus.
    const body = readFileSync(new URL("./fixtures/va-eva/open-page1-rows25-2026-10-08.json", import.meta.url), "utf8");
    const parsed = JSON.parse(body) as EvaSolrResponse;
    const total = parsed.response!.numFound!;
    expect(parsed.response!.docs!.length).toBe(25);
    expect(total).toBeGreaterThan(25);
    const s = stubFetch([body]);
    try {
      await expect(fetchVaEvaBids(CAPTURED_1008)).rejects.toThrow(
        new RegExp(`count gate: read 25 documents but the source reported numFound=${total}`),
      );
    } finally {
      s.restore();
    }
  });

  test("the same real 25 rows DO parse when they are the whole reported set", async () => {
    // Identical real documents; only the source's own total is set to the number
    // of documents actually returned, which is the condition the gate checks.
    const body = readFileSync(new URL("./fixtures/va-eva/open-page1-rows25-2026-10-08.json", import.meta.url), "utf8");
    const parsed = JSON.parse(body) as EvaSolrResponse;
    const docs = parsed.response!.docs!;
    const s = stubFetch([JSON.stringify({ response: { numFound: docs.length, docs } })]);
    try {
      const { rows, skipped } = await fetchVaEvaBids(CAPTURED_1008);
      // Every real row is either ingested or skipped WITH a reason code — nothing
      // is dropped silently.
      const skipTotal = Object.values(skipped).reduce((a, b) => a + b, 0);
      expect(rows.length + skipTotal).toBe(docs.length);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.external_id.startsWith("eva-IV")).toBe(true);
        expect(row.naics_code).toBeNull();
        expect(row.psc).toBeNull();
        expect(row.solicitation_number).toBeNull();
      }
    } finally {
      s.restore();
    }
  });
});

describe("va_eva — copy: honest, source-verbatim, no coverage claim", () => {
  test("badge + publisher line name the source as a Virginia STATE portal", () => {
    expect(VA_EVA_COPY.badge).toBe("State (VA)");
    expect(VA_EVA_COPY.badge).toBe(sourceBadgeLabel("va_eva"));
    expect(VA_EVA_COPY.publisherLine).toContain("eVA");
    expect(VA_EVA_COPY.publisherLine).toContain("Virginia");
  });

  test("the buyer-mix note says LOCAL Virginia governments are included (48% of the corpus)", () => {
    expect(VA_EVA_COPY.buyerMixNote).toMatch(/cities, counties, towns, school divisions/);
    expect(VA_EVA_COPY.buyerMixNote).toContain("locality");
  });

  test("NO copy string claims coverage of a trade, a state of completeness, or a delivery niche", () => {
    const all = Object.values(VA_EVA_COPY).join(" ").toLowerCase();
    // The 2026-10-08 probe measured ZERO courier/freight/trucking/messenger rows
    // among 574 open rows — so no coverage claim for that trade may be written.
    for (const word of ["courier", "freight", "trucking", "messenger", "delivery coverage", "complete", "all virginia"]) {
      expect(all).not.toContain(word);
    }
    expect(VA_EVA_COPY.noClaimsLine).toContain("does not warrant");
    expect(VA_EVA_COPY.noClaimsLine).toContain("official source");
  });

  test("the count line can only be built from REAL run numbers", () => {
    expect(vaEvaCountLine(574, new Date("2026-10-08T00:52:00Z"))).toBe(
      "eVA listed 574 open Virginia solicitations · last checked by Contrax 2026-10-07 20:52 ET.",
    );
    expect(vaEvaCountLine(36, "2026-10-08 00:52 ET")).toContain("36 open Virginia solicitations");
  });

  test("the source's own 574-open agency facet is the honest buyer-mix record", () => {
    const body = fixture("open-agencyname-facets-2026-10-08.json");
    expect(body.response!.numFound).toBe(574);
    const facets = (body as unknown as { facet_counts?: { facet_fields?: Record<string, unknown[]> } })
      .facet_counts?.facet_fields?.agencyname as string[] | undefined;
    expect(Array.isArray(facets)).toBe(true);
    const names = facets!.filter((_, i) => i % 2 === 0) as string[];
    // Local government buyers are a real, named part of the open set.
    expect(names.some((n) => /City of /.test(n))).toBe(true);
    expect(names.some((n) => /County/.test(n))).toBe(true);
  });
});

describe("va_eva — fixtures are inert data (no executable content)", () => {
  test("every committed fixture parses as JSON (except the byte-exact malformed body) and carries no script", () => {
    const dir = new URL("./fixtures/va-eva/", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const f of files) {
      const text = readFileSync(new URL(f, dir), "utf8");
      expect(() => JSON.parse(text)).not.toThrow();
      expect(text.toLowerCase()).not.toContain("<script");
      expect(text.toLowerCase()).not.toContain("javascript:");
      expect(text).not.toContain("<html");
    }
  });
});

describe("va_eva — registration", () => {
  test("registered as a sync source with Virginia as its home jurisdiction", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "va_eva")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["va_eva"]).toBe("VA");
  });

  test("treated as a state/local source with a Virginia badge", () => {
    expect(isStateLocalSource(["va_eva"])).toBe(true);
    expect(sourceBadgeLabel("va_eva")).toBe("State (VA)");
  });
});
