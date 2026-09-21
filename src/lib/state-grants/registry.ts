/**
 * Contrax Grants — STATE REGISTRY (owner ROLLOUT order 2026-09-18, part 1;
 * coverage ladder corrected by the owner's 2026-09-19 review).
 *
 * PURE MODULE: no DB, no network, no node builtins (it reads only the connector
 * objects themselves, which are pure). The `state_grant_registry` TABLE is a
 * MIRROR of this module (written by store.server.ts `syncStateRegistry()`), never
 * an independent source of truth.
 *
 * FAIL-CLOSED DERIVATION — the heart of this file
 *   A state reports a VALIDATED tier (limited | curated | connected) ONLY when
 *   ALL of these hold:
 *     1. at least one connector is registered for it,
 *     2. a source-validation manifest entry exists for it,
 *     3. the entry agrees with the connector on the connector id AND the source
 *        URL (checked for EVERY connector of the state, not just one),
 *     4. every connector's `officialHost` is on the approved-host allowlist, and
 *     5. the entry declares a valid coverage TIER.
 *   Anything else → `unavailable`, with a machine-readable reason. There is no
 *   code path that lets a hand-set status, a connector alone, or a hopeful
 *   default reach a validated tier.
 *
 * THE LADDER (owner 2026-09-19; proposed wording, pending owner confirmation of
 * the prose — the four VALUES themselves are the owner's):
 *   unavailable = no validated source for this state. Nothing is served.
 *   limited     = one, or a few, validated SINGLE-AGENCY sources. Real records,
 *                 but plainly not a statewide view (this is Virginia today: one
 *                 tourism source).
 *   curated     = a state's own curated/portal listing, or manually curated
 *                 substantive coverage across agencies.
 *   connected   = statewide comprehensive MULTI-SOURCE coverage.
 *   The tier is DECLARED by the manifest entry (a human judgement about coverage)
 *   and then ENFORCED structurally: `connected` additionally requires at least
 *   two distinct registered sources, so a single-source state can never be
 *   advertised as statewide comprehensive. A `connected` claim that fails that
 *   test is downgraded to `limited` with the reason spelled out.
 *
 *   Adding a state still means: connector → source-validation test → manifest
 *   entry (+ host on the allowlist) → suites green. Until then it is
 *   `unavailable`, even with a perfect connector. That is the point.
 *
 * All 50 states + DC are listed. 19 states are `unavailable` on purpose
 * (2026-09-19: Virginia, the five P3 batch-1 states, the three NATIONWIDE
 * batch-1 states — CA, KS, WA — and the five NATIONWIDE batch-2 states — AR, CO,
 * MN, ND, NM — are validated as `limited`, one source each; NC and Utah exited
 * batch 1 under the checklist §0 exit rule with no dependable official dated
 * listing and therefore have NO manifest entry): the registry
 * existing is NOT coverage, and nothing in the rollout may imply nationwide
 * coverage (owner order). The coverage UI reads listStates().
 */
import {
  VIRGINIA_APPROVED_HOSTS,
  VIRGINIA_CONNECTOR_ID,
  VIRGINIA_SOURCE_URL,
  VIRGINIA_SOURCE_VALIDATION_TEST,
  virginiaConnector,
} from "~/lib/state-grants/connectors/virginia";
import {
  ARIZONA_APPROVED_HOSTS,
  ARIZONA_CONNECTOR_ID,
  ARIZONA_SOURCE_URL,
  ARIZONA_SOURCE_VALIDATION_TEST,
  arizonaConnector,
} from "~/lib/state-grants/connectors/arizona";
import {
  DELAWARE_APPROVED_HOSTS,
  DELAWARE_CONNECTOR_ID,
  DELAWARE_SOURCE_URL,
  DELAWARE_SOURCE_VALIDATION_TEST,
  delawareConnector,
} from "~/lib/state-grants/connectors/delaware";
import {
  HAWAII_APPROVED_HOSTS,
  HAWAII_CONNECTOR_ID,
  HAWAII_SOURCE_URL,
  HAWAII_SOURCE_VALIDATION_TEST,
  hawaiiConnector,
} from "~/lib/state-grants/connectors/hawaii";
import {
  PENNSYLVANIA_APPROVED_HOSTS,
  PENNSYLVANIA_CONNECTOR_ID,
  PENNSYLVANIA_SOURCE_URL,
  PENNSYLVANIA_SOURCE_VALIDATION_TEST,
  pennsylvaniaConnector,
} from "~/lib/state-grants/connectors/pennsylvania";
import {
  RHODE_ISLAND_APPROVED_HOSTS,
  RHODE_ISLAND_CONNECTOR_ID,
  RHODE_ISLAND_SOURCE_URL,
  RHODE_ISLAND_SOURCE_VALIDATION_TEST,
  rhodeIslandConnector,
} from "~/lib/state-grants/connectors/rhode-island";
// NATIONWIDE workstream, batch 1 (owner order 2026-09-19): CA, KS, WA.
import {
  CALIFORNIA_APPROVED_HOSTS,
  CALIFORNIA_CONNECTOR_ID,
  CALIFORNIA_SOURCE_URL,
  CALIFORNIA_SOURCE_VALIDATION_TEST,
  californiaConnector,
} from "~/lib/state-grants/connectors/california";
import {
  KANSAS_APPROVED_HOSTS,
  KANSAS_CONNECTOR_ID,
  KANSAS_SOURCE_URL,
  KANSAS_SOURCE_VALIDATION_TEST,
  kansasConnector,
} from "~/lib/state-grants/connectors/kansas";
import {
  WASHINGTON_APPROVED_HOSTS,
  WASHINGTON_CONNECTOR_ID,
  WASHINGTON_SOURCE_URL,
  WASHINGTON_SOURCE_VALIDATION_TEST,
  washingtonConnector,
} from "~/lib/state-grants/connectors/washington";
// NATIONWIDE workstream, batch 2 (owner order 2026-09-19): AR, CO, MN, ND, NM.
import {
  ARKANSAS_APPROVED_HOSTS,
  ARKANSAS_CONNECTOR_ID,
  ARKANSAS_SOURCE_URL,
  ARKANSAS_SOURCE_VALIDATION_TEST,
  arkansasConnector,
} from "~/lib/state-grants/connectors/arkansas";
import {
  COLORADO_APPROVED_HOSTS,
  COLORADO_CONNECTOR_ID,
  COLORADO_SOURCE_URL,
  COLORADO_SOURCE_VALIDATION_TEST,
  coloradoConnector,
} from "~/lib/state-grants/connectors/colorado";
import {
  MINNESOTA_APPROVED_HOSTS,
  MINNESOTA_CONNECTOR_ID,
  MINNESOTA_SOURCE_URL,
  MINNESOTA_SOURCE_VALIDATION_TEST,
  minnesotaConnector,
} from "~/lib/state-grants/connectors/minnesota";
import {
  NORTH_DAKOTA_APPROVED_HOSTS,
  NORTH_DAKOTA_CONNECTOR_ID,
  NORTH_DAKOTA_SOURCE_URL,
  NORTH_DAKOTA_SOURCE_VALIDATION_TEST,
  northDakotaConnector,
} from "~/lib/state-grants/connectors/north-dakota";
import {
  NEW_MEXICO_APPROVED_HOSTS,
  NEW_MEXICO_CONNECTOR_ID,
  NEW_MEXICO_SOURCE_URL,
  NEW_MEXICO_SOURCE_VALIDATION_TEST,
  newMexicoConnector,
} from "~/lib/state-grants/connectors/new-mexico";
// ESCALATION PASS (owner escalation order 2026-09-19, checklist §0.5): two of
// the 14 UNCERTAIN jurisdictions whose sources the re-probe turned up.
import {
  TENNESSEE_APPROVED_HOSTS,
  tennesseeConnector,
  TENNESSEE_CONNECTOR_ID,
  TENNESSEE_SOURCE_URL,
  TENNESSEE_SOURCE_VALIDATION_TEST,
} from "~/lib/state-grants/connectors/tennessee";
import {
  UTAH_APPROVED_HOSTS,
  utahConnector,
  UTAH_CONNECTOR_ID,
  UTAH_SOURCE_URL,
  UTAH_SOURCE_VALIDATION_TEST,
} from "~/lib/state-grants/connectors/utah";
// NATIONWIDE workstream — the continuous tranche after the escalation pass
// (owner correction 2026-09-19, ratified 243: ONE continuous nationwide
// workstream, no separate batches): DC, WV, KY, AL, ME. Each is ONE agency's own
// listing, so each declares `limited`.
import {
  DISTRICT_OF_COLUMBIA_APPROVED_HOSTS,
  DISTRICT_OF_COLUMBIA_CONNECTOR_ID,
  DISTRICT_OF_COLUMBIA_SOURCE_URL,
  DISTRICT_OF_COLUMBIA_SOURCE_VALIDATION_TEST,
  districtOfColumbiaConnector,
} from "~/lib/state-grants/connectors/district-of-columbia";
import {
  WEST_VIRGINIA_APPROVED_HOSTS,
  westVirginiaConnector,
  WEST_VIRGINIA_CONNECTOR_ID,
  WEST_VIRGINIA_SOURCE_URL,
  WEST_VIRGINIA_SOURCE_VALIDATION_TEST,
} from "~/lib/state-grants/connectors/west-virginia";
import {
  KENTUCKY_APPROVED_HOSTS,
  kentuckyConnector,
  KENTUCKY_CONNECTOR_ID,
  KENTUCKY_SOURCE_URL,
  KENTUCKY_SOURCE_VALIDATION_TEST,
} from "~/lib/state-grants/connectors/kentucky";
import {
  ALABAMA_APPROVED_HOSTS,
  alabamaConnector,
  ALABAMA_CONNECTOR_ID,
  ALABAMA_SOURCE_URL,
  ALABAMA_SOURCE_VALIDATION_TEST,
} from "~/lib/state-grants/connectors/alabama";
import {
  MAINE_APPROVED_HOSTS,
  maineConnector,
  MAINE_CONNECTOR_ID,
  MAINE_SOURCE_URL,
  MAINE_SOURCE_VALIDATION_TEST,
} from "~/lib/state-grants/connectors/maine";
import {
  nevadaConnector,
  NEVADA_APPROVED_HOSTS,
  NEVADA_CONNECTOR_ID,
  NEVADA_SOURCE_URL,
  NEVADA_SOURCE_VALIDATION_TEST,
} from "~/lib/state-grants/connectors/nevada";
import {
  oklahomaConnector,
  OKLAHOMA_APPROVED_HOSTS,
  OKLAHOMA_CONNECTOR_ID,
  OKLAHOMA_SOURCE_URL,
  OKLAHOMA_SOURCE_VALIDATION_TEST,
} from "~/lib/state-grants/connectors/oklahoma";
import {
  southCarolinaConnector,
  SOUTH_CAROLINA_APPROVED_HOSTS,
  SOUTH_CAROLINA_CONNECTOR_ID,
  SOUTH_CAROLINA_SOURCE_URL,
  SOUTH_CAROLINA_SOURCE_VALIDATION_TEST,
} from "~/lib/state-grants/connectors/south-carolina";
import {
  illinoisConnector,
  ILLINOIS_APPROVED_HOSTS,
  ILLINOIS_CONNECTOR_ID,
  ILLINOIS_SOURCE_URL,
  ILLINOIS_SOURCE_VALIDATION_TEST,
} from "~/lib/state-grants/connectors/illinois";
// NEXT-12 TRANCHE (owner 2026-09-19, one continuous workstream): NH, MT.
import {
  NEW_HAMPSHIRE_APPROVED_HOSTS,
  NEW_HAMPSHIRE_CONNECTOR_ID,
  NEW_HAMPSHIRE_SOURCE_URL,
  NEW_HAMPSHIRE_SOURCE_VALIDATION_TEST,
  newHampshireConnector,
} from "~/lib/state-grants/connectors/new-hampshire";
import {
  MONTANA_APPROVED_HOSTS,
  MONTANA_CONNECTOR_ID,
  MONTANA_SOURCE_URL,
  MONTANA_SOURCE_VALIDATION_TEST,
  montanaConnector,
} from "~/lib/state-grants/connectors/montana";
import {
  INDIANA_APPROVED_HOSTS,
  INDIANA_CONNECTOR_ID,
  INDIANA_SOURCE_URL,
  INDIANA_SOURCE_VALIDATION_TEST,
  indianaConnector,
} from "~/lib/state-grants/connectors/indiana";
import {
  FLORIDA_APPROVED_HOSTS,
  FLORIDA_CONNECTOR_ID,
  FLORIDA_SOURCE_URL,
  FLORIDA_SOURCE_VALIDATION_TEST,
  floridaConnector,
} from "~/lib/state-grants/connectors/florida";
import {
  TEXAS_APPROVED_HOSTS,
  TEXAS_CONNECTOR_ID,
  TEXAS_SOURCE_URL,
  TEXAS_SOURCE_VALIDATION_TEST,
  texasConnector,
} from "~/lib/state-grants/connectors/texas";
import {
  MARYLAND_APPROVED_HOSTS,
  MARYLAND_CONNECTOR_ID,
  MARYLAND_SOURCE_URL,
  MARYLAND_SOURCE_VALIDATION_TEST,
  marylandConnector,
} from "~/lib/state-grants/connectors/maryland";

import {
  VERMONT_APPROVED_HOSTS,
  VERMONT_CONNECTOR_ID,
  VERMONT_SOURCE_URL,
  VERMONT_SOURCE_VALIDATION_TEST,
  vermontConnector,
} from "~/lib/state-grants/connectors/vermont";
import {
  NEBRASKA_APPROVED_HOSTS,
  NEBRASKA_CONNECTOR_ID,
  NEBRASKA_SOURCE_URL,
  NEBRASKA_SOURCE_VALIDATION_TEST,
  nebraskaConnector,
} from "~/lib/state-grants/connectors/nebraska";
import {
  IOWA_APPROVED_HOSTS,
  IOWA_CONNECTOR_ID,
  IOWA_SOURCE_URL,
  IOWA_SOURCE_VALIDATION_TEST,
  iowaConnector,
} from "~/lib/state-grants/connectors/iowa";
import {
  WYOMING_APPROVED_HOSTS,
  WYOMING_CONNECTOR_ID,
  WYOMING_SOURCE_URL,
  WYOMING_SOURCE_VALIDATION_TEST,
  wyomingConnector,
} from "~/lib/state-grants/connectors/wyoming";
import {
  NEW_JERSEY_APPROVED_HOSTS,
  NEW_JERSEY_CONNECTOR_ID,
  NEW_JERSEY_SOURCE_URL,
  NEW_JERSEY_SOURCE_VALIDATION_TEST,
  newJerseyConnector,
} from "~/lib/state-grants/connectors/new-jersey";
// CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-20): OH. The statewide portal
// is not readable over verified TLS (see OHIO_REGISTRY_ENTRY), so Ohio is served
// by the Ohio Arts Council catalogue and stays `limited`.
import {
  OHIO_APPROVED_HOSTS,
  OHIO_CONNECTOR_ID,
  OHIO_SOURCE_URL,
  OHIO_SOURCE_VALIDATION_TEST,
  ohioConnector,
} from "~/lib/state-grants/connectors/ohio";
// CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-20): NY. The owner's only
// public-session jurisdiction ("temporary public-session cookies only … fail
// closed", §9 of the escalation pass): the State's own Grant Opportunity Portal
// inside the SFS Vendor Portal, read through its PUBLIC guest page. ONE source,
// so NY stays `limited`, never advertised as statewide comprehensive coverage.
import {
  NEW_YORK_APPROVED_HOSTS,
  NEW_YORK_CONNECTOR_ID,
  NEW_YORK_SOURCE_URL,
  NEW_YORK_SOURCE_VALIDATION_TEST,
  newYorkConnector,
} from "~/lib/state-grants/connectors/new-york";
import { sourcesForState } from "~/lib/state-grants/sources";
import type { StateGrantConnector } from "~/lib/state-grants/connector";

/** All 50 states + the District of Columbia, USPS order (alphabetical). */
export const STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI",
  "WY",
] as const;

export type UsStateCode = (typeof STATE_CODES)[number];

/** Full names, used by the registry rows and the coverage UI. */
export const STATE_NAMES: Record<UsStateCode, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/**
 * The owner's coverage ladder (2026-09-19): connected | curated | limited |
 * unavailable. `unavailable` is the only one that is NOT a validated tier.
 */
export type StateGrantRegistryStatus = "connected" | "curated" | "limited" | "unavailable";

/** The tiers a state may only hold WITH a passing source-validation gate. */
export const VALIDATED_REGISTRY_STATUSES: readonly StateGrantRegistryStatus[] = [
  "limited",
  "curated",
  "connected",
] as const;

/** Human labels for the coverage UI. `limited` says exactly what it is not. */
export const REGISTRY_STATUS_LABELS: Record<StateGrantRegistryStatus, string> = {
  connected: "Connected — statewide, multi-source coverage",
  curated: "Curated — the state's own listings, curated by us",
  limited: "Limited — one or a few validated sources, not statewide",
  unavailable: "Not covered yet",
};

/** How many distinct sources `connected` requires (statewide comprehensive). */
export const CONNECTED_MIN_SOURCES = 2;

export function isValidatedStatus(status: StateGrantRegistryStatus): boolean {
  return status !== "unavailable";
}

/** True only for the tiers that require the source-validation gate. */
export function isValidatedTier(value: unknown): value is Exclude<StateGrantRegistryStatus, "unavailable"> {
  return (
    typeof value === "string" &&
    (VALIDATED_REGISTRY_STATUSES as readonly string[]).includes(value)
  );
}

/** A state's source-validation manifest entry — the gate for a validated tier. */
export interface SourceValidationEntry {
  connectorId: string;
  sourceUrl: string;
  /** Repo-relative path of the LIVE source-validation test that must pass. */
  testFile: string;
  /** When that test was last verified against the live source. */
  verifiedOn: string;
  /**
   * The coverage tier this source set justifies. Enforced structurally: see
   * CONNECTED_MIN_SOURCES and deriveStateRegistry().
   */
  tier: Exclude<StateGrantRegistryStatus, "unavailable">;
  /** Plain-language honesty note about what this coverage is NOT. */
  note: string | null;
}

export interface StateRegistryEntry {
  stateCode: UsStateCode;
  name: string;
  status: StateGrantRegistryStatus;
  connectorId: string | null;
  /** Why this status — validated entries carry the gate that passed. */
  reason: string;
  sourceUrl: string | null;
  sourceValidationTest: string | null;
  /** How many distinct sources are registered for this state. */
  sourceCount: number;
  /** The manifest's honesty note, when it carries one. */
  note: string | null;
}

/** Everything the derivation needs, injectable so fail-closed is testable. */
export interface RegistryInputs {
  connectors: Record<string, StateGrantConnector<never> | undefined>;
  validations: Record<string, SourceValidationEntry | undefined>;
  approvedHosts: readonly string[];
  states?: readonly string[];
  names?: Record<string, string>;
  /** state code → the source keys registered for it (identity + the ladder). */
  sourcesByState?: Record<string, readonly string[]>;
}

/**
 * Hosts a state connector's official source may live on. A connector whose
 * `officialHost` is not listed here can never be validated — so a typo'd or
 * replaced domain fails the gate instead of silently shipping.
 */
export const APPROVED_SOURCE_HOSTS: readonly string[] = [
  ...VIRGINIA_APPROVED_HOSTS,
  ...ARIZONA_APPROVED_HOSTS,
  ...DELAWARE_APPROVED_HOSTS,
  ...HAWAII_APPROVED_HOSTS,
  ...PENNSYLVANIA_APPROVED_HOSTS,
  ...RHODE_ISLAND_APPROVED_HOSTS,
  // NATIONWIDE batch 1 (owner 2026-09-19).
  ...CALIFORNIA_APPROVED_HOSTS,
  ...KANSAS_APPROVED_HOSTS,
  ...WASHINGTON_APPROVED_HOSTS,
  // NATIONWIDE batch 2 (owner 2026-09-19).
  ...ARKANSAS_APPROVED_HOSTS,
  ...COLORADO_APPROVED_HOSTS,
  ...MINNESOTA_APPROVED_HOSTS,
  ...NORTH_DAKOTA_APPROVED_HOSTS,
  ...NEW_MEXICO_APPROVED_HOSTS,
  // ESCALATION PASS (owner 2026-09-19).
  ...TENNESSEE_APPROVED_HOSTS,
  ...UTAH_APPROVED_HOSTS,
  // NATIONWIDE continuous tranche (owner 2026-09-19): DC, WV, KY, AL, ME.
  ...DISTRICT_OF_COLUMBIA_APPROVED_HOSTS,
  ...WEST_VIRGINIA_APPROVED_HOSTS,
  ...KENTUCKY_APPROVED_HOSTS,
  ...ALABAMA_APPROVED_HOSTS,
  ...MAINE_APPROVED_HOSTS,
  // CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-19): NV, OK, SC, IL.
  ...NEVADA_APPROVED_HOSTS,
  ...OKLAHOMA_APPROVED_HOSTS,
  ...SOUTH_CAROLINA_APPROVED_HOSTS,
  ...ILLINOIS_APPROVED_HOSTS,
  // NEXT-12 TRANCHE (owner 2026-09-19).
  ...NEW_HAMPSHIRE_APPROVED_HOSTS,
  ...MONTANA_APPROVED_HOSTS,
  ...INDIANA_APPROVED_HOSTS,
  ...FLORIDA_APPROVED_HOSTS,
  ...TEXAS_APPROVED_HOSTS,
  // NEXT-12 TRANCHE (owner 2026-09-19): MD, VT.
  ...MARYLAND_APPROVED_HOSTS,
  ...VERMONT_APPROVED_HOSTS,
  ...NEBRASKA_APPROVED_HOSTS,
  ...IOWA_APPROVED_HOSTS,
  // CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-20): WY.
  ...WYOMING_APPROVED_HOSTS,
  // CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-20): NJ.
  ...NEW_JERSEY_APPROVED_HOSTS,
  // CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-20): OH.
  ...OHIO_APPROVED_HOSTS,
  // CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-20): NY.
  ...NEW_YORK_APPROVED_HOSTS,
];

export const VIRGINIA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: VIRGINIA_CONNECTOR_ID,
  sourceUrl: VIRGINIA_SOURCE_URL,
  testFile: VIRGINIA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  // ONE tourism source. Virginia publishes many more programs through other
  // agencies we have not validated, so this is `limited`, never `connected`
  // (owner review 2026-09-19).
  tier: "limited",
  note: "One validated source (the Virginia Tourism Corporation grants page). The Commonwealth publishes many more programs through other agencies that we have NOT validated — this is not statewide coverage.",
};

/**
 * P3 BATCH #1 manifest entries (five states, 2026-09-19). Each is ONE agency's
 * official listing, so each declares `limited` — the ladder requires at least
 * `CONNECTED_MIN_SOURCES` (2) distinct sources before any state can be reported
 * as statewide multi-source coverage. Every `verifiedOn` date is the day the
 * state's own `<state>.source-validation.test.ts` PASSED against the live
 * source; a state whose live validation failed has NO entry here and stays
 * `unavailable`.
 */
export const ARIZONA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: ARIZONA_CONNECTOR_ID,
  sourceUrl: ARIZONA_SOURCE_URL,
  testFile: ARIZONA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (the Arizona Commission on the Arts grants page). Other Arizona agencies publish funding programs we have NOT validated — this is not statewide coverage.",
};

export const DELAWARE_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: DELAWARE_CONNECTOR_ID,
  sourceUrl: DELAWARE_SOURCE_URL,
  testFile: DELAWARE_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (the Delaware Division of the Arts Grant Programs Overview). Other Delaware agencies publish funding programs we have NOT validated — this is not statewide coverage.",
};

export const HAWAII_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: HAWAII_CONNECTOR_ID,
  sourceUrl: HAWAII_SOURCE_URL,
  testFile: HAWAII_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (the State Foundation on Culture and the Arts' current and upcoming grants table — not its separate list of past award recipients). This is not statewide coverage.",
};

export const PENNSYLVANIA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: PENNSYLVANIA_CONNECTOR_ID,
  sourceUrl: PENNSYLVANIA_SOURCE_URL,
  testFile: PENNSYLVANIA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (Pennsylvania Creative Industries' Due Dates for Grants page), which publishes application due dates only. Program detail lives elsewhere and some cycles are multi-deadline, so those records are honestly `unverified`. This is not statewide coverage.",
};

export const RHODE_ISLAND_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: RHODE_ISLAND_CONNECTOR_ID,
  sourceUrl: RHODE_ISLAND_SOURCE_URL,
  testFile: RHODE_ISLAND_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (the Rhode Island State Council on the Arts' Our Grants page). RISCA publishes its in-card dates without a year, so most of its programs are honestly `unverified` until the source publishes dated cycles. This is not statewide coverage.",
};

/**
 * NATIONWIDE BATCH 1 manifest entries (owner order 2026-09-19: evaluate every
 * remaining jurisdiction; one workstream, batches of five, one accumulating PR).
 * Batch 1 evaluated CA, KS, NC, UT and WA: NC and Utah exited under the
 * checklist §0 exit rule (no dependable official dated listing — they stay
 * `unavailable`, with the exact reasons in the batch report), so THREE connectors
 * landed. Each is ONE agency's/portal's official listing, so each declares
 * `limited` — the ladder requires at least `CONNECTED_MIN_SOURCES` (2) distinct
 * sources before any state can be reported as statewide multi-source coverage.
 * Every `verifiedOn` date is the day the state's own
 * `<state>.source-validation.test.ts` PASSED against the live source.
 */
export const CALIFORNIA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: CALIFORNIA_CONNECTOR_ID,
  sourceUrl: CALIFORNIA_SOURCE_URL,
  testFile: CALIFORNIA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (the California Grants Portal's own Active-results view, page 1). The portal also lists upcoming, Closed and Post-Award grants we do not serve, and we read only the first page of the Active facet — this is not statewide coverage.",
};

export const KANSAS_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: KANSAS_CONNECTOR_ID,
  sourceUrl: KANSAS_SOURCE_URL,
  testFile: KANSAS_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (the Kansas Department of Commerce's grants calendar). The calendar publishes its Application Period as year-less month ranges, so most programs are honestly `unverified` until the source publishes dated cycles, and no program has its own page — this is not statewide coverage.",
};

export const WASHINGTON_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: WASHINGTON_CONNECTOR_ID,
  sourceUrl: WASHINGTON_SOURCE_URL,
  testFile: WASHINGTON_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (ArtsWA's Open and Upcoming Grants listing). Other Washington agencies publish funding programs we have NOT validated — this is not statewide coverage.",
};

/**
 * NATIONWIDE BATCH 2 manifest entries (owner order 2026-09-19: evaluate every
 * remaining jurisdiction; one workstream, batches of five, one accumulating PR).
 * Batch 2 evaluated AR, CO, MN, ND and NM and landed a connector for each — every
 * one of these sources is ONE agency's official listing, so each declares
 * `limited`: the ladder requires at least `CONNECTED_MIN_SOURCES` (2) distinct
 * sources before any state may be reported as statewide multi-source coverage.
 * Every `verifiedOn` date is the day the state's own
 * `<state>.source-validation.test.ts` PASSED against the live source.
 */
export const ARKANSAS_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: ARKANSAS_CONNECTOR_ID,
  sourceUrl: ARKANSAS_SOURCE_URL,
  testFile: ARKANSAS_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (the Arkansas Arts Council's Art Grants listing, on the agency's own arkansasheritage.com domain). The listing publishes no per-program deadline — its dated \"When To Apply\" list does not map onto the individual grant cards — so every record is honestly `unverified` rather than dated by inference. Other Arkansas agencies publish funding programs we have NOT validated: this is not statewide coverage.",
};

export const COLORADO_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: COLORADO_CONNECTOR_ID,
  sourceUrl: COLORADO_SOURCE_URL,
  testFile: COLORADO_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (OEDIT's Advanced Industries Accelerator Programs listing). OEDIT's own Programs-and-Funding index publishes no per-program dates, so this is ONE program family of ONE division — Colorado publishes funding through many other agencies we have NOT validated: this is not statewide coverage.",
};

export const MINNESOTA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: MINNESOTA_CONNECTOR_ID,
  sourceUrl: MINNESOTA_SOURCE_URL,
  testFile: MINNESOTA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (the Minnesota State Arts Board's own Arts Board Calendar, current fiscal-year table, Application Deadline column only). This is one agency's calendar — other Minnesota agencies publish funding programs we have NOT validated: this is not statewide coverage.",
};

export const NORTH_DAKOTA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: NORTH_DAKOTA_CONNECTOR_ID,
  sourceUrl: NORTH_DAKOTA_SOURCE_URL,
  testFile: NORTH_DAKOTA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (the North Dakota Council on the Arts' \"Grants at a Glance\" listing). Cards that state their deadline as a RULE (\"6 weeks prior to project start date\") and the two-round card are honestly `unverified`, never guessed. Other North Dakota agencies publish funding programs we have NOT validated: this is not statewide coverage.",
};

export const NEW_MEXICO_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: NEW_MEXICO_CONNECTOR_ID,
  sourceUrl: NEW_MEXICO_SOURCE_URL,
  testFile: NEW_MEXICO_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (New Mexico Arts' \"Apply for a Grant\" page, from which only the labelled application-deadline milestones are read). New Mexico Arts' grants-information index publishes no year-bearing date at all, and other New Mexico agencies publish funding programs we have NOT validated: this is not statewide coverage.",
};

/**
 * ESCALATION PASS manifest entries (owner escalation order 2026-09-19,
 * checklist §0.5). Both states were UNCERTAIN in phase 1 (Tennessee could not be
 * reached at all; Utah had exited nationwide batch #1 under the §0 exit rule).
 * Each is ONE agency's own listing, so each declares `limited`: the ladder
 * requires at least `CONNECTED_MIN_SOURCES` (2) distinct sources before any state
 * may be reported as statewide multi-source coverage.
 */
export const TENNESSEE_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: TENNESSEE_CONNECTOR_ID,
  sourceUrl: TENNESSEE_SOURCE_URL,
  testFile: TENNESSEE_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (the Tennessee Arts Commission's own Apply for a Grant page, which publishes the current FY28 grant cycle as a dated Important Dates list). The list is a milestone calendar, not a program directory: the two lines that publish no day are not dates at all, and the cycle's own October 9, 2026 opening line is the source's separate bullet — the program deadlines carry the published close date and that opening day, so a cycle that has not opened yet is honestly `upcoming`, never `open`. Tennessee publishes funding through other departments we have NOT validated: this is not statewide coverage.",
};

export const UTAH_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: UTAH_CONNECTOR_ID,
  sourceUrl: UTAH_SOURCE_URL,
  testFile: UTAH_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (the Utah Division of Arts & Museums' Project Grants page, which publishes a per-program Grant Opens / Grant Closes schedule). Every published cycle on 2026-09-19 has closed, so those records are honestly `closed` and are never shown as open because the page is still live; the dated Info Session webinars on the same panels are events and are never treated as deadlines. This is one division's Project Grants, not Utah's General Operating Support grants or any other agency: this is not statewide coverage.",
};

/**
 * NATIONWIDE continuous-tranche manifest entries (owner correction 2026-09-19,
 * ratified 243: one continuous nationwide workstream, no separate batches).
 * Each state is ONE agency's own listing, so each declares `limited` — the ladder
 * requires at least `CONNECTED_MIN_SOURCES` (2) distinct sources before any state
 * may be reported as statewide multi-source coverage. Every `verifiedOn` date is
 * the day the state's own `<state>.source-validation.test.ts` PASSED against the
 * live official source.
 */
export const DISTRICT_OF_COLUMBIA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: DISTRICT_OF_COLUMBIA_CONNECTOR_ID,
  sourceUrl: DISTRICT_OF_COLUMBIA_SOURCE_URL,
  testFile: DISTRICT_OF_COLUMBIA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (the DC Office of the Deputy Mayor for Planning and Economic Development's Grant Opportunities listing). The page tags each card OPEN or CLOSED in its own words: the CLOSED cards are served `closed`, and the one card tagged OPEN that publishes no closing date at all is honestly `unverified` rather than assumed open. A card whose own published closing date has passed is served `closed` even when the page still tags it OPEN — a stale page never makes a deadline look open. The District runs funding through other agencies and councils we have NOT validated (`dslbd.dc.gov` answers 403 from this egress): this is not statewide coverage.",
};

export const WEST_VIRGINIA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: WEST_VIRGINIA_CONNECTOR_ID,
  sourceUrl: WEST_VIRGINIA_SOURCE_URL,
  testFile: WEST_VIRGINIA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (the West Virginia Division of Culture and History, Arts Section's own grants page). Its two labelled sections are read exactly as published: the programs under \"Currently Open for Application:\" are served with their own published deadline (or `rolling` where the source's own value says Rolling), and the two programs under \"Not Currently Open for Application:\" are served as the source's own closed state rather than being invented a date. The page's final-report due date is a reporting date for awards already made and is never treated as an application deadline. West Virginia publishes funding through other departments we have NOT validated: this is not statewide coverage.",
};

export const KENTUCKY_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: KENTUCKY_CONNECTOR_ID,
  sourceUrl: KENTUCKY_SOURCE_URL,
  testFile: KENTUCKY_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (the Kentucky Arts Council's own program listing). The listing's WordPress title reads \"Grants Archives\", which was checked against the current-vs-past rule BEFORE any record was published: it is the `program-type` taxonomy listing, its deadlines run both before and after today, and each program's own page publishes the same live deadline — so its past deadlines are served `closed` and its future ones `open`, and nothing is served open merely because the page is live. Kentucky publishes funding through other departments we have NOT validated: this is not statewide coverage.",
};

export const ALABAMA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: ALABAMA_CONNECTOR_ID,
  sourceUrl: ALABAMA_SOURCE_URL,
  testFile: ALABAMA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (ADECA's own Funding Opportunities page, at its FINAL URL — the short `/funding-opportunities/` address redirects here and the redirect target's host is the only one allowlisted). ADECA's intro says the page lists currently open opportunities only, but its own published dates are what decide: two programs whose September 18, 2026 deadline had passed are served `closed`, and the two still ahead are `open`. The dated application workshop on the VW Settlement card is an event and is never a deadline. Alabama publishes funding through other departments we have NOT validated: this is not statewide coverage.",
};

export const MAINE_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: MAINE_CONNECTOR_ID,
  sourceUrl: MAINE_SOURCE_URL,
  testFile: MAINE_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source (the Maine Arts Commission's own Grants Home page, read at its deep URL). Both shapes the page publishes are read: the current/upcoming opportunity cards (with their own \"Applications Open:\" and \"Application Deadline:\" labels) and the funding directory's per-program \"Current Status:\". Programs the agency files as Closed — including ones it last awarded in FY2027 — are served `closed` and are never presented as open; a program whose status is neither open nor closed and which publishes no date stays `unverified`. A program the page publishes in both shapes is ONE record, identified by the agency's own page path for it. Maine publishes funding through other departments we have NOT validated: this is not statewide coverage.",
};

/** The sources registered for every state, keyed by state code. */
function sourcesByStateMap(): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  for (const stateCode of STATE_CODES) {
    const keys = sourcesForState(stateCode).map((s) => s.sourceKey);
    if (keys.length > 0) out[stateCode] = keys;
  }
  return out;
}

/** The default inputs: every validated source, all other states `unavailable`. */
// ---------------------------------------------------------------------------
// CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-19, ratified 243): the NV, OK,
// SC and IL registry entries. Each one names its OWN source, its own hosts and
// its own live realities — the manifest gate in the shared live harness compares
// the DERIVED registry row against these declarations, so a silent `sources.ts`
// omission or an inflated tier fails that state's own gate.
// ---------------------------------------------------------------------------
export const NEVADA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: NEVADA_CONNECTOR_ID,
  sourceUrl: NEVADA_SOURCE_URL,
  testFile: NEVADA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source: the Nevada Arts Council's own FY27 Grant Offerings page on the Council's own domain (nvartscouncil.org / www.nvartscouncil.org). The phase-1 map named the Council's /grants/ page; live re-verification on 2026-09-19 showed that page is the Council's FAQ (it publishes exactly one date in its body and points readers to the Grant Offerings page for deadlines), so the connector reads the dated listing the Council itself points at. Only the Council's own labelled \"Application deadline:\" value is read: the \"Grant Activity Period\" on every card is the funded ACTIVITY period and is never a deadline, and deadlines published as RULES (\"At least 30 days before the proposed project (while funds remain available)\") are served `unverified` rather than inferred. A published deadline that has passed is `closed` even under the Council's own \"Open and Upcoming Grants:\" heading, and the programs under its \"Closed Grants:\" heading are served as the source's own closed state. The Council's past-grantee/award pages are award records and are never served as opportunities. Nevada publishes funding through other departments we have NOT validated: this is ONE agency, so `limited`, never `connected` — not statewide coverage.",
};
export const OKLAHOMA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: OKLAHOMA_CONNECTOR_ID,
  sourceUrl: OKLAHOMA_SOURCE_URL,
  testFile: OKLAHOMA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source read across the Oklahoma Arts Council's TWO program indexes on the State of Oklahoma's canonical oklahoma.gov host (grants-for-organizations.html and grants-for-schools.html): the Council's /arts/grants.html hub publishes no per-program date at all, so both indexes are fetched fail-closed every run as ONE source. Only the Council's own labelled \"Application Deadlines\" value is read: \"Project Activity Dates\" is the funded ACTIVITY period and is never a deadline, the Council's own \"(Closed)\" marker is served as its closed state (with the date it published alongside it), and deadlines published as RULES (\"60 days before your project begins\", \"30 days before the scheduled field trip date\") are served `unverified` rather than inferred. The legacy arts.ok.gov host is never used. Oklahoma publishes funding through other departments we have NOT validated: this is ONE agency, so `limited`, never `connected` — not statewide coverage.",
};
export const SOUTH_CAROLINA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: SOUTH_CAROLINA_CONNECTOR_ID,
  sourceUrl: SOUTH_CAROLINA_SOURCE_URL,
  testFile: SOUTH_CAROLINA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source: the South Carolina Arts Commission's own All Grants listing on the Commission's own domain (southcarolinaarts.com / www.southcarolinaarts.com; the /grants/ path 301s elsewhere, so the FINAL /all-grants/ URL is hard-coded). This listing is MIXED — 14 of its 19 cards carry the Commission's own `Closed` badge and 5 are Open/Closing Soon — so the cards the Commission badges Closed are served closed with the source's own published window, and an Open/Closing-Soon badge is never promoted into a date: status comes only from the Commission's own Application Period, read as an ordered range. The \"Apply at least five (5) weeks before grant-funded activities begin\" rule and the Letter-of-Intent notes are never deadlines. The Commission publishes no summary/eligibility text in machine-labelable form, so those fields stay unstated, and no third-party host (e.g. its scheduling link) is ever served as a record's page. South Carolina publishes funding through other departments we have NOT validated: this is ONE agency, so `limited`, never `connected` — not statewide coverage.",
};
export const ILLINOIS_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: ILLINOIS_CONNECTOR_ID,
  sourceUrl: ILLINOIS_SOURCE_URL,
  testFile: ILLINOIS_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source: the Illinois CSFA current funding-opportunity list, located live on 2026-09-19 after the phase-1 map recorded that the dated NOFO path was NOT found (the guessed /csfa/ and /nofo.html both 404 and the gata.illinois.gov root is informational). The real path was found by following the State's own link graph — gata.illinois.gov root → its own CSFA page /grants/csfa.html → the public CSFA application it embeds at omb.illinois.gov/public/gata/csfa/ → its own link to OpportunityList.aspx — and the list is the statewide catalog the Grants Accountability and Transparency Act (30 ILCS 708) requires. The whole unpaginated list is read (the page states its own total, which the tests cross-check): the Application Date Range column is read as its two ordered ends, the State's own \"No end date\" is the ONLY input to `rolling` (never an invented deadline), a passed published end date is `closed`, and \"Not Applicable\" award ranges are stored as no amount rather than as a number. Only the current-opportunity VIEW of the catalog is read, and other agencies' own listings were NOT validated, so `limited`, never `curated`/`connected` — not statewide coverage.",
};
export const NEW_HAMPSHIRE_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: NEW_HAMPSHIRE_CONNECTOR_ID,
  sourceUrl: NEW_HAMPSHIRE_SOURCE_URL,
  testFile: NEW_HAMPSHIRE_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source: the New Hampshire Joint Promotional Program (JPP) deadlines page, published by the Division of Travel and Tourism Development on visitnh.gov (inside the Department of Business and Economic Affairs, DRED). PROVENANCE: the phase-1 map's PRIMARY candidate for New Hampshire was a DIFFERENT agency (nheconomy.com/about-us/grant-programs), which publishes ten grant links and ZERO dates live; the dated listing is this one programme of this one division. Only the Division's own labelled \"Application Due Date\" value is read — its \"Applicants Notified\" value is a notification date and is never a deadline — and the four published rounds are four separate records, each with its own date. A round whose published deadline has passed is `closed` even though the page is live. New Hampshire publishes funding through other departments and agencies we have NOT validated, so this is ONE programme of ONE division: `limited`, never `curated`/`connected` — this is not statewide coverage.",
};
export const MONTANA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: MONTANA_CONNECTOR_ID,
  sourceUrl: MONTANA_SOURCE_URL,
  testFile: MONTANA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source: the Montana Department of Commerce's own Montana Tourism Development Grant Program page on commerce.mt.gov. The dated sentence is NOT on the parent Tourism Grant Program catalogue (322 KB live, 45 grant mentions, zero dates — parsing it could only ever produce undated records); the connector reads the CHILD programme page the Department publishes, whose \"Resources for Applicants\" list carries its own ordered \"will open Jan. 6, 2027 and close on Feb. 3, 2027\" cycle sentence. Both ends are read in source order and never picked apart; a year-less or unreadable end yields no date rather than an invented one, and a passed cycle is `closed`. The Montana Arts Council's art.mt.gov pages are stale (2022) or award lists and represent no coverage. This is ONE programme family of ONE department: `limited`, never `connected` — this is not statewide coverage.",
};
export const INDIANA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: INDIANA_CONNECTOR_ID,
  sourceUrl: INDIANA_SOURCE_URL,
  testFile: INDIANA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source: the Indiana Arts Commission's own funding programme pages on in.gov, reached from the Commission's funding hub. The hub itself is a PROGRAM CATALOGUE (63 KB live, thirteen grant mentions, ZERO dates), so the connector fetches the hub plus the funding programme pages the HUB publishes (Arts Project Support, Arts Organization Support, America250 Grant Program, Every County Funded) and reads every cycle from its OWN page's “Application Timeline” table. Only the row the Commission labels \"Application Due\" is a deadline: the \"Draft Application Review Deadline for New Applicants\", \"Funding Notification\", \"Final Grant Report Due\", webinar and panel rows are process dates and the \"Grant Period\" is an activity period — none of them is ever a deadline. A struck-through (<del>) value is the Commission's own superseded value, so the replacement in the same cell is read and the struck-through day is not. Previous fiscal-year cycles stay visible as published records and are `closed` (never hidden, never open on a live page). The Every County Funded page publishes programme copy and an awardee list with no timeline, so it contributes no record. This is ONE agency's funding programmes: other Indiana agencies award grants we have NOT validated, so the state is `limited`, never `curated`/`connected` — this is not statewide coverage.",
};
export const FLORIDA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: FLORIDA_CONNECTOR_ID,
  sourceUrl: FLORIDA_SOURCE_URL,
  testFile: FLORIDA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source: the Florida Department of State's Division of Arts and Culture grants index on dos.fl.gov plus the grant PROGRAMME pages that index publishes. The index is a PROGRAM CATALOGUE (27.9 KB live, twenty-seven grant mentions, ZERO dates), so the connector fetches the index plus each programme page the index itself links and reads each programme's OWN application statement. The Division's own past-tense label (\"Applications for Fiscal Year 2027-2028 are CLOSED\", and the prose \"The application cycle for this program has CLOSED.\" on the America 250 page) makes those programmes `closed` on a live page. The Division's \"Next Deadline: TBD\" is a deadline label with NO date, so the record keeps no close date at all (and is never an estimate), and that single value is never spread across the catalogue. The 2028/2029 dates the pages publish are the GRANT PERIOD for the NEXT application cycle \u2014 an activity period, labelled as such \u2014 and are never read as a posted or close date; the funding-process page's one general `deadline` token sits OUTSIDE the child scope for exactly that reason. The Cultural Endowment page is programme history with no application statement, so it contributes no record rather than an undated one. This is ONE division of ONE department: other Florida agencies award grants we have NOT validated, so the state is `limited`, never `curated`/`connected` \u2014 this is not statewide coverage.",
};
export const TEXAS_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: TEXAS_CONNECTOR_ID,
  sourceUrl: TEXAS_SOURCE_URL,
  testFile: TEXAS_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source: the Texas Military Preparedness Commission's own DEAAG grant program page on gov.texas.gov (Office of the Governor). The build spec's first candidate, the Governor's financial-services grants catalogue, was re-verified live 2026-09-19 (105,109 bytes, ZERO dates) \u2014 as were /organization/hsgd (97,673 B) and /organization/cjd/resources (96,669 B) \u2014 so those pages are a PROGRAM CATALOGUE with no dated listing and could only ever produce undated records. The dated page is the DEAAG page, whose own paragraph says \"The FY 27 Round of DEAAG will open on September 1, 2026. DEAAG applications will be due on or before 5 PM Friday, November 06, 2026.\" Both ends are read from that one paragraph in source order and never picked apart; a year-less or unreadable end yields no date rather than an invented one, and a passed round classifies `closed`, never open. The award timing in the same paragraph (\"Grants will be awarded at the beginning of 2027\") is kept for review and is NEVER a posted, close or estimated date. This is ONE programme family of ONE office: the Governor's office publishes other grant catalogues with no per-programme dates, so the state is `limited`, never `curated`/`connected` \u2014 this is not statewide coverage.",
};
export const MARYLAND_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: MARYLAND_CONNECTOR_ID,
  sourceUrl: MARYLAND_SOURCE_URL,
  testFile: MARYLAND_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source: the Maryland State Arts Council's own Grants for Organizations (GFO) programme page on msac.org (an agency domain rather than a .gov one) PLUS the GFO programme pages that page itself publishes. The GFO index is a PROGRAM CATALOGUE — its only date token is September 9, 2021, the day the Council adopted its funding formula (governance history, never a cycle) — so the connector fetches the index plus every GFO programme page it publishes and reads each record from its OWN page. Only the ONE date the Council itself LABELS is read: the `Deadline` value in a programme page's own Quick Resources box. A labelled deadline with no readable day keeps the record with NO close date rather than a guess. The Council's year-less prose deadlines (\"by September 15th annually\", \"by November 15\"), the eligibility page's process and reporting notes, and the index's 2021 formula date are never deadlines. The deadline the Council publishes today (09/15/2026) has passed, so it is served `closed` on a live page. The Council's other programme families (Arts Capital, Arts in Education, Maryland Traditions, Poetry Out Loud and the rest) are deliberately out of scope — Poetry Out Loud publishes a schools COMPETITION deadline, which is not a grant deadline. Maryland awards grants through other agencies we have NOT validated, so this is ONE programme of ONE agency: `limited`, never `curated`/`connected` — this is not statewide coverage.",
};

export const VERMONT_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: VERMONT_CONNECTOR_ID,
  sourceUrl: VERMONT_SOURCE_URL,
  testFile: VERMONT_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source: the Vermont Agency of Commerce and Community Development's own Funding and Incentives listing (accd.vermont.gov) PLUS the programme pages that listing publishes. The listing is a PROGRAM CATALOGUE with no application dates of its own, so the connector fetches it and reads each record from the programme's OWN page(s) \u2014 never from the listing and never from a sibling programme. The agency labels only two statuses in its own words: VCDP (\"VCDP accepts applications on a rolling basis\") and CHIP (\"Applications will be accepted on a rolling basis until December 31, 2035\") are `rolling` with NO close date, and the Downtown Transportation Fund page states \"The application period for the 2026 Downtown Transportation Fund grant is now closed\" so it is `closed`. The only dated records are the rows of the VCDP Community Development Board submission schedule, read from the column the agency itself labels \"Submission Date for Application\" on the row that published it (a future submission date is open, a passed one closed). Everything else this source dates is REFUSED and recorded verbatim in each record's `raw.refusedDates`: TIF's example timeline (\"Deadline to incur all TIF debt\") is a municipal debt-incurrence obligation, VEGI's \"July 1, 2025 to June 30, 2026\" is an incentive/labour-market-enhancement PERIOD, and VCDP's \"Seeking Comments for FY25 DRAFT CAPER by September 28, 2026\" is a document-review deadline on a draft federal report. Vermont's own /grants page is a 2020 pandemic-recovery archive and is never read. This is six pages across five programme families of ONE agency out of a much larger catalogue: `limited`, never `curated`/`connected` \u2014 this is not statewide coverage.",
};

export const NEBRASKA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: NEBRASKA_CONNECTOR_ID,
  sourceUrl: NEBRASKA_SOURCE_URL,
  testFile: NEBRASKA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source: the Nebraska Department of Economic Development's own Programs index on opportunity.nebraska.gov plus 46 of the 63 programme pages that index links \u2014 the ones whose own page publishes a labelled application-window block (verified live 2026-09-19). The index itself publishes ZERO date tokens (its news and \u201cstay up to date\u201d furniture is never read), so every record is read from ONE programme page's own Divi promo module: the module's own heading is the title, and its own labels (Open Date/Close Date, Submission Open|Close Date, Pre-/Full Application Opens|Closes, Application Deadline, a date-to-date range under \u201cApplication Period\u201d, or the source's own \u201cOpen Cycle\u201d wording) decide the window. Anticipated award dates, letters of intent, periods of performance and press-release dates are never read; a year-less deadline (\u201cApplication Deadline: Sept. 15\u201d) is kept verbatim with NO close date, and a block publishing two successive periods at once is refused rather than picked. Past cycles the DED leaves on live pages are served `closed`, never hidden and never open. Two of the index's 63 links 404, which is why the child list is PINNED rather than link-derived. This is ONE agency's programme pages: other Nebraska agencies and local bodies award grants we have NOT validated, so the state is `limited`, never `curated`/`connected` \u2014 this is not statewide coverage.",
};
export const IOWA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: IOWA_CONNECTOR_ID,
  sourceUrl: IOWA_SOURCE_URL,
  testFile: IOWA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
  tier: "limited",
  note: "One validated source: the Iowa Economic Development Authority / Iowa Arts Council's own Grants & Programs catalogue on opportunityiowa.gov (the FINAL URL the off-host iowaculture.gov/grants 301 lands on) plus 18 of the 19 programme pages that catalogue publishes. The catalogue is a JS-rendered program catalogue with NO date token of its own, so every record is read from ONE programme page's OWN body region. Only labels the agency itself publishes are read: a `Deadline:` block per applicant role (the Iowans Create Community Mural Program publishes one for Communities and one for Artists), a `<date> | <label>` line in a Timeline list, the agency's sentence \"The deadline for submitting an online application is 11:59PM on <date>\", a published acceptance window (\"accepted from February 2, 2026, through March 16, 2026\") and its own rolling declaration (\"accepted on a rolling basis until April 15, 2027\") \u2014 which is served `rolling` with NO close date. Everything else this source dates is REFUSED and recorded verbatim in each record's `raw.refusedDates`: the Final Report Deadline, Finalist Applicant Interviews and Award Notification milestones in the Scholarship Timeline, the Film Rebate page's fund-availability and expense-window days, and the eligible funding periods. Twelve programmes whose pages state in the agency's own words that they are \"not currently accepting applications\" (or \"will not be accepting applications\") are served `closed` with no date; three pages that publish no window of their own are `unverified` rather than guessed. Two catalogue tiles are deliberately NOT read: a program-guidelines page that restates its parent's window (reading both would double-count one application) and a grantee support FAQ. This is ONE agency's arts-and-culture catalogue: Iowa awards grants through other departments and local bodies we have NOT validated, so the state is `limited`, never `curated`/`connected` \u2014 this is not statewide coverage.",
};
export const WYOMING_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: WYOMING_CONNECTOR_ID,
  sourceUrl: WYOMING_SOURCE_URL,
  testFile: WYOMING_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-20",
  tier: "limited",
  note: "One validated source: the Wyoming Business Council's own grants catalogue on wyomingbusiness.org plus the 10 programme pages that catalogue publishes. The catalogue is real and current, but it publishes almost no year-bearing application deadline: so every record is read from ONE programme page's own body region and only the agency's OWN status sentences are read \u2014 Kickstart's \u201ccurrently paused until further notice\u201d makes it `closed` and SBIR's \u201copen year-round\u201d / \u201crolling basis\u201d makes it `rolling`, in both cases with NO date. Every other date-like token (the STEP grant \u201cperiod\u201d of July 1, 2026 to September 29, 2027, the year-less \u201cMarch 1 and September 1\u201d rule, the Building Resilient Communities table's year-less cells, a 2019-2020 application schedule and a relative \u201c(Day 90)\u201d timeline) is REFUSED verbatim into each record's `raw.refusedDates` and is never a posted, close or estimated date \u2014 so the remaining pages are honestly `unverified` rather than dated by inference. Other Wyoming departments, boards and local bodies award grants we have NOT validated: this is ONE agency, so `limited`, never `curated`/`connected` \u2014 this is not statewide coverage.",
};

/**
 * NEW JERSEY — one validated source, so `limited`, never statewide.
 *
 * The recon handoff's first candidate (NJ Dept of Community Affairs
 * `nj.gov/dca/home/grants.shtml` + its dhcr/grants child) publishes no grant
 * record of its own: both re-fetched live 2026-09-20 (40,148 B / 41,756 B) and
 * they only POINT at the DCA's SAGE system on `dcasage.intelligrants.com` — a
 * THIRD-PARTY, vendor-hosted system, never a state connector's source. The
 * state's own directory (`grants.nj.gov` → NJ Treasury Grants Management Office)
 * links each department's grants page, and the NJDA page is the one that
 * publishes a current, dated notice-of-funding-availability list on the
 * department's own host (required of NJDA by N.J.S.A. 52:14-34.5, in the page's
 * own words).
 *
 * HONESTY: `closed` comes only from the source's own past-tense statement (so a
 * closed round that also mentions a "rolling basis" stays closed); `rolling`
 * only from the source's own open-ended declaration ("There is no deadline to
 * apply", "may apply at any time … reviewed on a rolling basis"); a close date
 * only from the source's own label inside that programme's own section ("no
 * later than October 16, 2026"); every other date the page publishes — the
 * year-less email cut-offs, the funding-availability days, the month-and-year
 * periods — is REFUSED verbatim into `raw.refusedDates`. A programme the page
 * lists as open with no deadline (the Animal Waste Management Plan grant) is
 * served `unverified` with no close date rather than dated by inference, and the
 * page's own "Other Funding Opportunities" bucket — which the page says is "not
 * offered by the NJDA directly" — is excluded by construction and named in
 * `raw.thirdPartyProgramsExcluded`. This is ONE department (NJDA, with the SADC
 * programmes it publishes on the same page); other New Jersey departments award
 * grants we have NOT validated, so `limited`, never `curated`/`connected` — this
 * is not statewide coverage.
 */
export const NEW_JERSEY_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: NEW_JERSEY_CONNECTOR_ID,
  sourceUrl: NEW_JERSEY_SOURCE_URL,
  testFile: NEW_JERSEY_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-20",
  tier: "limited",
  note: "One validated source: the New Jersey Department of Agriculture's own grant opportunities page on nj.gov (agriculture/financial-services/grants), the publication of NJDA notice of funding availability required by N.J.S.A. 52:14-34.5. The page groups its programmes under its OWN bucket headings \u2014 Open Opportunities, Closed Opportunities and SADC Grant Opportunities \u2014 and each programme section carries its own labelled fields (Purpose, Eligible Applicants, Funding Available, How to Apply, Program Webpage, Contact). Every record is read from ONE programme's own section: `closed` only from the source's own past-tense statement, `rolling` only from its own open-ended declaration, and a close date only from its own deadline label (\"no later than October 16, 2026\" on the USDA-AMS Specialty Crop Multi-State round). Every other date the page publishes is REFUSED verbatim into `raw.refusedDates` and is never a posted, close or estimated date: the year-less email cut-offs (\"on or before July 31st, 12:00pm EDT\", \"after January 30th, 5 PM EST\", the SCBGP \"May 14th\"), the funding-availability days (\"available \u2026 after April 1, 2025\") and the month-and-year period (AFT: \"available until June 2027\"). The Animal Waste Management Plan grant, which the page lists under Open Opportunities, publishes NO deadline at all, so it is served `unverified` with no close date rather than dated by inference. The page's \"Other Funding Opportunities\" bucket \u2014 which the page itself says is \"not offered by the NJDA directly\" (American Farmland Trust, Fulfill, the Community FoodBank of NJ, the NJ Junior Breeder Loan Fund) \u2014 is excluded by construction and named in `raw.thirdPartyProgramsExcluded`. The DCA candidate from the recon handoff was rejected on evidence: it publishes no record of its own and points at a third-party vendor system (SAGE). NJDA is ONE department of a state whose other departments award grants we have NOT validated, so this is `limited`, never `curated`/`connected` \u2014 this is not statewide coverage.",
};
/**
 * OHIO — the Ohio Arts Council's grant-programme catalogue on the Council's own
 * `oac.ohio.gov` host (the catalogue plus its 14 pinned programme pages), accepted
 * as Ohio's connector by the lead on 2026-09-20 after the statewide portal was
 * found unreadable (see the note).
 *
 * WHY THIS IS `limited` AND NOT STATEWIDE. Ohio's statewide funding-opportunities
 * listing IS published as JSON by the official OBM API host
 * `api.obm.ohio.gov/grants/getfundingopportunities/0/0/1` — but that host serves
 * an INCOMPLETE TLS chain (its leaf certificate only), so verification fails with
 * "unable to get local issuer certificate" in curl, bun and node; only a fetch
 * with verification OFF reads it, and this workstream does not do that. So Ohio is
 * served by ONE agency's catalogue, never advertised as statewide coverage.
 *
 * HONESTY: EXACTLY ONE row type is ever read — the source's own
 * `Application Deadline …` row whose value is a full published day — and the
 * LATEST such row on a page is that programme's close date (never rolled forward,
 * never interpolated). The read is done on the STRIPPED text of each labelled row
 * (several pages wrap the label in markup a raw-HTML read misses) and is NOT
 * scoped by an `<h2>TIMELINE</h2>` heading (only one of the 14 pages has one).
 * Every other date the pages publish — agreement/report/off-year deadlines, the
 * ARTIE availability windows, award-announcement months, ADAP's ADA enactment
 * date in the prose, the site's own news dates, and every month-and-year period —
 * is REFUSED verbatim into `raw.refusedDates` with a reason. A programme whose
 * only application-deadline row is RELATIVE stays `unverified` with no date, and
 * no posting date or estimate is ever produced.
 */
export const OHIO_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: OHIO_CONNECTOR_ID,
  sourceUrl: OHIO_SOURCE_URL,
  testFile: OHIO_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-20",
  tier: "limited",
  note: "One validated source: the Ohio Arts Council's own grant-program catalogue on oac.ohio.gov (grants/10-grant-opportunities) together with the 14 programme pages it links. Ohio's STATEWIDE funding-opportunities listing is published as JSON by the official OBM API host api.obm.ohio.gov, but that host presents an INCOMPLETE TLS chain (it sends only its leaf certificate, so curl, bun and node all fail verification with \"unable to get local issuer certificate\"; a browser recovers by fetching the missing intermediate) — a verified-TLS fetch cannot read it, so this connector does NOT use it and Ohio is served by ONE agency. Each programme page publishes a labelled lifecycle table under its own cycle headings, with rows such as \"*Grant Agreement Deadline: August 30, 2026\", \"Off-year Update Deadline at 5 p.m.: April 1, 2026\", \"Application Available in ARTIE: November 2024\", \"Large Orgs' Financial Materials Due: April 1, 2023\" and \"Grant Award Announcement: July 2026\". EXACTLY ONE row type is ever read: the source's own \"Application Deadline …\" row whose value is a full published day, and the LATEST such row on the page becomes the record's close date — read on STRIPPED text (several pages wrap the label in markup that a raw-HTML read misses) and never scoped by an h2 TIMELINE heading, because only one of the 14 pages has that heading. Every other date is REFUSED verbatim into raw.refusedDates with a kind and a reason and is never a posted, close or estimated date: the agreement, final-report and off-year deadlines, the ARTIE availability windows (a window OPENING, not a closing), the award-announcement months, the ADA enactment date in the ADAP page's own prose, the site's news dates around the body, and every month-and-year period. A programme whose ONLY application-deadline row is RELATIVE publishes no date and stays `unverified` (ArtsRISE: \"90 days prior to Project Start Date\"; Big Yellow School Bus: \"At least 8 weeks prior to event\"), as does Ohio Artists on Tour, which publishes no application deadline at all. No posting date and no estimate is ever produced by this source. As of 2026-09-20 the corpus yields 14 records, 2 of them open (Capacity Building and the Artists with Disabilities Access Program, both \"November 1, 2026\"). The Ohio Arts Council is ONE agency of a state whose other departments award grants we have NOT validated, so this is `limited`, never `curated`/`connected` — this is not statewide coverage.",
};
/**
 * NEW YORK — the State's own Grant Opportunity Portal inside the SFS Vendor
 * Portal (`esupplier.sfs.ny.gov`), the source the owner ruled on explicitly
 * (2026-09-19): "Allow normal, temporary public-session cookies only—no login,
 * CAPTCHA bypass, or persistent credential storage. Fail closed if the public
 * session cannot be established."
 *
 * WHY THE HANDSHAKE IS NEEDED. New York's own Grants Management page
 * (`grantsmanagement.ny.gov/search-funding-sfs`) links this portal directly and
 * says of it: "Anyone can access the Grant Opportunity Portal. A username and
 * password are not necessary to view anticipated and available grant
 * opportunities." The portal, however, serves the listing only inside a session:
 * a cookie-less GET of the listing URL answers 302 with no grid at all
 * (verified 2026-09-20), while a GET of the portal's own PUBLIC guest page
 * followed by the listing — carrying the temporary public-session cookies that
 * page set, in memory for that run only — answers 200 with the 22-row
 * "Response Bid Inquiry" grid (`szPinCrefLabel` = "Search for Grant
 * Opportunities"). No credentials are sent, nothing is persisted, and any
 * failure fails closed (the run writes nothing).
 *
 * HONESTY. ONE record per grid row. The record's ONLY date is the column the
 * portal's own header labels "Due Date" — and that binding is proven
 * structurally, by zipping the labels the page prints with the column order its
 * own `gridFieldList_win0` declares, so a grid whose two declarations disagree
 * fails closed instead of being read. The portal's other two date columns
 * ("Availability Date", "Anticipated Release Date") are REFUSED verbatim into
 * `raw.refusedDates`; the second is an ANTICIPATED (i.e. estimated) date, which
 * this workstream never promotes. So no record carries a posting date or an
 * estimate. The grid's own declared row count is cross-checked against the rows
 * parsed, so a truncated grid is a failed read rather than a shorter listing. A
 * row's Grant Opportunity cell is a PeopleSoft `javascript:` post-back and not a
 * URL, so no per-opportunity URL is published — every record points at the
 * official portal page it was read from.
 *
 * TIER. This IS the State's own multi-agency portal (its "Funding Agency" column
 * carries AGM01, CFS01, DDP01, DEC01, DOH01, DOL01, OMH01, TDA01 …), but it is
 * ONE source, so the tier is the owner's own ruling — `limited`, "on one
 * statewide public portal" — and never `curated`/`connected`, and the state is
 * never advertised as statewide comprehensive coverage.
 */
export const NEW_YORK_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: NEW_YORK_CONNECTOR_ID,
  sourceUrl: NEW_YORK_SOURCE_URL,
  testFile: NEW_YORK_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-20",
  tier: "limited",
  note: "One validated source: New York State's own Grant Opportunity Portal inside the SFS Vendor Portal on esupplier.sfs.ny.gov — the portal the State links from grantsmanagement.ny.gov/search-funding-sfs, which states \"Anyone can access the Grant Opportunity Portal. A username and password are not necessary to view anticipated and available grant opportunities.\" The listing is served only inside a PUBLIC session: a cookie-less GET answers 302 with no grid, so it is read through the portal's own public guest page and the temporary public-session cookies that page sets — in memory for that run only, with no credentials sent, nothing persisted, and every failure failing closed (the owner's 2026-09-19 terms). The grid is an Oracle PeopleSoft table with its own printed column headers; EXACTLY ONE of its date columns is ever published as a record's date — the one the portal labels \"Due Date\" (for example \"10/08/2026 4:30PM EDT\") — and that ownership is checked structurally against the grid's own gridFieldList_win0 declaration, so a grid whose headers and field list disagree is refused rather than read. The portal's other two date columns are REFUSED verbatim into raw.refusedDates: \"Availability Date\" is a release/availability stamp, not a closing date, and \"Anticipated Release Date\" is by the source's own word an ANTICIPATED (estimated) date, which this workstream never promotes into a date. Consequently no record carries a posting date or an estimate, no status is inferred from page prose (only from the portal's own Status cell: \"Available\" or \"Advertised Only - Not in SFS\"), and the grid's own declared row count is cross-checked so a truncated grid fails the read. Each row's Grant Opportunity cell is a PeopleSoft javascript post-back rather than a link, so no static per-opportunity URL exists and every record points at the official portal page instead. As of 2026-09-20 the corpus yields 22 records, all of them `open` (every published Due Date is still ahead). Although this IS the State's own multi-agency portal, it is ONE source, so New York is `limited` — the owner's own ruling of 2026-09-19 — and is never presented as statewide comprehensive coverage: this is not statewide coverage.",
};
export const DEFAULT_REGISTRY_INPUTS: RegistryInputs = {
  connectors: {
    VA: virginiaConnector as unknown as StateGrantConnector<never>,
    NE: nebraskaConnector as unknown as StateGrantConnector<never>,
    AZ: arizonaConnector as unknown as StateGrantConnector<never>,
    DE: delawareConnector as unknown as StateGrantConnector<never>,
    HI: hawaiiConnector as unknown as StateGrantConnector<never>,
    PA: pennsylvaniaConnector as unknown as StateGrantConnector<never>,
    RI: rhodeIslandConnector as unknown as StateGrantConnector<never>,
    CA: californiaConnector as unknown as StateGrantConnector<never>,
    KS: kansasConnector as unknown as StateGrantConnector<never>,
    WA: washingtonConnector as unknown as StateGrantConnector<never>,
    AR: arkansasConnector as unknown as StateGrantConnector<never>,
    CO: coloradoConnector as unknown as StateGrantConnector<never>,
    MN: minnesotaConnector as unknown as StateGrantConnector<never>,
    ND: northDakotaConnector as unknown as StateGrantConnector<never>,
    NM: newMexicoConnector as unknown as StateGrantConnector<never>,
    // ESCALATION PASS (owner 2026-09-19).
    TN: tennesseeConnector as unknown as StateGrantConnector<never>,
    UT: utahConnector as unknown as StateGrantConnector<never>,
    // NATIONWIDE continuous tranche (owner 2026-09-19): DC, WV, KY, AL, ME.
    DC: districtOfColumbiaConnector as unknown as StateGrantConnector<never>,
    WV: westVirginiaConnector as unknown as StateGrantConnector<never>,
    KY: kentuckyConnector as unknown as StateGrantConnector<never>,
    AL: alabamaConnector as unknown as StateGrantConnector<never>,
    ME: maineConnector as unknown as StateGrantConnector<never>,
    // CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-19).
    NV: nevadaConnector as unknown as StateGrantConnector<never>,
    OK: oklahomaConnector as unknown as StateGrantConnector<never>,
    SC: southCarolinaConnector as unknown as StateGrantConnector<never>,
    IL: illinoisConnector as unknown as StateGrantConnector<never>,
    // NEXT-12 TRANCHE (owner 2026-09-19).
    NH: newHampshireConnector as unknown as StateGrantConnector<never>,
    MT: montanaConnector as unknown as StateGrantConnector<never>,
    IN: indianaConnector as unknown as StateGrantConnector<never>,
    FL: floridaConnector as unknown as StateGrantConnector<never>,
    TX: texasConnector as unknown as StateGrantConnector<never>,
    MD: marylandConnector as unknown as StateGrantConnector<never>,
    VT: vermontConnector as unknown as StateGrantConnector<never>,
    // CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-19): IA.
    IA: iowaConnector as unknown as StateGrantConnector<never>,
    // CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-20): WY.
    WY: wyomingConnector as unknown as StateGrantConnector<never>,
    NJ: newJerseyConnector as unknown as StateGrantConnector<never>,
    // CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-20): OH.
    OH: ohioConnector as unknown as StateGrantConnector<never>,
    // CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-20): NY.
    NY: newYorkConnector as unknown as StateGrantConnector<never>,
  },
  validations: {
    VA: VIRGINIA_REGISTRY_ENTRY,
    NE: NEBRASKA_REGISTRY_ENTRY,
    AZ: ARIZONA_REGISTRY_ENTRY,
    DE: DELAWARE_REGISTRY_ENTRY,
    HI: HAWAII_REGISTRY_ENTRY,
    PA: PENNSYLVANIA_REGISTRY_ENTRY,
    RI: RHODE_ISLAND_REGISTRY_ENTRY,
    CA: CALIFORNIA_REGISTRY_ENTRY,
    KS: KANSAS_REGISTRY_ENTRY,
    WA: WASHINGTON_REGISTRY_ENTRY,
    AR: ARKANSAS_REGISTRY_ENTRY,
    CO: COLORADO_REGISTRY_ENTRY,
    MN: MINNESOTA_REGISTRY_ENTRY,
    ND: NORTH_DAKOTA_REGISTRY_ENTRY,
    NM: NEW_MEXICO_REGISTRY_ENTRY,
    // ESCALATION PASS (owner 2026-09-19).
    TN: TENNESSEE_REGISTRY_ENTRY,
    UT: UTAH_REGISTRY_ENTRY,
    // NATIONWIDE continuous tranche (owner 2026-09-19): DC, WV, KY, AL, ME.
    DC: DISTRICT_OF_COLUMBIA_REGISTRY_ENTRY,
    WV: WEST_VIRGINIA_REGISTRY_ENTRY,
    KY: KENTUCKY_REGISTRY_ENTRY,
    AL: ALABAMA_REGISTRY_ENTRY,
    ME: MAINE_REGISTRY_ENTRY,
    // CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-19).
    NV: NEVADA_REGISTRY_ENTRY,
    OK: OKLAHOMA_REGISTRY_ENTRY,
    SC: SOUTH_CAROLINA_REGISTRY_ENTRY,
    IL: ILLINOIS_REGISTRY_ENTRY,
    // NEXT-12 TRANCHE (owner 2026-09-19).
    NH: NEW_HAMPSHIRE_REGISTRY_ENTRY,
    MT: MONTANA_REGISTRY_ENTRY,
    IN: INDIANA_REGISTRY_ENTRY,
    FL: FLORIDA_REGISTRY_ENTRY,
    TX: TEXAS_REGISTRY_ENTRY,
    MD: MARYLAND_REGISTRY_ENTRY,
    VT: VERMONT_REGISTRY_ENTRY,
    // CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-19): IA.
    IA: IOWA_REGISTRY_ENTRY,
    // CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-20): WY.
    WY: WYOMING_REGISTRY_ENTRY,
    NJ: NEW_JERSEY_REGISTRY_ENTRY,
    // CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-20): OH.
    OH: OHIO_REGISTRY_ENTRY,
    // CONTINUOUS NATIONWIDE WORKSTREAM (owner 2026-09-20): NY.
    NY: NEW_YORK_REGISTRY_ENTRY,
  },
  approvedHosts: APPROVED_SOURCE_HOSTS,
  states: STATE_CODES,
  names: STATE_NAMES as Record<string, string>,
  sourcesByState: sourcesByStateMap(),
};

/**
 * Derives every registry row from the inputs. Pure and total: every state in
 * `states` gets exactly one entry, and the ONLY way to reach a validated tier is
 * the five-part gate documented at the top of this file.
 */
export function deriveStateRegistry(inputs: RegistryInputs): StateRegistryEntry[] {
  const states = inputs.states ?? STATE_CODES;
  const names = inputs.names ?? (STATE_NAMES as Record<string, string>);
  const approved = new Set(inputs.approvedHosts);
  return states.map((stateCode) => {
    const name = names[stateCode] ?? stateCode;
    const base = {
      stateCode: stateCode as UsStateCode,
      name,
      sourceCount: (inputs.sourcesByState?.[stateCode] ?? []).length,
    };
    const connector = inputs.connectors[stateCode];
    if (!connector) {
      return {
        ...base,
        status: "unavailable" as const,
        connectorId: null,
        reason: "no connector registered for this state",
        sourceUrl: null,
        sourceValidationTest: null,
        note: null,
      };
    }
    const connectorId = connector.id;
    const validation = inputs.validations[stateCode];
    if (!validation) {
      // A connector WITHOUT a passing source-validation test must never reach a
      // validated tier — this is the owner's rollout gate, enforced in code.
      return {
        ...base,
        status: "unavailable" as const,
        connectorId,
        reason: "connector registered but no source-validation test is recorded — not verified against the live source",
        sourceUrl: connector.sourceUrl,
        sourceValidationTest: null,
        note: null,
      };
    }
    if (validation.connectorId !== connectorId || validation.sourceUrl !== connector.sourceUrl) {
      return {
        ...base,
        status: "unavailable" as const,
        connectorId,
        reason: "source-validation manifest disagrees with the connector (connector id or source URL mismatch) — re-validate before covering this state",
        sourceUrl: connector.sourceUrl,
        sourceValidationTest: validation.testFile,
        note: null,
      };
    }
    if (!approved.has(connector.officialHost)) {
      return {
        ...base,
        status: "unavailable" as const,
        connectorId,
        reason: `official host ${connector.officialHost} is not on the approved-source allowlist`,
        sourceUrl: connector.sourceUrl,
        sourceValidationTest: validation.testFile,
        note: null,
      };
    }
    if (!isValidatedTier(validation.tier)) {
      // Fail-closed on a malformed manifest: an unknown/missing tier can never
      // silently become the most permissive one.
      return {
        ...base,
        status: "unavailable" as const,
        connectorId,
        reason: `source-validation manifest declares no valid coverage tier (${VALIDATED_REGISTRY_STATUSES.join(" | ")})`,
        sourceUrl: connector.sourceUrl,
        sourceValidationTest: validation.testFile,
        note: validation.note ?? null,
      };
    }
    const gate = `source-validation test ${validation.testFile} verified against ${connector.sourceUrl} on ${validation.verifiedOn}`;
    if (validation.tier === "connected" && base.sourceCount < CONNECTED_MIN_SOURCES) {
      return {
        ...base,
        status: "limited" as const,
        connectorId,
        reason: `${gate} — but only ${base.sourceCount} source(s) are registered for this state, and the ladder requires at least ${CONNECTED_MIN_SOURCES} for statewide multi-source coverage; reported as limited`,
        sourceUrl: connector.sourceUrl,
        sourceValidationTest: validation.testFile,
        note: validation.note ?? null,
      };
    }
    return {
      ...base,
      status: validation.tier,
      connectorId,
      reason: gate,
      sourceUrl: connector.sourceUrl,
      sourceValidationTest: validation.testFile,
      note: validation.note ?? null,
    };
  });
}

/** The live registry, derived from the real inputs on every access. */
export function listStates(): StateRegistryEntry[] {
  return deriveStateRegistry(DEFAULT_REGISTRY_INPUTS);
}

/** One state's derived entry, or null when the code is not a US state. */
export function getStateEntry(stateCode: string): StateRegistryEntry | null {
  const code = typeof stateCode === "string" ? stateCode.trim().toUpperCase() : "";
  if (!stateCode || code.length === 0) return null;
  return listStates().find((s) => s.stateCode === code) ?? null;
}

/** One state's derived status. Unknown codes are `unavailable`, never covered. */
export function getStateStatus(stateCode: string): StateGrantRegistryStatus {
  return getStateEntry(stateCode)?.status ?? "unavailable";
}

/** True when the state holds a VALIDATED tier (limited | curated | connected). */
export function isStateValidated(stateCode: string): boolean {
  return isValidatedStatus(getStateStatus(stateCode));
}

/** True only for the top tier: statewide, multi-source coverage. */
export function isStateConnected(stateCode: string): boolean {
  return getStateStatus(stateCode) === "connected";
}

/**
 * The connector for a state, or null when the state is NOT validated. This is
 * the fail-closed door the sync runner goes through: a state whose validation
 * gate does not hold cannot be synced at all. `limited` and `curated` states are
 * real, syncable coverage — the owner's correction to part 1 made this explicit.
 */
export function getConnector(stateCode: string): StateGrantConnector<never> | null {
  const entry = getStateEntry(stateCode);
  if (!entry || !isValidatedStatus(entry.status)) return null;
  return DEFAULT_REGISTRY_INPUTS.connectors[entry.stateCode] ?? null;
}

/** Every state with a validated source (the states a sync may touch). */
export function validatedStates(): UsStateCode[] {
  return listStates()
    .filter((s) => isValidatedStatus(s.status))
    .map((s) => s.stateCode);
}

/** The states at the top tier only. */
export function connectedStates(): UsStateCode[] {
  return listStates()
    .filter((s) => s.status === "connected")
    .map((s) => s.stateCode);
}

/** Honest coverage counts for the coverage page. */
export interface CoverageCounts {
  total: number;
  connected: number;
  curated: number;
  limited: number;
  unavailable: number;
  /** Every state with a validated source (limited + curated + connected). */
  validated: number;
}

export function coverageCounts(): CoverageCounts {
  const states = listStates();
  const count = (status: StateGrantRegistryStatus) =>
    states.filter((s) => s.status === status).length;
  const connected = count("connected");
  const curated = count("curated");
  const limited = count("limited");
  return {
    total: states.length,
    connected,
    curated,
    limited,
    unavailable: states.length - connected - curated - limited,
    validated: connected + curated + limited,
  };
}
/**
 * OWNER COPY RULE (2026-09-20) — "50 states, plus D.C.", never "51 states".
 * D.C. is a JURISDICTION, not a state, so the coverage headline may never read
 * "X of 51 states". The registry itself keeps counting all 51 jurisdictions
 * (`counts.total` is untouched); only the RENDERED wording separates D.C. out.
 */
export function isDcValidated(): boolean {
  return listStates().some((s) => s.stateCode === "DC" && isValidatedStatus(s.status));
}
/**
 * THE one coverage-headline generator, shared by the /state-grants page and the
 * coverage API so the two can never drift apart:
 *   "State grant coverage: 37 of 50 states validated, plus Washington, D.C.
 *    (0 connected, 0 curated, 38 limited)".
 * `statesValidated` excludes D.C. when — and only when — the DERIVED registry
 * currently holds D.C. at a validated tier; if it does not, the count is every
 * validated state and no D.C. suffix is printed.
 */
export function coverageHeadlineFor(counts: CoverageCounts, dcValidated: boolean): string {
  const statesValidated = counts.validated - (dcValidated ? 1 : 0);
  return (
    `State grant coverage: ${statesValidated} of 50 states validated` +
    `${dcValidated ? ", plus Washington, D.C." : ""} ` +
    `(${counts.connected} connected, ${counts.curated} curated, ${counts.limited} limited)`
  );
}
