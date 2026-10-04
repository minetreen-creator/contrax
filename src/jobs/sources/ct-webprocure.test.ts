/**
 * Connecticut CTsource Bid Board (`ct_webprocure`) connector pins. Zero
 * network, no database: the fixture is every open record the public search
 * returned on 2026-10-04 (gzipped, fields the parser reads; see
 * fixtures/ct-webprocure/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { THAWTE_TLS_RSA_CA_G1, ctAgencyName, ctBidUrl, ctSearchUrl, parseCtRecords, type CtRecord } from "./ct-webprocure";

const DATA = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/ct-webprocure/open-sols-2026-10-04.json.gz", import.meta.url))).toString("utf8"),
) as { hits: number; records: CtRecord[] };
const CAPTURED = Date.parse("2026-10-04T13:00:00Z");

describe("ct_webprocure — parse (captured response)", () => {
  test("171 listed (170 unique); every accepted row is an open Connecticut bid", () => {
    expect(DATA.hits).toBe(171);
    expect(DATA.records.length).toBe(171);
    const { rows, skipped } = parseCtRecords(DATA.records, CAPTURED);
    expect(skipped.duplicate).toBe(1);
    expect(rows.length).toBe(171 - Object.values(skipped).reduce((a, b) => a + b, 0));
    expect(rows.length).toBeGreaterThan(150);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^ctwp-\d+$/);
      expect(r.location).toBe("Connecticut");
      expect(Date.parse(r.due_date!)).toBeGreaterThan(CAPTURED);
      expect(r.source_url).toMatch(/^https:\/\/webprocure\.proactiscloud\.com\/wp-web-public\/en\/#\/bidboard\/bid\/\d+\?customerid=51$/);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "ct_webprocure" });
      expect(cols.source_jurisdiction).toBe("CT");
    }
  });

  test("a town RFQ maps field by field", () => {
    const rec = DATA.records.find((r) => /Acton Public Library/.test(String(r.title)))!;
    const row = parseCtRecords([rec], CAPTURED).rows[0]!;
    expect(row.agency).toBe("Town of Old Saybrook");
    expect(row.estimated_value).toBe("$2,000,000");
    expect(row.solicitation_number).toBe("38051");
    expect(row.description).toContain("Old Saybrook");
  });

  test("closed, not-open and incomplete records are skipped", () => {
    const base = DATA.records[0]!;
    expect(parseCtRecords([{ ...base, openDate: CAPTURED - 1000 }], CAPTURED).skipped).toEqual({ closed: 1 });
    expect(parseCtRecords([{ ...base, ctBidstatus: { publicStatus: "Closed" } }], CAPTURED).skipped).toEqual({ not_open: 1 });
    expect(parseCtRecords([{ ...base, title: "" }], CAPTURED).skipped).toEqual({ missing_fields: 1 });
  });

  test("agency names, URLs", () => {
    expect(ctAgencyName("Stamford, City of")).toBe("City of Stamford");
    expect(ctAgencyName("Transportation, Dept. of")).toBe("Dept. of Transportation");
    expect(ctAgencyName("UConn Health Center")).toBe("UConn Health Center");
    expect(ctAgencyName(null)).toBe("State of Connecticut");
    expect(ctSearchUrl(20)).toBe(
      "https://webprocure.proactiscloud.com/wp-full-text-search/search/sols?customerid=51&q=*&from=20&sort=r&f=ps%3DOpen&oids=",
    );
    expect(ctBidUrl(138741)).toContain("/bidboard/bid/138741?customerid=51");
  });

  test("the supplied intermediate is the genuine Thawte TLS RSA CA G1", () => {
    const cert = new X509Certificate(THAWTE_TLS_RSA_CA_G1);
    expect(cert.subject).toContain("CN=Thawte TLS RSA CA G1");
    expect(cert.issuer).toContain("CN=DigiCert Global Root G2");
    expect(cert.fingerprint256).toBe("4B:CC:5E:23:4F:E8:1E:DE:4E:AF:88:3A:A1:9C:31:33:5B:0B:26:E8:5E:06:6B:99:45:E4:CB:61:53:EB:20:C2");
  });
});

describe("ct_webprocure — registration", () => {
  test("registered as a tail sync source, Connecticut home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "ct_webprocure")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["ct_webprocure"]).toBe("CT");
    expect(isStateLocalSource(["ct_webprocure"])).toBe(true);
    expect(sourceBadgeLabel("ct_webprocure")).toBe("State (CT)");
  });
});
