import { normalizeStateInput, resolveStateFromText, resolveBidState, geoRelevant, locationConflict } from "~/lib/location-state";
const assert = (c: boolean, m: string) => { if (!c) throw new Error("FAIL: " + m); };
assert(normalizeStateInput("VA") === "VA", "abbrev");
assert(normalizeStateInput("Virginia") === "VA", "full name");
assert(normalizeStateInput("pennsylvania") === "PA", "lowercase full");
assert(normalizeStateInput("ZZ") === "", "bogus fails open");
assert(resolveStateFromText("Chesapeake, VA") === "VA", "city-code");
assert(resolveStateFromText("Virginia") === "VA", "full-name loc");
assert(resolveStateFromText("West Virginia") === "WV", "west virginia wins");
assert(resolveStateFromText("Groton, Connecticut") === "CT", "full-name city");
// Legacy boundary behavior (unchanged): a code at string start counts in LOCATION resolution.
// The CONFLICT check is stricter (comma-form "CITY, XX" only) — asserted below.
assert(resolveStateFromText("VA Medical Center") === "VA", "legacy start-of-string code");
assert(resolveStateFromText("") === null, "empty");
assert(resolveBidState("United States", "DEPT OF TRANSPORTATION") === null, "no signal");
assert(resolveBidState(null, "Commonwealth of Pennsylvania") === "PA", "agency fallback");
assert(geoRelevant("United States", null, "VA") === true, "nationwide kept");
assert(geoRelevant("Chesapeake, VA", null, "VA") === true, "in-state");
assert(geoRelevant("Chesapeake, VA", null, "PA") === false, "wrong state");
assert(geoRelevant("Virginia", null, "VA") === true, "full-name location now counts");
assert(geoRelevant(null, "Pennsylvania DOT", "PA") === true, "agency fallback geo");
assert(locationConflict("USCG - JANITORIAL SERVICES - BASE NEW ORLEANS", null, "VA") === true, "New Orleans vs VA flagged");
assert(locationConflict("Design-Bid-Build... Groton, Connecticut", null, "VA") === true, "CT full name vs VA flagged");
assert(locationConflict("Janitorial and Custodial Services for Municipal Complex", null, "VA") === false, "no place signal not flagged");
assert(locationConflict("S201--Janitorial Services - Dayton VA Medical Center", null, "OH") === false, "VA Medical not a conflict");
assert(locationConflict("REPLACE FIRE ALARM SYSTEM, NAS OCEANA, VIRGINIA BEACH, VA", null, "WV") === true, "VA city-code vs WV flagged");
console.log("location-state selftest PASS");
