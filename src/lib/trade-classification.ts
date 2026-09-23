/**
 * Purchased-service classification for the janitorial + trucking trades
 * (owner PRIORITY 09-21, PR R4).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Two defects were quantified in `shared/janitorial-trucking-audit-2026-09-21.md`:
 *
 *   1. `mapCategory()` (duplicated in sam-gov.ts / state-keyword.ts / cities.ts)
 *      stamped `Janitorial` on ANY row whose title+description contained the
 *      bare substring "cleaning". 45% of the open rows we labelled janitorial
 *      were NOT janitorial service work: laundry/dry-cleaning, sewer/tank/duct/
 *      hood cleaning, munitions-rod cleaning, laser-cleaning systems and
 *      cleaning-SUPPLY buys. There was no trucking branch at all, so freight/
 *      moving rows fell into the `Construction` fallback.
 *   2. Nothing in the pipeline could recognise a truck/freight PRODUCT buy, so a
 *      bare "truck"/"trucking" query could reach "DUMP TRUCK", tire and vehicle
 *      listings.
 *
 * The owner's rule for this PR is PURCHASED-SERVICE-ONLY: a row is janitorial /
 * trucking work only when the purchased service IS that work. Shipping /
 * packaging / FOB / delivery-only / incidental-cleanup and product-buy contracts
 * must NOT be classified into these trades (and a dump-truck listing never is).
 *
 * HOW IT IS STRUCTURAL, NOT A LIST OF PATCHES
 * -------------------------------------------
 *   - A trade signal is a SERVICE PHRASE ("commercial cleaning", "cleaning
 *     services", "drayage", "hauling"), never the bare generic word
 *     ("cleaning", "truck", "delivery") on its own.
 *   - Two NEGATIVE guards veto the signal: product/equipment/supply buys, and
 *     (for cleaning) specialty non-custodial cleaning work.
 *   - Signal text is `title` for the transportation branch (high precision —
 *     descriptions mention "construction", "delivery" and "supplies" incidentally)
 *     and title+description for janitorial (the service phrases are specific
 *     enough to survive a description hit).
 *   - NOTHING here deletes or rewrites stored rows. It changes the stamp applied
 *     to rows ingested from now on; the audit's "do not downrank existing data"
 *     rule is honoured (no backfill in this PR).
 *   - Every pattern is deliberately narrow. When in doubt we return "not this
 *     trade" — an honest "Other" beats a false janitorial/trucking label.
 */

/**
 * Janitorial SERVICE signals: custodial cleaning work as a service. Deliberately
 * EXCLUDES the bare word "cleaning" (the false-positive amplifier: "ROD,CLEANING,
 * SMALL ARM" is munitions work, "cleaning supplies" is a product buy).
 */
export const JANITORIAL_SERVICE_PATTERNS: RegExp[] = [
  /\bjanitor/,
  /\bcustodial\b/,
  /\bhousekeep/,
  /\bcommercial cleaning\b/,
  /\bbuilding cleaning\b/,
  /\boffice cleaning\b/,
  /\bfloor cleaning\b/,
  /\bfloor care\b/,
  /\bcleaning services?\b/,
  /\bjanitorial services?\b/,
  /\bcustodial services?\b/,
  /\brestroom sanitation\b/,
  // OWNER 09-21 trade-term fold-in (the Ohio fix list): bare "sanitation" IS a
  // janitorial term — sanitation work is custodial work (the owner's janitorial
  // category list: restrooms/facility sanitation alongside refuse removal,
  // street cleaning, recycling, septic/sewer and snow removal). It is added as a
  // SERVICE SIGNAL only, NOT to JANITORIAL_EXPLICIT_PHRASES, so the product veto
  // in isJanitorialWork still wins: "SANITATION SUPPLIES"/"Sanitation Kit" stay
  // product buys, a genuinely specialty job ("septic tank sanitation") is still
  // vetoed by isSpecialtyCleaningOnly.
  /\bsanitation\b/,
];

/**
 * Cleaning work that is NOT routine custodial/janitorial service procurement —
 * a different purchased service (laundry, or cleaning of equipment, structures
 * and infrastructure) that must never be labelled janitorial. Taken from the
 * audit's quantified false positives (§2.4).
 */
export const SPECIALTY_CLEANING_PATTERNS: RegExp[] = [
  /\blaundry\b/,
  /\bdry[ -]clean/,
  // S6 CLASSIFIER ORDER (owner-approved 2026-09-23, D6): the blanket
  // /\btank/, /\bsewer/, /\bpipe/ and /\bstreet sweep/ vetoes were REMOVED. They
  // match ordinary custodial prose and infrastructure that the owner's own
  // janitorial term list counts as janitorial work (sewer/septic, street
  // cleaning) — "sewer cleaning services", "pipe cleaning", "street sweeping"
  // are custodial contracts, and a custodial contract was being vetoed out of
  // its own trade. The genuinely NON-custodial specialities below (laundry,
  // duct/hood/exhaust, septic tank, wet well, interceptor, hydro/jetting,
  // CCTV/video inspection, hull/u-wild, laser/gun-range, catch basin,
  // degreasing, parts washer, chimney/gutter, CBRNE mobility gear, rod
  // cleaning, remediation/"specialty cleaning") are unchanged: the module's
  // intended scope — cleaning of equipment/structures/infrastructure — is
  // preserved, it is only the over-broad vocabulary that is narrowed.
  /\bduct/,
  /\bhood\b/,
  /\bseptic\b/,
  /\bwet ?well/,
  /\binterceptor\b/,
  /\bline clean/,
  /\bhydro/,
  /\bjetting\b/,
  /\bcctv\b/,
  /\bvideo inspection\b/,
  /\bexhaust fan/,
  /\bhull\b/,
  /\buwild\b/,
  /\bair ?screen/,
  /\blaser clean/,
  /\bgun range/,
  /\bcatch basin/,
  /\bdegreas/,
  /\bparts washer/,
  /\bchimney\b/,
  /\bgutter/,
  /\bcbrne\b/,
  /\bmobility gear/,
  /\brod\b[^a-z0-9]{0,3}cleaning\b/,
  // Remediation / "specialty cleaning" work (QA fix-round: PR #414's R3 change
  // made "cleaning services" a curated janitorial term, which turned the owner's
  // FIX-1 pin "Remediation and Specialty Cleaning Services" into a STRONG default
  // janitorial match — a biohazard/mold/remediation contract is 562910-class
  // work, not custodial work). A row that also spells out custodial/janitorial/
  // housekeeping work still keeps its janitorial identity via isSpecialtyCleaningOnly.
  /\bspecialty clean/,
  /\bremediat/,
];

/**
 * Product / equipment / supply buys. Applied to the TITLE ONLY (a description
 * routinely mentions supplies, delivery and equipment in boilerplate), so a
 * service solicitation is never suppressed by its own description.
 */
export const PRODUCT_BUY_PATTERNS: RegExp[] = [
  /\bsuppl(y|ies)\b/,
  /\bpurchase of\b/,
  /\bprocurement of\b/,
  /\bbid for the purchase\b/,
  /\bblanket purchase\b/,
  /\bkit\b/,
  /\bchemicals?\b/,
  /\bdispensers?\b/,
  /\bsoap\b/,
  /\bpaper towels?\b/,
  /\bsanitizers?\b/,
  /\bappliances?\b/,
  /\bscrubbers?\b/,
  /\bvacuum/,
  /\btires?\b/,
  /\bvehicles?\b/,
  /\btrailers?\b/,
  /\bparts\b/,
  // Fuel / lubricant is a SUPPLY, not transportation SERVICE work (QA F4b: the
  // live `naics=484110` result "91--Service, Diesel Fuel and Delivery" is a fuel
  // buy with delivery, not a trucking solicitation). The explicit-service-phrase
  // escape keeps a real service contract that merely mentions fuel
  // ("Fuel delivery services for the depot").
  /\bfuel\b/,
  // Materials-handling EQUIPMENT (audit §2.2: "39--CART, GENERAL HAULING" is a
  // cart product whose "hauling" word previously matched the trucking branch).
  /\bcarts?\b/,
];

/**
 * Vehicle-product / dump-truck guard. A dump-truck listing (or the purchase of a
 * truck, its parts or its tires) is a VEHICLE/equipment buy, never trucking
 * service work — the owner's explicit "exclude dump-truck listings" rule.
 */
export const DUMP_TRUCK_PATTERNS: RegExp[] = [
  /\bdump truck/,
  /\bdump[- ]body/,
  /\bself[- ]loading/,
  /\btruck\b.*\b(for sale|purchase|buy)\b/,
  /\bpurchase\b.*\btruck\b/,
];

/**
 * Trucking / freight / moving / courier SERVICE signals. Deliberately EXCLUDES
 * bare "truck", "transport", "delivery", "moving" and "carrier" alone (each is
 * generic to procurement — the registry's GENERIC_TRADE_TERMS set encodes the
 * same rule for matching).
 */
export const TRANSPORTATION_SERVICE_PATTERNS: RegExp[] = [
  /\btrucking\b/,
  /\btruckload\b/,
  /\bltl\b/,
  /\bless than truckload\b/,
  /\bfreight\b/,
  /\bhauling\b/,
  /\bhauler\b/,
  /\bdrayage\b/,
  /\bmotor carrier\b/,
  /\bflatbed\b/,
  /\bdry van\b/,
  /\bcourier services?\b/,
  /\bdelivery services?\b/,
  /\bexpress delivery\b/,
  /\bmoving services?\b/,
  /\bhousehold goods\b/,
  /\bhhg\b/,
  /\brelocation\b/,
  /\bbackhaul\b/,
  // S6 CLASSIFIER ORDER (owner-approved 2026-09-23, D5): "transport(ation)"
  // and "towing" are trucking/hauling SERVICE signals, not generic words, and
  // their absence lost real work ("Transportation of Vehicles, Parts and
  // Supplies", "Vehicle Towing & Transport"). Bare "truck"/"delivery"/"moving"
  // stay excluded exactly as before.
  /\btransport/,
  /\btowing\b/,
];

function anyMatch(patterns: RegExp[], text: string): boolean {
  if (!text) return false;
  const t = String(text).toLowerCase();
  return patterns.some((re) => re.test(t));
}

/**
 * The EXPLICIT multi-word janitorial service phrasings — used to decide whether
 * a title that NAMES a product is really a product buy ("JANITORIAL SUPPLIES -
 * GROUP N" is; "Janitorial and Custodial Services" is not). A lone "janitorial"
 * in a title is not enough on its own here, because that is exactly the word a
 * supplies catalogue uses.
 */
const JANITORIAL_EXPLICIT_PHRASES: RegExp[] = [
  /\bjanitorial services?\b/,
  /\bcustodial services?\b/,
  /\bcleaning services?\b/,
  /\bcommercial cleaning\b/,
  /\bbuilding cleaning\b/,
  /\boffice cleaning\b/,
  /\bfloor cleaning\b/,
  /\bfloor care\b/,
  /\brestroom sanitation\b/,
];

/** Does the text spell out a janitorial SERVICE phrase (not just the trade word)? */
export function hasExplicitJanitorialServicePhrase(text: string): boolean {
  return anyMatch(JANITORIAL_EXPLICIT_PHRASES, text);
}

/**
 * The EXPLICIT transportation SERVICE phrasings — the transportation counterpart
 * of JANITORIAL_EXPLICIT_PHRASES (QA F3). These decide whether a title that also
 * names a PRODUCT is really a SERVICE contract: "Freight hauling services for the
 * base supply run" is a hauling contract (its "supply" word is the run, not the
 * purchase), while "FREIGHT TIRES" / "HAULING EQUIPMENT PARTS" are product buys.
 *
 * Deliberately EXCLUDES the bare single verbs/nouns ("freight", "hauling", "ltl",
 * "flatbed", "dry van", "relocation") — each of those is exactly the word a
 * product title re-uses ("HAULING EQUIPMENT PARTS", "FREIGHT TIRES"), so bare
 * presence must never defeat the product veto.
 */
const TRANSPORTATION_EXPLICIT_PHRASES: RegExp[] = [
  /\btrucking\b/,
  /\btruckload\b/,
  /\bless than truckload\b/,
  /\bfreight\s+(?:services?|hauling|forwarding|transportation|brokerage)\b/,
  /\bhauling\s+services?\b/,
  /\bdrayage\b/,
  /\bmotor carrier\b/,
  /\bcourier services?\b/,
  /\bdelivery services?\b/,
  /\bexpress delivery\b/,
  /\bmoving services?\b/,
  /\bhousehold goods\b/,
  /\bhhg\b/,
  /\brelocation services?\b/,
  // S6 (D5): the escape that lets a title naming a PRODUCT still be a transport
  // SERVICE contract. "Transportation of Vehicles, Parts and Supplies" and
  // "Vehicle Towing & Transport" are service contracts whose titles also carry
  // product nouns ("vehicles", "parts", "supplies"); without these two phrasings
  // the product veto suppressed genuine hauling/towing work.
  //
  // DELIBERATELY still WITHOUT a bare /\bhauling\b/: that is exactly the word a
  // product title re-uses ("39--CART, GENERAL HAULING", "HAULING EQUIPMENT
  // PARTS"), and the QA F4b/F3 pins require those to stay vetoed. "towing" and
  // "transport(ation)" are NOT re-used as product nouns.
  /\btransport/,
  /\btowing\b/,
];

/** Does the text spell out a transportation SERVICE phrase (not just the trade word)? */
export function hasExplicitTransportationServicePhrase(text: string): boolean {
  return anyMatch(TRANSPORTATION_EXPLICIT_PHRASES, text);
}

/** Custodial cleaning work AS A SERVICE (never a bare "cleaning" mention). */
export function isJanitorialService(text: string): boolean {
  return anyMatch(JANITORIAL_SERVICE_PATTERNS, text);
}

/** Cleaning of equipment/structures/infrastructure or laundry — NOT custodial work. */
export function isSpecialtyCleaning(text: string): boolean {
  return anyMatch(SPECIALTY_CLEANING_PATTERNS, text);
}

/** A product/supply/equipment buy (title only — see PRODUCT_BUY_PATTERNS). */
export function isProductBuy(title: string): boolean {
  return anyMatch(PRODUCT_BUY_PATTERNS, title);
}

/**
 * Specialty (non-custodial) cleaning that must not be *mistaken* for janitorial
 * work — the audit's quantified false positives ("Cleaning of Food Service
 * Exhaust Fans and Ducts", "Laundry and Dry-Cleaning CBRNE Mobility Gear").
 *
 * Refinement (deliberate): a row that explicitly says it IS custodial/janitorial/
 * housekeeping work keeps its janitorial identity even when a component of the
 * scope is specialty cleaning ("Janitorial services including kitchen hood
 * cleaning" is a janitorial contract). Only the specialty-ONLY case is vetoed.
 */
export function isSpecialtyCleaningOnly(text: string): boolean {
  if (!isSpecialtyCleaning(text)) return false;
  return !/\bjanitor|\bcustodial\b|\bhousekeep/.test(text);
}

/** Freight / trucking / moving / courier SERVICE work. */
export function isTransportationService(text: string): boolean {
  return anyMatch(TRANSPORTATION_SERVICE_PATTERNS, text);
}

/** A dump-truck / vehicle-product listing (owner: always excluded). */
export function isDumpTruckLike(text: string): boolean {
  return anyMatch(DUMP_TRUCK_PATTERNS, text);
}

/**
 * The janitorial decision, single-point and reusable: the row must BE custodial
 * service work and must not be a cleaning-supply/equipment buy or a specialty
 * (non-custodial) cleaning job. `title` drives the product veto; `full` carries
 * the service/specialty signal.
 */
export function isJanitorialWork(title: string, full: string): boolean {
  // Product veto — but a title that spells out a janitorial SERVICE phrase is a
  // service contract even when it also buys consumables ("Janitorial and
  // Custodial Services, supplies included" stays janitorial).
  if (isProductBuy(title) && !hasExplicitJanitorialServicePhrase(title)) return false;
  if (!isJanitorialService(full)) return false;
  return !isSpecialtyCleaningOnly(full);
}

/**
 * The trucking/transportation decision, single-point and reusable. The service
 * signal is read from the TITLE (descriptions mention hauling/relocation
 * incidentally), and BOTH negative guards apply — the dump-truck/vehicle guard
 * AND the product/supply/equipment veto (QA F3: this branch previously skipped
 * the product veto entirely, so a title such as "FREIGHT TIRES" or "HAULING
 * EQUIPMENT PARTS" — a transport service word inside a PRODUCT listing — was
 * stamped Transportation, contradicting this function's own contract).
 *
 * The product veto is skipped when the title itself names the transport SERVICE
 * ("Freight hauling services for the base supply run" is a hauling contract, not
 * a supply buy) — see hasExplicitTransportationServicePhrase.
 */
export function isTransportationWork(title: string, _full: string): boolean {
  const titleLc = (title || "").toLowerCase();
  if (isDumpTruckLike(titleLc)) return false;
  if (isProductBuy(titleLc) && !hasExplicitTransportationServicePhrase(titleLc)) return false;
  return isTransportationService(titleLc);
}

/**
 * The shared ingest `category` stamp (was duplicated, with a bare-"cleaning"
 * janitorial branch and no trucking branch, in sam-gov.ts / state-keyword.ts /
 * cities.ts).
 *
 * S5 CLASSIFIER ORDER (owner-approved 2026-09-23, D3/D4). Two things changed,
 * and they are the WHOLE of this function's change:
 *
 *   1. ORDER — a service-specific trade is now decided BEFORE the
 *      construction/type fallbacks for janitorial too, not only for
 *      landscaping/transportation. Before this, a custodial contract whose
 *      boilerplate mentioned "construction" (or whose notice type was a
 *      Solicitation) was stamped `Construction` and never reached
 *      `isJanitorialWork`. Landscaping → Transportation → Janitorial now all
 *      precede the construction/it/security/hvac/plumbing text branches.
 *   2. NOTICE TYPE — an `Award` / `Justification` / `Special` notice is NEVER
 *      stamped `Construction` any more (D4). The legacy
 *      `award|special → Construction` mapping is gone; those types fall through
 *      to the honest `Other`. `solicitation`/`combined` keep their existing
 *      `Construction` stamp (unchanged behavior). Callers now feed the row's
 *      REAL notice type (cities.ts / state-keyword.ts no longer pass "").
 *
 * A product/dump-truck listing still can never enter a service trade, and the
 * purchased-service gate is the SAME function the trade passes skip on (D7):
 * see `tradePassExclusion` and the invariant pinned in
 * `src/lib/classifier-order.test.ts` — a row this function stamps
 * `Transportation`/`Janitorial` can never be one the corresponding trade pass
 * would refuse, so the same notice is classified identically whichever pass
 * (or door) picked it up.
 */
export function mapCategory(typeValue: string, title: string, description: string): string {
  const t = (typeValue || "").toLowerCase();
  const titleLc = (title || "").toLowerCase();
  const full = (titleLc + " " + (description || "").toLowerCase()).trim();

  if (full.includes("landscap") || full.includes("grounds main")) return "Landscaping";
  if (isTransportationWork(titleLc, full)) return "Transportation";
  // Owner 09-21: janitorial = custodial service work only (no bare "cleaning").
  // S5: moved AHEAD of the construction/type fallbacks (D3).
  if (isJanitorialWork(titleLc, full)) return "Janitorial";
  if (full.includes("construction") || full.includes("renovation") || full.includes("demolition")) return "Construction";
  if (full.includes("it ") && (full.includes("service") || full.includes("support") || full.includes("software") || full.includes("cloud"))) return "IT Services";
  if (full.includes("security") || full.includes("guard ")) return "Security";
  if (full.includes("hvac") || full.includes("heating") || full.includes("cooling")) return "HVAC";
  if (full.includes("electrical") || full.includes("plumbing")) return "Plumbing & Electrical";

  if (t.includes("solicitation") || t.includes("combined")) return "Construction";
  // S5/D4: `award` / `justification` / `special` deliberately fall through to the
  // honest "Other" (never "Construction").
  return "Other";
}

/** Reason keys recorded when a trade pass refuses a notice. */
export type TradeGateReason = "product_buy" | "dump_truck" | "specialty_cleaning_only";

/**
 * D7 — THE GATE IS PER-NOTICE, NOT PER-CALL (owner-approved 2026-09-23).
 *
 * Before this, the purchased-service gate existed only inside the 11 structured
 * trade passes (`tradePassExclusion` called from sam-gov-trades.ts), while every
 * other SAM.gov-family source (the national/regional pass, `cities`, the 51
 * doors) applied only LABEL-level gating. The SAME federal notice was therefore
 * refused as a product buy when it arrived through `naics=484110` and stored
 * unchanged when it arrived through `sam_gov` — one notice, two outcomes,
 * decided by which query happened to return it.
 *
 * This function is the single decision for one NOTICE (title + description), for
 * BOTH trades at once, independent of the pass that fetched it. Everything that
 * gates a notice routes through it:
 *   - the 11 trade passes (`tradePassExclusion` below is a thin wrapper, so the
 *     pass skip reason and the classifier can never disagree);
 *   - `mapCategory`'s trade branches (`isJanitorialWork` / `isTransportationWork`
 *     consult the same negative guards), so a notice is stamped the same trade
 *     whichever source stored it.
 *
 * Deliberately an EXCLUSION gate, not a positive requirement: a genuine trucking
 * notice may carry no service phrase at all ("Office Move", 484210) and must
 * never be lost, whereas the negative guards (a product/supply/equipment buy, a
 * dump-truck listing, specialty-only cleaning) are exactly the owner's
 * exclusions. `title` drives the product veto; `description` carries the
 * specialty-cleaning signal, matching isJanitorialWork / isTransportationWork.
 */
export interface TradeGateDecision {
  janitorial: TradeGateReason | null;
  trucking: TradeGateReason | null;
  /** The trade labels on NEGATIVE evidence — identical for every caller. */
  refused: Array<"janitorial" | "trucking">;
}

export function tradeGateForNotice(title: string, description: string): TradeGateDecision {
  const titleLc = (title || "").toLowerCase();
  const full = `${titleLc} ${(description || "").toLowerCase()}`.trim();
  const dumpTruck = isDumpTruckLike(titleLc);
  const productBuy = isProductBuy(titleLc);
  const janitorial: TradeGateReason | null = dumpTruck
    ? "dump_truck"
    : productBuy && !hasExplicitJanitorialServicePhrase(titleLc)
      ? "product_buy"
      : isSpecialtyCleaningOnly(full)
        ? "specialty_cleaning_only"
        : null;
  const trucking: TradeGateReason | null = dumpTruck
    ? "dump_truck"
    : productBuy && !hasExplicitTransportationServicePhrase(titleLc)
      ? "product_buy"
      : null;
  const refused: Array<"janitorial" | "trucking"> = [];
  if (janitorial) refused.push("janitorial");
  if (trucking) refused.push("trucking");
  return { janitorial, trucking, refused };
}

/**
 * TRADE-PASS ELIGIBILITY (owner PRIORITY 09-21, R3/R4 — QA F4b; unified by D7).
 *
 * A structured-filter pass (`naics=484110`, `psc=S201`, …) asks SAM for every
 * notice SAM has coded with that code — and SAM's codes include PRODUCT
 * contracts. Live `naics=484110` returns "Depot Consumable Parts Processing &
 * Disposal (DEMIL)" and "Removal of 32 FT Bathroom Trailer": not trucking work.
 * This gate runs per notice BEFORE mapping, so such a row can never enter the
 * pass's output and can never be stamped with the trade's code.
 *
 * D7: this is now only a projection of `tradeGateForNotice` — one decision for
 * one notice, identical no matter which pass (or door) fetched it.
 *
 * Returns the skip reason, or null when the notice may enter the trade's set.
 */
export function tradePassExclusion(
  trade: "janitorial" | "trucking",
  title: string,
  description: string,
): TradeGateReason | null {
  return tradeGateForNotice(title, description)[trade];
}
