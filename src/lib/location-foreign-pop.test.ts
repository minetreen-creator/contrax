/**
 * FOREIGN PLACE-OF-PERFORMANCE GUARD — regression pins (owner order 2026-09-23).
 *
 * THE LEAK (live, after the 09-23 after-run measurement): row 139639 (sam_gov,
 * NAICS 562111 / PSC S205) — title "Trash Removal and Disposal for Busan Area,
 * USAG-Daegu" (Republic of Korea), location placeholder "United States",
 * agency "0906 AQ CO     DET A CONTRACTI" — was stored with
 * `normalized_state = 'CO'`: the bare "CO" token of the CONTRACTING-OFFICE
 * string was read as Colorado for a South-Korea trash contract by the
 * agency-name→US-state fallback. Evidence: shared/nationwide-coverage-matrix-
 * 2026-09-23/after-2026-09-23/divergence.md (CO/solid-waste-collection) and
 * probe2-moved-cells.txt.
 *
 * RULE: when the notice's own place-of-performance evidence resolves OUTSIDE
 * the United States, the agency fallback MUST NOT apply — the row keeps an
 * honest no-US-state value (NULL / unknown). A state is never invented, and a
 * state the PERFORMANCE LOCATION itself names is untouched.
 *
 * These are DETERMINISTIC pure-function fixtures: zero network, zero database,
 * zero clock. The live row's field values are used verbatim as fixture input.
 */
import { describe, expect, test } from "bun:test";
import { US_STATES } from "~/lib/states";
import {
  AGENCY_JURISDICTION_PROVENANCE,
  FOREIGN_PLACE_CODES,
  SOURCE_HOME_JURISDICTIONS,
  agencyJurisdictionState,
  deriveInsertLocationColumns,
  geoRelevant,
  hasForeignPlaceOfPerformance,
  isForeignPlaceField,
  isForeignPlaceOfPerformance,
  isNationalScope,
  locationConflict,
  matchGeographyBucket,
  resolveBidState,
  resolveStateFromText,
} from "~/lib/location-state";

/** Live row 139639 (sam_gov) — field values verbatim from the production probe. */
const LIVE_139639 = {
  location: "United States",
  agency: "0906 AQ CO     DET A CONTRACTI",
  title: "Trash Removal and Disposal for Busan Area, USAG-Daegu",
  description: null,
  sourceName: "sam_gov",
};

/** The raw read the leak came from: the office string's own "CO" token. Kept as
 *  a documented pin of the MECHANISM (not an endorsement of the value) — the
 *  guard below is what removes it from the row's stored geography. */
const OFFICE_STATE_TOKEN = resolveStateFromText(LIVE_139639.agency);

describe("(a) live row 139639 — a Busan/Daegu (South Korea) notice never gets a US state", () => {
  test("the contracting-office string really is the source of the leaked 'CO'", () => {
    expect(OFFICE_STATE_TOKEN).toBe("CO");
    // …and a placeholder location alone resolves to nothing (no state invented).
    expect(resolveStateFromText("United States")).toBeNull();
  });

  test("deriveInsertLocationColumns stores NULL — not 'CO' — for 139639", () => {
    const loc = deriveInsertLocationColumns(LIVE_139639);
    expect(loc.normalized_state).toBeNull();
    expect(loc.source_jurisdiction).toBeNull();
    expect(loc.raw_location).toBe("United States");
    // Nothing derived → nothing to contradict (the NULL convention).
    expect(loc.location_conflict).toBeNull();
  });

  test("the foreign TITLE is what triggers the guard (the description is deliberately NOT a signal)", () => {
    expect(isForeignPlaceOfPerformance(LIVE_139639.title)).toBe(true);
    expect(hasForeignPlaceOfPerformance("United States", LIVE_139639.title)).toBe(true);
    // Same row, same agency, DOMESTIC title → the agency fallback is unchanged
    // (the guard is foreign-triggered only — the narrow scope of this change).
    const domestic = deriveInsertLocationColumns({
      ...LIVE_139639,
      title: "Trash Removal and Disposal, Fort Carson",
    });
    // S3 WRITE-PATH MIRROR (owner-approved 2026-09-23, Q2 = YES): the location
    // is the "United States" placeholder, i.e. NATIONAL SCOPE — the write path
    // now refuses the agency fallback exactly like the read path always did, so
    // the stored value is an honest NULL (it used to store "CO" from the
    // contracting-office token). A DOMESTIC title no longer re-enables the
    // fallback: the refusal is about the location, not the title.
    expect(domestic.normalized_state).toBeNull();
  });

  test("a passing country mention in a long DESCRIPTION never strips a correct state", () => {
    // SELECT-only dry-run over the 17,557 rows carrying a stored state: the
    // description ALONE fired the guard on 3,130 rows, 319 of which had a stored
    // state — most of them correct (DLA Philadelphia → PA, Lower Colorado
    // Regional Office → CO). The field policy therefore reads location + title
    // only. These fixtures are that measurement, pinned.
    const dla = deriveInsertLocationColumns({
      location: "United States",
      agency: "DLA AVIATION AT PHILADELPHIA, PA",
      title: "58--RECEIVER-TRANSMITTER",
      description:
        "Sole source item; manufactured in Germany; offerors must be registered with DLA Aviation at Philadelphia, PA.",
      sourceName: "sam_gov",
    });
    // S3 WRITE-PATH MIRROR (owner-approved 2026-09-23): with location "United
    // States" the stored state is NULL (national scope never borrows the
    // buyer's state). This is the write column ONLY — the read-path bucket is
    // the unchanged NATIONWIDE verdict pinned in (b) below, and the description
    // is still not a geography signal.
    expect(dla.normalized_state).toBeNull();

    const reclamation = deriveInsertLocationColumns({
      location: "United States",
      agency: "LOWER COLORADO REGIONAL OFFICE",
      title: "66--FLOW ANALYZER",
      description: "Deliveries under the 1944 Water Treaty to Mexico; see the Colorado River basin report.",
      sourceName: "sam_gov",
    });
    expect(reclamation.normalized_state).toBeNull();
  });

  test("a foreign-location row can never borrow a US state from the agency", () => {
    for (const location of [
      "Busan, South Korea",
      "Daegu, South Korea",
      "USAG-Daegu, Korea",
      "Pyeongtaek, KR",
      "Osan AB, KR",
      "APO, AE 09213",
      "Ramstein AB, Germany",
      "Okinawa, Japan",
    ]) {
      expect(isForeignPlaceField(location)).toBe(true);
      // The agency still carries a US-state-shaped token, and it is NOT used.
      expect(resolveBidState(location, LIVE_139639.agency)).toBeNull();
      expect(matchGeographyBucket("CO", location, LIVE_139639.agency)).toBe("nationwide");
      // Kept as nationwide/unknown for the state (never a LOCAL match) …
      expect(geoRelevant(location, LIVE_139639.agency, "CO")).toBe(true);
      // … and never stamped by the writer either.
      expect(
        deriveInsertLocationColumns({ ...LIVE_139639, location }).normalized_state,
      ).toBeNull();
    }
  });

  test("a state the PERFORMANCE LOCATION itself names is untouched (only the agency fallback is blocked)", () => {
    const loc = deriveInsertLocationColumns({
      ...LIVE_139639,
      location: "Norfolk, VA",
      description: "Support to operations in Busan, South Korea",
    });
    expect(loc.normalized_state).toBe("VA");
    expect(resolveBidState("Norfolk, VA", LIVE_139639.agency)).toBe("VA");
  });
});

describe("(b) domestic notices stamp exactly as before", () => {
  test("S3: a placeholder (national-scope) location writes NO state; the agency text fallback survives only for a location that names none", () => {
    const loc = deriveInsertLocationColumns({
      location: "United States",
      agency: "Commonwealth of Pennsylvania",
      title: "Janitorial and Custodial Services",
      description: null,
      sourceName: "sam_gov",
    });
    // S3 WRITE-PATH MIRROR (owner-approved 2026-09-23, Q2 = YES): "United
    // States" is national scope ⇒ the stored normalized_state is NULL, and the
    // source_jurisdiction (curated map ?? normalized_state) is NULL too. The
    // agency-TEXT fallback itself is untouched — it still applies to a row whose
    // location names no state at all (pinned below).
    expect(loc.normalized_state).toBeNull();
    expect(loc.source_jurisdiction).toBeNull();
    expect(loc.raw_location).toBe("United States");
    const noLocation = deriveInsertLocationColumns({
      location: "",
      agency: "Commonwealth of Pennsylvania",
      title: "Janitorial and Custodial Services",
      description: null,
      sourceName: "sam_gov",
    });
    expect(noLocation.normalized_state).toBe("PA");
  });

  test("a state-named buyer on a national-scope row still writes as before (DLA Philadelphia class)", () => {
    const loc = deriveInsertLocationColumns({
      location: "United States",
      agency: "DLA AVIATION AT PHILADELPHIA, PA",
      title: "Aircraft component spares",
      description: null,
      sourceName: "sam_gov",
    });
    // S3 WRITE-PATH MIRROR (owner-approved 2026-09-23): the STORED column is now
    // NULL for this DLA-Philadelphia-class row (national-scope location), while
    // the read path's FIX 2 verdict is untouched: NATIONWIDE.
    expect(loc.normalized_state).toBeNull();
    // …and the read path's FIX 2 pin is untouched: national scope is NATIONWIDE.
    expect(isNationalScope("United States")).toBe(true);
    expect(matchGeographyBucket("PA", "United States", loc.agency!)).toBe("nationwide");
  });

  test("location-derived and curated-source jurisdictions are untouched", () => {
    const va = deriveInsertLocationColumns({
      location: "Chesapeake, VA",
      agency: "NAVSUP FLT LOG CTR NORFOLK",
      title: "Janitorial services",
      description: null,
      sourceName: "bids_va",
    });
    expect(va.normalized_state).toBe("VA");

    // A portal whose home jurisdiction is provable by construction keeps it even
    // when the row's own text proves no US state (curated map, not text-derived).
    expect(SOURCE_HOME_JURISDICTIONS.pennbid).toBe("PA");
    const pennbid = deriveInsertLocationColumns({
      location: "United States",
      agency: "",
      title: "Busan Area trash removal support",
      description: null,
      sourceName: "pennbid",
    });
    expect(pennbid.normalized_state).toBeNull();
    expect(pennbid.source_jurisdiction).toBe("PA");
  });

  test("no false positive on domestic places whose names look foreign", () => {
    for (const text of [
      "Albuquerque, New Mexico",
      "New Mexico State University",
      "Santa Fe, NM",
      "Georgia",
      "Atlanta, GA",
      "Panama City, FL",
      "Lebanon, PA",
      "Peru, IN",
      "Indiana",
      "Naples, FL",
      "London, OH",
      "Chesapeake, VA",
      "Houston, TX",
      "Miami-Dade County, Florida",
      "Denver, CO",
      // Ordinary English words that collide with a country CODE when lowercased
      // ("it"/"is"/"no"/"me"/"to") must never read as foreign — codes are
      // matched as standalone UPPERCASE tokens only.
      "Janitorial services — it is required that no chemicals be used",
      "Be advised: do to the site what is needed, me included",
      "Snow and ice removal at the Campbell Tract facility",
    ]) {
      expect(isForeignPlaceOfPerformance(text)).toBe(false);
    }
    // The bare USPS codes are never foreign codes — proved exhaustively below.
    for (const code of US_STATES) {
      expect(isForeignPlaceOfPerformance(code)).toBe(false);
    }
  });
});

describe("(c) the ratified geography pins still hold (guard does not disturb them)", () => {
  test("agency-jurisdiction rule: OH-ARNG → Ohio LOCAL, provenance intact", () => {
    const ARNG = "W7NU USPFO ACTIVITY OH ARNG";
    expect(AGENCY_JURISDICTION_PROVENANCE).toBe("agency_jurisdiction_rule");
    expect(agencyJurisdictionState(ARNG)).toEqual({
      state: "OH",
      provenance: "agency_jurisdiction_rule",
    });
    expect(matchGeographyBucket("OH", "United States", ARNG)).toBe("local");
    expect(geoRelevant("United States", ARNG, "OH")).toBe(true);
    expect(matchGeographyBucket("PA", "United States", ARNG)).toBe("nationwide");
  });

  test("FIX 2 preserved: DLA-Philadelphia and MWR OHIO stay nationwide", () => {
    for (const [state, agency] of [
      ["PA", "DLA AVIATION AT PHILADELPHIA, PA"],
      ["NY", "W2SD ENDIST NEW YORK"],
      ["DC", "WASHINGTON DC OFFICE"],
      ["OH", "MWR OHIO (64000)"], // 11 live rows — separate verification case
      ["PA", "W7NU USPFO ACTIVITY PA ARNG"],
    ] as Array<[string, string]>) {
      expect(agencyJurisdictionState(agency)).toBeNull();
      expect(matchGeographyBucket(state, "United States", agency)).toBe("nationwide");
      expect(geoRelevant("United States", agency, state)).toBe(true);
    }
  });

  test("empty-location buyer fallback and contradiction flagging are unchanged", () => {
    expect(matchGeographyBucket("PA", null, "Pennsylvania Department of Environmental Protection")).toBe("local");
    expect(matchGeographyBucket("PA", "", "East Vincent Township, Chester County")).toBe("nationwide");
    expect(resolveBidState(null, "Commonwealth of Pennsylvania")).toBe("PA");
    expect(resolveBidState("United States", "DEPT OF TRANSPORTATION")).toBeNull();
    expect(locationConflict("USCG - JANITORIAL SERVICES - BASE NEW ORLEANS", null, "VA")).toBe(true);
  });

  test("the foreign-code list can NEVER collide with a USPS state code or a US territory", () => {
    const US_TERRITORY = ["PR", "GU", "VI", "AS", "MP", "UM", "US"];
    for (const c of FOREIGN_PLACE_CODES) {
      expect(US_STATES as readonly string[]).not.toContain(c);
      expect(US_TERRITORY).not.toContain(c);
    }
    // Spot-check the consequence: a bare USPS code in `location` is never read
    // as a foreign country, so the agency fallback still works there.
    expect(isForeignPlaceField("CO")).toBe(false);
    expect(resolveBidState("CO", "Commonwealth of Pennsylvania")).toBe("CO");
    // …while the discriminating overseas codes are live — in a PLACE field only.
    expect(isForeignPlaceField("KR")).toBe(true);
    expect(isForeignPlaceField("APO, AE 09213")).toBe(true);
    expect(isForeignPlaceField("DE")).toBe(false); // Delaware
    expect(isForeignPlaceField("CA")).toBe(false); // California
    expect(isForeignPlaceField("IN")).toBe(false); // Indiana
  });

  test("country CODES are place-field-only evidence — titles are matched on NAMES", () => {
    // Measured false-positive class (SELECT-only dry-run, 17,557 stored states):
    // part numbers and office designators are full of 2-letter uppercase tokens
    // that are country codes ("…0735NZ", "NAVFAC WASHINGTON FY26 AE IDIQ").
    // Reading those as foreign stripped 167 correct domestic states; titles
    // therefore never use code evidence.
    expect(isForeignPlaceOfPerformance("NSN: 2840-01-374-0735NZ")).toBe(false);
    expect(isForeignPlaceOfPerformance("NAVFAC WASHINGTON FY26 AE IDIQ INDUSTRIAL")).toBe(false);
    expect(hasForeignPlaceOfPerformance("United States", "NSN 0735NZ, AE IDIQ")).toBe(false);
    // The code form still counts where the field IS a place.
    expect(isForeignPlaceField("Busan, KR")).toBe(true);
    expect(hasForeignPlaceOfPerformance("Busan, KR", "Trash removal")).toBe(true);
    expect(hasForeignPlaceOfPerformance("APO, AE", "Elevator maintenance")).toBe(true);
  });

  test("a country named as the CUSTOMER is not a place of performance", () => {
    // Live row 134304: stored AL is CORRECT — DLA Aviation Huntsville buys
    // Raytheon upgrades for a Foreign Military Sales (Qatar) program; the work
    // is not performed in Qatar. "for the Qatar FMS" must not read as a place.
    expect(isForeignPlaceOfPerformance(
      "Sole Source to Raytheon | Upgrades for the Qatar FMS (Foreign Military Sales) PATRIOT Program",
    )).toBe(false);
    const fms = deriveInsertLocationColumns({
      location: "United States",
      agency: "DLA AVIATION AT HUNTSVILLE, AL",
      title: "Sole Source to Raytheon | Upgrades for the Qatar FMS (Foreign Military Sales) PATRIOT Program",
      description: null,
      sourceName: "sam_gov",
    });
    // S3 WRITE-PATH MIRROR (owner-approved 2026-09-23): location "United
    // States" is national scope, so the STORED state is now NULL — the FMS
    // point of this pin (a customer country is not a place of performance) is
    // unchanged and still proved by the isForeignPlaceOfPerformance assertion
    // above. The read-path bucket for this row stays NATIONWIDE.
    expect(fms.normalized_state).toBeNull();
    // …while a country the title actually PLACES still counts (comma boundary
    // and place preposition), and a country in a place field always counts.
    expect(isForeignPlaceOfPerformance("Laundry Services, Kunsan Air Base, South Korea")).toBe(true);
    expect(isForeignPlaceOfPerformance("Fuel Tank Inspection in Osan Air Base, Korea")).toBe(true);
    expect(isForeignPlaceField("Korea, South")).toBe(true);
    expect(isForeignPlaceField("Germany")).toBe(true);
    // A US town that shares a foreign country's name stays domestic (measured:
    // two live MT rows titled "MALTA FO UTV" — Malta, Montana, a BLM field
    // office; "malta" is therefore deliberately not a signal).
    expect(isForeignPlaceOfPerformance("23--MALTA FO UTV")).toBe(false);
    expect(isForeignPlaceOfPerformance("MALTA FO UTV")).toBe(false);
    const malta = deriveInsertLocationColumns({
      location: "Unknown",
      agency: "MONTANA STATE OFFICE",
      title: "MALTA FO UTV",
      description: null,
      sourceName: "mt",
    });
    // S3 WRITE-PATH MIRROR (owner-approved 2026-09-23): "Unknown" is itself a
    // national-scope placeholder in isNationalScope, so the STORED state is now
    // NULL here too — the read path has always bucketed such a row nationwide.
    expect(malta.normalized_state).toBeNull();
    // The agency TEXT fallback is intact where the location names no state at all.
    const noLoc = deriveInsertLocationColumns({
      location: "",
      agency: "MONTANA STATE OFFICE",
      title: "23--MALTA FO UTV",
      description: null,
      sourceName: "mt",
    });
    expect(noLoc.normalized_state).toBe("MT");
  });
});
