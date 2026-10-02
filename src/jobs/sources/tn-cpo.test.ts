/**
 * Tennessee CPO RFP opportunities (`tn_cpo`) connector pins. Zero network,
 * no database: the fixture is the verbatim page captured 2026-10-02
 * (gzipped; see fixtures/tn-cpo/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { parseTnPage, readTnEvents, tnDateToIso, tnEventLabel } from "./tn-cpo";

const HTML = gunzipSync(readFileSync(new URL("./fixtures/tn-cpo/rfp-opportunities-2026-10-02.html.gz", import.meta.url))).toString("utf8");
const CAPTURED = Date.parse("2026-10-02T03:50:00Z");

describe("tn_cpo — parse (captured page)", () => {
  test("73 events; the 17 still due become Tennessee bids", () => {
    expect(readTnEvents(HTML)!.length).toBe(73);
    const { rows, skipped } = parseTnPage(HTML, CAPTURED);
    expect(skipped).toEqual({ closed: 56 });
    expect(rows.length).toBe(17);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^tncpo-[0-9A-Za-z-]+$/);
      expect(r.agency).toBe("State of Tennessee");
      expect(r.location).toBe("Tennessee");
      expect(r.title).not.toMatch(/UPDATED$/);
      expect(r.source_url.startsWith("https://www.tn.gov/")).toBe(true);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "tn_cpo" });
      expect(cols.source_jurisdiction).toBe("TN");
      expect(cols.normalized_state).toBe("TN");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("the insurance broker RFP maps field by field", () => {
    const row = parseTnPage(HTML, CAPTURED).rows.find((r) => r.external_id === "tncpo-30901-65626")!;
    expect(row.title).toBe("Insurance Broker and Captive Management Services for the State's Risk Management Program");
    expect(row.notice_type).toBe("RFP");
    expect(row.solicitation_number).toBe("30901-65626");
    expect(row.due_date).toBe("2026-10-08T04:00:00.000Z"); // 12:00 AM EDT on the due date
    expect(row.source_url).toBe(
      "https://www.tn.gov/content/dam/tn/generalservices/documents/cpo/rfp-updates/30901-65626/RFP_30901-65626_Ins_Broker_Captive_Mgmt_Final.pdf",
    );
  });

  test("'- UPDATED' is not part of a title; a slash in an event number is kept in the number only", () => {
    const rows = parseTnPage(HTML, CAPTURED).rows;
    expect(rows.find((r) => r.solicitation_number === "35910-16927")!.title).toBe("Security Protection Services");
    const rfq = rows.find((r) => r.solicitation_number === "529/000-01-2026")!;
    expect(rfq.external_id).toBe("tncpo-529-000-01-2026");
    expect(rfq.notice_type).toBe("RFQ");
  });

  test("labels and dates", () => {
    expect(tnEventLabel("RFP 30901-65626")).toEqual({ kind: "RFP", number: "30901-65626" });
    expect(tnEventLabel("Solicitation_Notice 34307-31427")).toEqual({ kind: "Solicitation Notice", number: "34307-31427" });
    expect(tnEventLabel("Amendment 2")).toBeNull();
    expect(tnDateToIso("12/18/2026")).toBe("2026-12-18T05:00:00.000Z");
    expect(tnDateToIso("TBD")).toBeNull();
  });
});

describe("tn_cpo — registration", () => {
  test("registered as a tail sync source, Tennessee home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "tn_cpo")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["tn_cpo"]).toBe("TN");
    expect(isStateLocalSource(["tn_cpo"])).toBe(true);
    expect(sourceBadgeLabel("tn_cpo")).toBe("State (TN)");
  });
});
