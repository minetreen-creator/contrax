/**
 * Tennessee buyers on Beacon (owner 2026-11-06: "I want ALL construction bids in TN"). Each one's
 * own website sends bidders to its beaconbid.com/solicitations/<tag>/open list (captured
 * 2026-11-06: memphistn.gov/rfp-rfq, cityofalcoa-tn.gov/389, bradleyschools.org, mtpleasant-tn.gov).
 * Read with the shared Beacon reader (tx-houston-beacon.ts): open solicitations only, no login.
 */
import type { FetchResult } from "../runner";
import { fetchBeaconAgency, type BeaconAgency } from "./tx-houston-beacon";

export const TN_BEACON_AGENCIES: readonly BeaconAgency[] = [
  { source: "tn_memphis_beacon", agencyTag: "city-of-memphis-95", agency: "City of Memphis", location: "Memphis, TN", idPrefix: "memphisbeacon" },
  { source: "tn_alcoa_beacon", agencyTag: "city-of-alcoa", agency: "City of Alcoa", location: "Alcoa, TN", idPrefix: "alcoabeacon" },
  { source: "tn_bradley_schools_beacon", agencyTag: "bradley-county-schools", agency: "Bradley County Schools", location: "Bradley County, TN", idPrefix: "bradleyschoolsbeacon" },
  { source: "tn_mount_pleasant_beacon", agencyTag: "city-of-mount-pleasant", agency: "City of Mount Pleasant", location: "Mount Pleasant, TN", idPrefix: "mtpleasantbeacon" },
];

export const TN_BEACON_SOURCES: { name: string; fetchFn: () => Promise<FetchResult> }[] = TN_BEACON_AGENCIES.map((a) => ({
  name: a.source,
  fetchFn: () => fetchBeaconAgency(a),
}));
