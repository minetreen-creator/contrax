/**
 * Missouri MissouriBUYS / MOVERS (`mo_movers`) connector pins. Zero network,
 * no database: the fixture is the verbatim REST response captured 2026-10-04
 * (gzipped; see fixtures/mo-movers/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { moAgencyName, moMoversUrl, parseMoAbstracts, type MoAbstract } from "./mo-movers";

const ITEMS: MoAbstract[] = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/mo-movers/open-abstracts-2026-10-04.json.gz", import.meta.url))).toString("utf8"),
).items;
const CAPTURED = Date.parse("2026-10-04T11:55:00Z");

describe("mo_movers — parse (captured response)", () => {
  test("76 listed; canceled and non-competitive notices are skipped", () => {
    expect(ITEMS.length).toBe(76);
    const { rows, skipped } = parseMoAbstracts(ITEMS, CAPTURED);
    expect((skipped.not_open ?? 0)).toBe(ITEMS.filter((i) => !/^(active|amended)$/i.test(String(i.NegotiationStatus))).length);
    expect(skipped.not_competitive ?? 0).toBeGreaterThan(0);
    expect(rows.length).toBe(ITEMS.length - Object.values(skipped).reduce((a, b) => a + b, 0));
    expect(rows.length).toBeGreaterThan(50);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^momovers-\d+$/);
      expect(r.location).toBe("Missouri");
      expect(r.notice_type).not.toMatch(/single feasible|special delegation/i);
      expect(Date.parse(r.due_date!)).toBeGreaterThan(CAPTURED);
      expect(r.source_url.startsWith("https://ewqg.fa.us8.oraclecloud.com/")).toBe(true);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "mo_movers" });
      expect(cols.source_jurisdiction).toBe("MO");
      expect(cols.normalized_state).toBe("MO");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("janitorial work is present and categorized", () => {
    const rows = parseMoAbstracts(ITEMS, CAPTURED).rows;
    const jan = rows.filter((r) => /janitorial/i.test(r.title));
    expect(jan.length).toBeGreaterThan(0);
    expect(jan.some((r) => r.category === "Janitorial")).toBe(true);
  });

  test("a closed date or bad status is never accepted", () => {
    const base = ITEMS.find((i) => i.NegotiationStatus === "Active" && /INVITATION FOR BID/.test(String(i.NegotiationType)))!;
    expect(parseMoAbstracts([{ ...base, CloseDate: "2026-10-01T19:00:00+00:00" }], CAPTURED).skipped).toEqual({ closed: 1 });
    expect(parseMoAbstracts([{ ...base, NegotiationStatus: "Canceled" }], CAPTURED).skipped).toEqual({ not_open: 1 });
    expect(parseMoAbstracts([{ ...base, NegotiationType: "SINGLE FEASIBLE SOURCE (SFS)" }], CAPTURED).skipped).toEqual({ not_competitive: 1 });
  });

  test("agency names and query URL", () => {
    expect(moAgencyName("31-MODOT TRANSPORTATION")).toBe("MoDOT Transportation");
    expect(moAgencyName("34-PROC OA DIVISION OF PURCHASING PROCUREMENTS")).toBe("OA Division of Purchasing");
    expect(moAgencyName("71-DOC CORRECTIONS")).toBe("DOC Corrections");
    expect(moAgencyName(null)).toBe("State of Missouri");
    expect(moMoversUrl(CAPTURED)).toContain("finder=RowFinderByBU;ProcurementBUId=300000005255687");
    expect(decodeURIComponent(moMoversUrl(CAPTURED))).toContain("CloseDate>'2026-10-04T11:55:00'");
  });
});

describe("mo_movers — registration", () => {
  test("registered as a tail sync source, Missouri home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "mo_movers")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["mo_movers"]).toBe("MO");
    expect(isStateLocalSource(["mo_movers"])).toBe(true);
    expect(sourceBadgeLabel("mo_movers")).toBe("State (MO)");
  });
});
