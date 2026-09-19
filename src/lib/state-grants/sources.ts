/**
 * Contrax Grants — the SOURCE REGISTRY (code side, owner correction 1,
 * 2026-09-19).
 *
 * One entry per official source we read. A source is created by a CONNECTOR (the
 * connector's id is the source key), and the `state_grant_sources` table is a
 * mirror of this list — exactly like `state_grant_registry` mirrors registry.ts.
 * The sync runner resolves the connector it is about to run to its source row, so
 * an opportunity is always attributed to the source that produced it, and two
 * agencies issuing the same external id are two rows rather than an overwrite.
 *
 * PURE MODULE: no DB, no network, no node builtins.
 */
import type { StateGrantConnector } from "~/lib/state-grants/connector";
import { virginiaConnector } from "~/lib/state-grants/connectors/virginia";

/** One official source: the `state_grant_sources` row a connector resolves to. */
export interface StateGrantSource {
  /** Stable key — the connector id. `state_grant_sources.source_key`. */
  sourceKey: string;
  stateCode: string;
  /** Human label of the listing this source is. */
  name: string;
  /** The publishing body, in the source's own words where it names itself. */
  agency: string;
  officialUrl: string;
  officialHost: string;
}

/** The source a connector reads. One connector ⇔ one source, by construction. */
export function sourceForConnector(connector: StateGrantConnector<never>): StateGrantSource {
  return {
    sourceKey: connector.id,
    stateCode: connector.stateCode,
    name: connector.sourceName,
    agency: connector.agency,
    officialUrl: connector.sourceUrl,
    officialHost: connector.officialHost,
  };
}

const CONNECTORS: readonly StateGrantConnector<never>[] = [
  virginiaConnector as unknown as StateGrantConnector<never>,
];

/** Every source the code knows about, in registry order. */
export const STATE_GRANT_SOURCES: readonly StateGrantSource[] = CONNECTORS.map(sourceForConnector);

export function listStateSources(): StateGrantSource[] {
  return [...STATE_GRANT_SOURCES];
}

/** The sources registered for one state (may be more than one — the point). */
export function sourcesForState(stateCode: string): StateGrantSource[] {
  const code = typeof stateCode === "string" ? stateCode.trim().toUpperCase() : "";
  if (!code) return [];
  return STATE_GRANT_SOURCES.filter((s) => s.stateCode === code);
}

/** The source behind a connector id, or null (fail-closed on unknown keys). */
export function getStateSource(sourceKey: string): StateGrantSource | null {
  return STATE_GRANT_SOURCES.find((s) => s.sourceKey === sourceKey) ?? null;
}
