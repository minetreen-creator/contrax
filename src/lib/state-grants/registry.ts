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
 * All 50 states + DC are listed. 45 states + DC are `unavailable` on purpose
 * (2026-09-19: Virginia plus the five P3 batch-1 states are validated as
 * `limited` — one source each): the registry existing is NOT coverage, and
 * nothing in the rollout may imply nationwide coverage (owner order). The
 * coverage UI reads listStates().
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
export const DEFAULT_REGISTRY_INPUTS: RegistryInputs = {
  connectors: {
    VA: virginiaConnector as unknown as StateGrantConnector<never>,
    AZ: arizonaConnector as unknown as StateGrantConnector<never>,
    DE: delawareConnector as unknown as StateGrantConnector<never>,
    HI: hawaiiConnector as unknown as StateGrantConnector<never>,
    PA: pennsylvaniaConnector as unknown as StateGrantConnector<never>,
    RI: rhodeIslandConnector as unknown as StateGrantConnector<never>,
  },
  validations: {
    VA: VIRGINIA_REGISTRY_ENTRY,
    AZ: ARIZONA_REGISTRY_ENTRY,
    DE: DELAWARE_REGISTRY_ENTRY,
    HI: HAWAII_REGISTRY_ENTRY,
    PA: PENNSYLVANIA_REGISTRY_ENTRY,
    RI: RHODE_ISLAND_REGISTRY_ENTRY,
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
 *   "State grant coverage: 35 of 50 states validated, plus Washington, D.C.
 *    (0 connected, 0 curated, 36 limited)".
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
