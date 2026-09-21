/**
 * Janitorial + trucking ingestion — classification, registry and read-time
 * dedupe units (owner PRIORITY 09-21, R3 / R4 / R5).
 *
 * DETERMINISTIC, ZERO NETWORK, NO DATABASE. Every case is either a pure-function
 * input or one of the committed fixtures (the R5 duplicate-title fixture is a
 * read-only SELECT capture from production, committed verbatim).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { GENERIC_TRADE_TERMS, expandTrade, tradeTextIncludes } from "~/lib/trade-registry";
import { inferNaics } from "~/lib/naics-infer";
import {
  isDumpTruckLike,
  isProductBuy,
  mapCategory,
} from "~/lib/trade-classification";
import { collapseDuplicateNotices, noticeDedupeKey } from "~/lib/notice-dedupe";

const JANITORIAL = expandTrade("janitorial");

describe("R3 — trade-registry completeness (audit §2.2 gaps)", () => {
  test("the natural buyer phrasings resolve to NAICS 561720", () => {
    for (const q of ["cleaning services", "janitorial services", "custodial services"]) {
      const e = expandTrade(q);
      expect(`${q} → ${JSON.stringify(e.naicsCodes)}`).toBe(`${q} → ["561720"]`);
      expect(e.terms).toContain(q);
    }
  });

  test("484210 is in the trucking family (the largest trucking code we held)", () => {
    const e = expandTrade("trucking");
    for (const code of ["484110", "484121", "484122", "484210", "484220", "484230", "492110"]) {
      expect(e.naicsCodes).toContain(code);
    }
  });

  test("drayage resolves (it resolved to NOTHING before)", () => {
    const e = expandTrade("drayage");
    expect(e.terms[0]).toBe("drayage");
    expect(e.naicsCodes).toContain("484210");
    expect(e.naicsCodes.length).toBeGreaterThan(0);
  });

  test("bare 'sanitation' stays out, structurally", () => {
    expect(GENERIC_TRADE_TERMS.has("sanitation")).toBe(true);
    const e = expandTrade("sanitation");
    expect(e.naicsCodes).toEqual([]);
    // the SPECIFIC phrase is unaffected
    expect(expandTrade("restroom sanitation").naicsCodes).toContain("561720");
  });

  test("bare 'cleaning' implies no NAICS (the false-positive amplifier)", () => {
    const e = expandTrade("cleaning");
    expect(e.naicsCodes).not.toContain("561720");
    expect(e.naicsCodes).toEqual([]);
  });

  test("the owner's janitorial precision pins still hold", () => {
    for (const t of [
      "janitorial",
      "custodial",
      "commercial cleaning",
      "building cleaning",
      "housekeeping",
      "floor care",
      "carpet cleaning",
      "restroom sanitation",
      "window cleaning",
    ]) {
      expect(JANITORIAL.terms).toContain(t);
    }
    expect(JANITORIAL.terms).not.toContain("cleaning");
    expect(JANITORIAL.terms.length).toBeLessThanOrEqual(16);
  });

  test("specialty cleaning is NOT a janitorial text match", () => {
    expect(tradeTextIncludes("Kitchen Hood Cleaning Services", JANITORIAL)).toBe(false);
    expect(tradeTextIncludes("10--ROD,CLEANING,SMALL ARM", JANITORIAL)).toBe(false);
    expect(
      tradeTextIncludes("Janitorial and Custodial Services for Municipal Complex", JANITORIAL),
    ).toBe(true);
    expect(tradeTextIncludes("Cleaning services for the federal building", JANITORIAL)).toBe(true);
  });
});

describe("R4 — purchased-service-only classification", () => {
  test("janitorial SERVICE work is stamped Janitorial", () => {
    expect(mapCategory("", "Janitorial Services for the Federal Building", "")).toBe("Janitorial");
    expect(mapCategory("", "Custodial Services – Roanoke VA Clinic", "")).toBe("Janitorial");
    expect(mapCategory("", "Cleaning services for the county courthouse", "")).toBe("Janitorial");
    // a custodial contract that also has a hood-cleaning line item stays janitorial
    expect(
      mapCategory("", "Janitorial services including kitchen hood cleaning", ""),
    ).toBe("Janitorial");
  });

  test("the audit's 14 open false positives are NOT stamped Janitorial", () => {
    const fps = [
      "Purchase of LCPW1000W Pulse Wave Laser Cleaning System",
      "Request for Quotation – Procurement of cleaning supplies",
      "Westrup LA-LS airscreen cleaner",
      "Guatemala-Washing Drone for Cleaning Façade",
      "RIFO CORRAL EXTERIOR CLEANING",
      "HULL CLEANING & UWILD",
      "Cabin Cleaning, Olympic National Forest",
      "2026 Interceptor Cleaning and CCTV",
      "CDCA 2027 Line Cleaning & Video Inspection",
      "Cleaning of Pump Station Wet Wells and Business District Sewers",
      "Cleaning of Food Service Exhaust Fans and Ducts",
      "Laundry and Dry-Cleaning CBRNE Mobility Gear",
      "Buckley SFB CATM Gun Range Maintenance and Cleaning",
      "Intent to Sole Source – Ancillary Services (Material Handling, and Cleaning)",
    ];
    for (const title of fps) {
      expect(`${title} → ${mapCategory("Solicitation", title, "")}`).not.toBe(
        `${title} → Janitorial`,
      );
    }
  });

  test("product buys / dump-truck listings never enter these trades", () => {
    expect(mapCategory("", "JANITORIAL SUPPLIES - GROUP N", "")).not.toBe("Janitorial");
    expect(mapCategory("", "MORR PURCHASE NEW DUMP TRUCK", "")).not.toBe("Transportation");
    expect(mapCategory("", "TRUCK TIRES AND WHEELS", "")).not.toBe("Transportation");
    // shipping / FOB / incidental-cleanup-only contracts (the owner's exclusion)
    expect(mapCategory("", "FOB Destination delivery of office furniture", "")).not.toBe(
      "Transportation",
    );
    expect(
      mapCategory("", "Packaging and shipping of equipment (incidental cleanup only)", ""),
    ).not.toBe("Janitorial");
    expect(isProductBuy("Janitorial supplies")).toBe(true);
    expect(isDumpTruckLike("MORR PURCHASE NEW DUMP TRUCK")).toBe(true);
    expect(isDumpTruckLike("Freight hauling services")).toBe(false);
  });

  test("trucking / moving / courier work gets a real Transportation category", () => {
    expect(mapCategory("", "Freight hauling services for the base supply run", "")).toBe(
      "Transportation",
    );
    expect(
      mapCategory("Combined Synopsis/Solicitation", "Bldgs 1469, 1475 METC Furniture Relocation and Storage", ""),
    ).toBe("Transportation");
    expect(mapCategory("Solicitation", "Intent to Sole Source - HHG Services Pensacola", "")).toBe(
      "Transportation",
    );
    expect(mapCategory("", "Courier services for the medical center", "")).toBe("Transportation");
  });

  test("ingest NAICS inference drops the bare-'cleaning' FPs and keeps services", () => {
    // negatives (all three were inferred 561720 in production)
    expect(inferNaics("10--ROD,CLEANING,SMALL ARM", "")).toBe(null);
    expect(inferNaics("JANITORIAL SUPPLIES - GROUP N", "")).toBe(null);
    expect(inferNaics("Purchase of LCPW1000W Pulse Wave Laser Cleaning System", "")).toBe(null);
    expect(inferNaics("MORR PURCHASE NEW DUMP TRUCK", "")).toBe(null);
    expect(inferNaics("TRUCK TIRES AND WHEELS", "")).toBe(null);
    // positives (service work still classifies)
    expect(inferNaics("Janitorial Services for the Federal Building", "")).toBe("561720");
    expect(inferNaics("Cleaning services for the county courthouse", "")).toBe("561720");
    expect(inferNaics("Freight hauling services", "")).toBe("484121");
  });
});

describe("R5 — cross-source dedupe at read time (never deletes rows)", () => {
  test("the same notice under many source labels collapses to one", () => {
    const rows = [
      { source: "oh", solicitation_number: "W912C326BA003", title: "Janitorial Services", agency: "DLA" },
      { source: "va", solicitation_number: "w912c326ba003", title: "Janitorial Services", agency: "DLA" },
      { source: "nc", solicitation_number: "W912C326BA003", title: "Janitorial Services", agency: "DLA" },
    ];
    const { rows: kept, collapsed } = collapseDuplicateNotices(rows);
    expect(kept.length).toBe(1);
    expect(collapsed).toBe(2);
    expect(kept[0]!.source).toBe("oh"); // first in input order wins, deterministically
    expect(rows.length).toBe(3); // input array is NEVER mutated or deleted from
  });

  test("the natural-key fallback collapses rows with no solicitation number", () => {
    const rows = [
      { source: "nc", title: "F108--Mobile Firing Range Cleaning", agency: "NCO 17" },
      { source: "nd", title: "f108--Mobile Firing Range Cleaning ", agency: "nco 17" },
      { source: "sd", title: "F108--Mobile Firing Range Cleaning", agency: "NCO 18" },
    ];
    const { rows: kept, collapsed } = collapseDuplicateNotices(rows);
    expect(collapsed).toBe(1);
    expect(kept.length).toBe(2);
    expect(noticeDedupeKey(rows[0]!)).toBe(noticeDedupeKey(rows[1]!));
    expect(noticeDedupeKey(rows[0]!)).not.toBe(noticeDedupeKey(rows[2]!));
  });

  test("the production duplicate-title fixture really does collapse", () => {
    const fixture = JSON.parse(
      readFileSync(new URL("./fixtures/notice-dedupe/duplicate-title-groups.json", import.meta.url), "utf8"),
    ) as { rows: { source: string; title: string; agency: string | null }[] };
    expect(fixture.rows.length).toBeGreaterThan(15);
    const { rows: kept, collapsed } = collapseDuplicateNotices(fixture.rows);
    expect(collapsed).toBeGreaterThan(10);
    const keys = new Set(kept.map((r) => noticeDedupeKey(r)));
    expect(keys.size).toBe(kept.length);
  });
});
