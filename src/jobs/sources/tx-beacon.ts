/**
 * Texas buyers on Beacon (owner 2026-11-10, "resume the texas cities work"). The City of New Braunfels
 * moved its formal solicitations from Workday to Beacon: its Purchasing page
 * (newbraunfels.gov/531/Purchasing, captured 2026-11-10) links
 *   https://www.beaconbid.com/solicitations/city-of-new-braunfels/open
 * Read with the shared Beacon reader (tx-houston-beacon.ts): open solicitations only, no login.
 */
import type { FetchResult } from "../runner";
import { fetchBeaconAgency, type BeaconAgency } from "./tx-houston-beacon";

export const TX_BEACON_AGENCIES: readonly BeaconAgency[] = [
  { source: "tx_new_braunfels_beacon", agencyTag: "city-of-new-braunfels", agency: "City of New Braunfels", location: "New Braunfels, TX", idPrefix: "newbraunfelsbeacon" },
];

export const TX_BEACON_SOURCES: { name: string; fetchFn: () => Promise<FetchResult> }[] = TX_BEACON_AGENCIES.map((a) => ({
  name: a.source,
  fetchFn: () => fetchBeaconAgency(a),
}));
