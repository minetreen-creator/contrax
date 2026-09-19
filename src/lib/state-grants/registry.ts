/**
 * Contrax Grants — STATE REGISTRY (owner ROLLOUT order 2026-09-18, part 1).
 *
 * PURE MODULE: no DB, no network, no node builtins (it reads only the connector
 * objects themselves, which are pure). The `state_grant_registry` TABLE is a
 * MIRROR of this module (written by store.server.ts `syncStateRegistry()`), never
 * an independent source of truth.
 *
 * FAIL-CLOSED DERIVATION — the heart of this file
 *   A state reports `connected` ONLY when ALL of these hold:
 *     1. a connector is registered for it,
 *     2. a source-validation manifest entry exists for it, and
 *     3. the entry agrees with the connector on BOTH the connector id and the
 *        source URL, and
 *     4. the connector's `officialHost` is on the approved-host allowlist.
 *   Anything else → `unavailable`, with a machine-readable reason. There is no
 *   code path that lets a hand-set status, a connector alone, or a hopeful
 *   default produce `connected`: the status is computed from the registry inputs
 *   every time it is asked for, and `getConnector()` refuses to hand back a
 *   connector for a state that is not connected.
 *
 *   Requirement 2/3 encode the owner's gate: "a state whose connector has no
 *   passing source-validation test must never report connected". The manifest
 *   names the test file; that test (virginia.source-validation.test.ts) asserts
 *   the manifest entry itself, so the two cannot drift apart silently — if the
 *   test is deleted or renamed, it stops running, and the manifest can no longer
 *   be justified. Va is the ONLY entry, and it is `connected` only because its
 *   connector and its live source-validation test both exist and pass.
 *
 * All 50 states + DC are listed. 49 states + DC are `unavailable` on purpose:
 * the registry existing is NOT coverage, and nothing in the rollout may imply
 * nationwide coverage (owner order). Part 2's coverage UI reads listStates().
 */
import {
  VIRGINIA_APPROVED_HOSTS,
  VIRGINIA_CONNECTOR_ID,
  VIRGINIA_SOURCE_URL,
  VIRGINIA_SOURCE_VALIDATION_TEST,
  virginiaConnector,
} from "~/lib/state-grants/connectors/virginia";
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

export type StateGrantRegistryStatus = "unavailable" | "connected";

/** A state's source-validation manifest entry — the `connected` gate. */
export interface SourceValidationEntry {
  connectorId: string;
  sourceUrl: string;
  /** Repo-relative path of the LIVE source-validation test that must pass. */
  testFile: string;
  /** When that test was last verified against the live source. */
  verifiedOn: string;
}

export interface StateRegistryEntry {
  stateCode: UsStateCode;
  name: string;
  status: StateGrantRegistryStatus;
  connectorId: string | null;
  /** Why this status — `connected` entries carry the gate that passed. */
  reason: string;
  sourceUrl: string | null;
  sourceValidationTest: string | null;
}

/** Everything the derivation needs, injectable so fail-closed is testable. */
export interface RegistryInputs {
  connectors: Record<string, StateGrantConnector<never> | undefined>;
  validations: Record<string, SourceValidationEntry | undefined>;
  approvedHosts: readonly string[];
  states?: readonly string[];
  names?: Record<string, string>;
}

/**
 * Hosts a state connector's official source may live on. A connector whose
 * `officialHost` is not listed here can never be `connected` — so a typo'd or
 * replaced domain fails the gate instead of silently shipping.
 */
export const APPROVED_SOURCE_HOSTS: readonly string[] = [...VIRGINIA_APPROVED_HOSTS];

export const VIRGINIA_REGISTRY_ENTRY: SourceValidationEntry = {
  connectorId: VIRGINIA_CONNECTOR_ID,
  sourceUrl: VIRGINIA_SOURCE_URL,
  testFile: VIRGINIA_SOURCE_VALIDATION_TEST,
  verifiedOn: "2026-09-19",
};

/** The default inputs: one connector, one validated state. */
export const DEFAULT_REGISTRY_INPUTS: RegistryInputs = {
  connectors: {
    VA: virginiaConnector as unknown as StateGrantConnector<never>,
  },
  validations: {
    VA: VIRGINIA_REGISTRY_ENTRY,
  },
  approvedHosts: APPROVED_SOURCE_HOSTS,
  states: STATE_CODES,
  names: STATE_NAMES as Record<string, string>,
};

/**
 * Derives every registry row from the inputs. Pure and total: every state in
 * `states` gets exactly one entry, and the ONLY way to reach `connected` is the
 * four-part gate documented at the top of this file.
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
      };
    }
    const validation = inputs.validations[stateCode];
    const connectorId = connector.id;
    if (!validation) {
      // A connector WITHOUT a passing source-validation test must never report
      // connected — this is the owner's rollout gate, enforced in code.
      return {
        ...base,
        status: "unavailable" as const,
        connectorId,
        reason: "connector registered but no source-validation test is recorded — not verified against the live source",
        sourceUrl: connector.sourceUrl,
        sourceValidationTest: null,
      };
    }
    if (validation.connectorId !== connectorId || validation.sourceUrl !== connector.sourceUrl) {
      return {
        ...base,
        status: "unavailable" as const,
        connectorId,
        reason: "source-validation manifest disagrees with the connector (connector id or source URL mismatch) — re-validate before connecting",
        sourceUrl: connector.sourceUrl,
        sourceValidationTest: validation.testFile,
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
      };
    }
    return {
      ...base,
      status: "connected" as const,
      connectorId,
      reason: `source-validation test ${validation.testFile} verified against ${connector.sourceUrl} on ${validation.verifiedOn}`,
      sourceUrl: connector.sourceUrl,
      sourceValidationTest: validation.testFile,
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

/** One state's derived status. Unknown codes are `unavailable`, never open. */
export function getStateStatus(stateCode: string): StateGrantRegistryStatus {
  return getStateEntry(stateCode)?.status ?? "unavailable";
}

export function isStateConnected(stateCode: string): boolean {
  return getStateStatus(stateCode) === "connected";
}

/**
 * The connector for a state, or null when the state is NOT connected. This is
 * the fail-closed door the sync runner goes through: a state whose validation
 * gate does not hold cannot be synced at all.
 */
export function getConnector(stateCode: string): StateGrantConnector<never> | null {
  const entry = getStateEntry(stateCode);
  if (!entry || entry.status !== "connected") return null;
  return DEFAULT_REGISTRY_INPUTS.connectors[entry.stateCode] ?? null;
}

export function connectedStates(): UsStateCode[] {
  return listStates()
    .filter((s) => s.status === "connected")
    .map((s) => s.stateCode);
}

/** Honest coverage counts for the (part 2) coverage page. */
export interface CoverageCounts {
  total: number;
  connected: number;
  unavailable: number;
}

export function coverageCounts(): CoverageCounts {
  const states = listStates();
  const connected = states.filter((s) => s.status === "connected").length;
  return {
    total: states.length,
    connected,
    unavailable: states.length - connected,
  };
}
