/**
 * eVA — Virginia Business Opportunities (`va_eva`) connector pins.
 *
 * DETERMINISTIC, ZERO NETWORK, NO DATABASE. The fixtures are VERBATIM eVA
 * `solrconnect.jsp` responses captured on 2026-10-01 (see
 * fixtures/va-eva/README.md). `parseEvaDocs` is pure and takes an injected
 * reference instant, so nothing here depends on the wall clock.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import {
  evaDetailUrl,
  evaLocation,
  evaQueryUrl,
  evaSetAside,
  fixMojibake,
  parseEvaDocs,
  type EvaDoc,
  type EvaSolrResponse,
} from "./va-eva";

const fixture = (name: string): EvaSolrResponse =>
  JSON.parse(readFileSync(new URL(`./fixtures/va-eva/${name}`, import.meta.url), "utf8"));

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

  test("the query asks only for Open rows, sorted on the unique id for cursor paging", () => {
    const url = new URL(evaQueryUrl("*"));
    expect(url.pathname).toBe("/Vendor/public/solrconnect.jsp");
    expect(url.searchParams.get("fq")).toBe('status:("Open")');
    expect(url.searchParams.get("sort")).toBe("pubdate desc,id desc");
    expect(url.searchParams.get("wt")).toBe("json");
    expect(url.searchParams.get("cursorMark")).toBe("*");
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
