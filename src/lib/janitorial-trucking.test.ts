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
  hasExplicitTransportationServicePhrase,
  isDumpTruckLike,
  isProductBuy,
  isTransportationWork,
  mapCategory,
  tradePassExclusion,
} from "~/lib/trade-classification";
import { collapseDuplicateNotices, noticeDedupeKey } from "~/lib/notice-dedupe";
import { collapseScanRows } from "~/lib/radar-scan-query";
import { pennBidCategory } from "~/jobs/sources/pennbid";
import { vaEvCategory } from "~/jobs/sources/va-ev";

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

  test("bare 'sanitation' IS a janitorial term (owner 09-21 fold-in, QA F8)", () => {
    // Added per the owner's janitorial category list (restroom/facility
    // sanitation alongside refuse removal, street cleaning, recycling, septic/
    // sewer, snow removal). It is a CURATED term now — no longer generic.
    expect(GENERIC_TRADE_TERMS.has("sanitation")).toBe(false);
    const e = expandTrade("sanitation");
    expect(e.terms[0]).toBe("sanitation");
    expect(e.naicsCodes).toContain("561720");
    // the SPECIFIC phrase is unaffected
    expect(expandTrade("restroom sanitation").naicsCodes).toContain("561720");
    // and bare "cleaning" stays out (the false-positive amplifier is unchanged)
    expect(GENERIC_TRADE_TERMS.has("cleaning")).toBe(true);
    expect(expandTrade("cleaning").naicsCodes).toEqual([]);
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

describe("R4 (QA F3) — the transportation branch applies BOTH negative guards", () => {
  test("a product-buy signal alongside a transport SERVICE word is NOT Transportation", () => {
    // The QA finding: isTransportationWork's own contract said "both negative
    // guards apply", but the product veto was never consulted, so these were
    // stamped Transportation. Every sample below carries BOTH a transport
    // service word (freight / hauling / truck) AND a product-buy signal.
    for (const title of [
      "FREIGHT TIRES",
      "HAULING EQUIPMENT PARTS",
      "TRUCK TIRES AND WHEELS",
      "Purchase of tires for the freight truck",
      "Freight vehicle parts procurement",
      "39--CART, GENERAL HAULING",
    ]) {
      expect(`${title} → ${mapCategory("", title, "")}`).not.toBe(`${title} → Transportation`);
      expect(isTransportationWork(title, title.toLowerCase())).toBe(false);
    }
    expect(isProductBuy("FREIGHT TIRES")).toBe(true);
  });

  test("a title that itself NAMES the transport service survives the product veto", () => {
    // The escape hatch is deliberately narrow (multi-word service phrases only):
    // a real hauling contract is never suppressed by its own boilerplate.
    expect(isTransportationWork("Freight hauling services for the base supply run", "")).toBe(true);
    expect(isTransportationWork("Fuel delivery services for the depot", "")).toBe(true);
    expect(isTransportationWork("Truckload freight services", "")).toBe(true);
    expect(mapCategory("", "Freight hauling services for the base supply run", "")).toBe(
      "Transportation",
    );
    // …while the bare verbs/nouns in a PRODUCT title never defeat the veto.
    expect(hasExplicitTransportationServicePhrase("39--CART, GENERAL HAULING")).toBe(false);
    expect(hasExplicitTransportationServicePhrase("HAULING EQUIPMENT PARTS")).toBe(false);
  });
});

describe("R4 (QA F4b) — the trade-pass purchased-service gate", () => {
  test("the live naics=484110 false positives are refused, with a reason", () => {
    expect(tradePassExclusion("trucking", "Depot Consumable Parts Processing & Disposal (DEMIL)", "")).toBe("product_buy");
    expect(tradePassExclusion("trucking", "Removal of 32 FT Bathroom Trailer", "")).toBe("product_buy");
    expect(tradePassExclusion("trucking", "91--Service, Diesel Fuel and Delivery", "")).toBe("product_buy");
    expect(tradePassExclusion("trucking", "FREIGHT TIRES", "")).toBe("product_buy");
    expect(tradePassExclusion("trucking", "MORR PURCHASE NEW DUMP TRUCK", "")).toBe("dump_truck");
    expect(tradePassExclusion("trucking", "39--CART, GENERAL HAULING", "")).toBe("product_buy");
  });

  test("genuine trade notices are NOT lost by the gate (exclusion, never a positive requirement)", () => {
    // "Office Move" (real 484210) carries no service phrase at all — a positive
    // requirement would silently drop it.
    expect(tradePassExclusion("trucking", "Office Move", "")).toBe(null);
    expect(tradePassExclusion("trucking", "Bldgs 1469, 1475, 1479 METC Furniture Relocation and Storage", "")).toBe(null);
    expect(tradePassExclusion("trucking", "1 SOMDG Medical Courier Services", "")).toBe(null);
    expect(tradePassExclusion("janitorial", "S201--Janitorial Services l Chattanooga National Cemetery", "")).toBe(null);
    expect(tradePassExclusion("janitorial", "Housekeeping Services – Fermilab", "")).toBe(null);
    expect(tradePassExclusion("janitorial", "Sanitation services for the county campus", "")).toBe(null);
  });

  test("a product-buy statement of work inside a janitorial pass is refused", () => {
    expect(tradePassExclusion("janitorial", "Janitorial supplies (restroom paper towels)", "")).toBe("product_buy");
    expect(tradePassExclusion("janitorial", "Kitchen Hood Cleaning Services", "")).toBe("specialty_cleaning_only");
    // …but an explicit janitorial SERVICE phrase keeps a contract that buys consumables
    expect(tradePassExclusion("janitorial", "Janitorial services including kitchen hood cleaning", "")).toBe(null);
    expect(tradePassExclusion("janitorial", "Janitorial services, supplies included", "")).toBe(null);
  });
});

describe("R5 (QA F2) — the dedupe is WIRED into the Radar read path", () => {
  const ROWS = [
    { id: 1, title: "F108--Mobile Firing Range Cleaning", agency: "NCO 17" },
    { id: 2, title: "F108--Mobile Firing Range Cleaning", agency: "NCO 17" },
    { id: 3, title: "F108--Mobile Firing Range Cleaning", agency: "NCO 17" },
    { id: 4, title: "Janitorial Services for the Federal Building", agency: "GSA" },
    { id: 5, title: "Custodial Services – Roanoke VA Clinic", agency: "VA" },
    { id: 6, title: "Housekeeping Services – Fermilab", agency: "DOE" },
  ];

  test("the scan's result set is collapsed before it is scored and capped", async () => {
    const noSolicitations = async () => new Map<number, string | null>();
    const out = await collapseScanRows(ROWS, noSolicitations);
    // 6 rows → 4 distinct notices: the 3-× duplicate collapses to one, so the
    // ≤5 default-match cap is spent on DISTINCT work.
    expect(out.rows.length).toBe(4);
    expect(out.collapsed).toBe(2);
    expect(out.rows.map((r) => r.id)).toEqual([1, 4, 5, 6]);
    expect(out.solicitationNumbers).toBe(true);
    expect(ROWS.length).toBe(6); // the input array is never mutated
  });

  test("the solicitation number is the authority when it is available", async () => {
    const rows = [
      { id: 11, title: "Janitorial Services", agency: "DLA Richmond" },
      { id: 12, title: "Janitorial Services", agency: "DLA Richmond" },
      { id: 13, title: "Janitorial Services", agency: "DLA Norfolk" },
    ];
    // Same solicitation number on two rows with DIFFERENT agency text → 1 notice.
    const withSol = await collapseScanRows(rows, async () =>
      new Map<number, string | null>([
        [11, "W912C326BA003"],
        [12, "w912c326ba003"],
        [13, "W912C326BA004"],
      ]),
    );
    expect(withSol.rows.length).toBe(2);
    expect(withSol.collapsed).toBe(1);
    expect(withSol.rows.map((r) => r.id)).toEqual([11, 13]);
    // Without the column (047 unapplied) the natural key is coarser: the two
    // agency spellings no longer collapse — proving the key really drives output.
    const withoutSol = await collapseScanRows(rows, async () => new Map());
    expect(withoutSol.solicitationNumbers).toBe(true);
    const natural = await collapseScanRows(rows.filter((r) => r.id !== 13), async () => {
      throw new Error('column "solicitation_number" does not exist');
    });
    expect(natural.solicitationNumbers).toBe(false);
    expect(natural.rows.length).toBe(1);
    expect(natural.collapsed).toBe(1);
  });

  test("an unreadable solicitation column degrades to the natural key (never fails the scan)", async () => {
    const out = await collapseScanRows(ROWS, async () => {
      throw new Error('column "solicitation_number" does not exist');
    });
    expect(out.solicitationNumbers).toBe(false);
    expect(out.rows.length).toBe(4);
    expect(out.collapsed).toBe(2);
  });

  test("the report requests the live row ids it is given", async () => {
    let asked: number[] = [];
    await collapseScanRows(ROWS, async (ids) => {
      asked = ids;
      return new Map();
    });
    expect(asked).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("the Radar scan route actually CALLS the collapse (not library-only)", () => {
    // Guards the exact QA F2 regression: a dedupe module with tests and no
    // production caller changes no observable behaviour.
    const src = readFileSync(new URL("../routes/radar.tsx", import.meta.url), "utf8");
    expect(src).toContain("collapseScanRows(rows");
    expect(src).toContain("loadSolicitationNumbers(sql, ids)");
    expect(readFileSync(new URL("./radar-scan-query.ts", import.meta.url), "utf8")).toContain(
      'from "~/lib/notice-dedupe"',
    );
  });
});

describe("R4 (QA F4a) — the state/local sources use the SHARED classifier", () => {
  test("PennBid no longer stamps the bare-'cleaning' / bare-'truck' amplifiers", () => {
    // janitorial: only custodial SERVICE work, never a bare "cleaning" mention
    expect(pennBidCategory("Janitorial services for the county courthouse")).toBe("Janitorial");
    expect(pennBidCategory("Custodial services – municipal complex")).toBe("Janitorial");
    expect(pennBidCategory("Sanitation services for the borough")).toBe("Janitorial");
    expect(pennBidCategory("Duct cleaning – borough hall")).not.toBe("Janitorial");
    expect(pennBidCategory("Cleaning supplies restock")).not.toBe("Janitorial");
    // transportation: the shared purchase-service rule (a TRUCK product is not trucking)
    expect(pennBidCategory("Freight hauling services")).toBe("Transportation");
    expect(pennBidCategory("Furniture relocation and storage")).toBe("Transportation");
    expect(pennBidCategory("Truck tires and wheels")).not.toBe("Transportation");
    // PennBid's own unrelated coarse branches are unchanged
    expect(pennBidCategory("Road resurfacing project")).toBe("Construction");
    expect(pennBidCategory("Laboratory equipment")).toBe("Supplies & Equipment");
  });

  test("VA eVA gains a trucking branch and loses its bare-'clean'/'sanitat' branch", () => {
    expect(vaEvCategory("Custodial Services - Salem, VA")).toBe("Janitorial");
    expect(vaEvCategory("Janitorial services for the clinic")).toBe("Janitorial");
    expect(vaEvCategory("Sanitation services for the campus")).toBe("Janitorial");
    // the old branch's false positives no longer classify as janitorial work
    expect(vaEvCategory("2026 Interceptor Cleaning and CCTV")).not.toBe("Janitorial");
    expect(vaEvCategory("Laundry and Dry-Cleaning CBRNE Mobility Gear")).not.toBe("Janitorial");
    expect(vaEvCategory("Cleaning supplies")).not.toBe("Janitorial");
    // no trucking branch existed at all before: VA freight work fell to "Other"
    expect(vaEvCategory("Freight hauling services for the Salem campus")).toBe("Transportation");
    expect(vaEvCategory("Furniture relocation services")).toBe("Transportation");
    expect(vaEvCategory("Truck tires")).not.toBe("Transportation");
    expect(vaEvCategory("Roof renovation", "renovation of the clinic roof")).toBe("Construction");
  });
});
