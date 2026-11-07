/**
 * Pennsylvania and Virginia buyers on Beacon (owner 2026-11-07: "Yes do Pennsylvania, Virginia and Ohio").
 * Each buyer's own site links its beaconbid.com/solicitations/<tag> list (captured 2026-11-07:
 * vbschools.com/budget/procurement, ridegrtc.com procurement page, pghschools.org RFPs). Read with the
 * shared Beacon reader: open solicitations only, no login.
 */
import type { FetchResult } from "../runner";
import { fetchBeaconAgency, type BeaconAgency } from "./tx-houston-beacon";

export const PAVA_BEACON_AGENCIES: readonly BeaconAgency[] = [
  { source: "va_vbcps_beacon", agencyTag: "va-beach-city-public-schools", agency: "Virginia Beach City Public Schools", location: "Virginia Beach, VA", idPrefix: "vbcpsbeacon" },
  { source: "va_grtc_beacon", agencyTag: "grtc-transit", agency: "GRTC Transit System", location: "Richmond, VA", idPrefix: "grtcbeacon" },
  { source: "pa_pittsburgh_schools_beacon", agencyTag: "pittsburgh-public-school-district", agency: "Pittsburgh Public Schools", location: "Pittsburgh, PA", idPrefix: "pghschoolsbeacon" },
];

export const PAVA_BEACON_SOURCES: { name: string; fetchFn: () => Promise<FetchResult> }[] = PAVA_BEACON_AGENCIES.map((a) => ({
  name: a.source,
  fetchFn: () => fetchBeaconAgency(a),
}));
