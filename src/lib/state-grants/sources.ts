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
import { arizonaConnector } from "~/lib/state-grants/connectors/arizona";
import { delawareConnector } from "~/lib/state-grants/connectors/delaware";
import { hawaiiConnector } from "~/lib/state-grants/connectors/hawaii";
import { pennsylvaniaConnector } from "~/lib/state-grants/connectors/pennsylvania";
import { rhodeIslandConnector } from "~/lib/state-grants/connectors/rhode-island";
// NATIONWIDE workstream, batch 1 (owner order 2026-09-19): CA, KS, WA. A missing
// entry here is SILENT — the state still syncs, but the coverage row reports
// `sourceCount 0` — so every batch must add its connectors to this list.
import { californiaConnector } from "~/lib/state-grants/connectors/california";
import { kansasConnector } from "~/lib/state-grants/connectors/kansas";
import { washingtonConnector } from "~/lib/state-grants/connectors/washington";
// NATIONWIDE workstream, batch 2 (owner order 2026-09-19): AR, CO, MN, ND, NM.
// A missing entry here is SILENT — the state still syncs, but the coverage row
// reports `sourceCount 0` — so every batch must add its connectors to this list.
import { arkansasConnector } from "~/lib/state-grants/connectors/arkansas";
import { coloradoConnector } from "~/lib/state-grants/connectors/colorado";
import { minnesotaConnector } from "~/lib/state-grants/connectors/minnesota";
import { northDakotaConnector } from "~/lib/state-grants/connectors/north-dakota";
import { newMexicoConnector } from "~/lib/state-grants/connectors/new-mexico";
// ESCALATION PASS (owner escalation order 2026-09-19): TN, UT.
// A missing entry here is SILENT — the state still syncs, but the coverage row
// reports `sourceCount 0` — so every batch must add its connectors to this list.
import { tennesseeConnector } from "~/lib/state-grants/connectors/tennessee";
import { utahConnector } from "~/lib/state-grants/connectors/utah";

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
  // P3 batch #1 (2026-09-19): one validated source per state, so each of these
  // states is `limited` — never advertised as statewide coverage.
  arizonaConnector as unknown as StateGrantConnector<never>,
  delawareConnector as unknown as StateGrantConnector<never>,
  hawaiiConnector as unknown as StateGrantConnector<never>,
  pennsylvaniaConnector as unknown as StateGrantConnector<never>,
  rhodeIslandConnector as unknown as StateGrantConnector<never>,
  // NATIONWIDE batch 1 (2026-09-19): one validated source per state, so each of
  // these states is `limited` — never advertised as statewide coverage.
  californiaConnector as unknown as StateGrantConnector<never>,
  kansasConnector as unknown as StateGrantConnector<never>,
  washingtonConnector as unknown as StateGrantConnector<never>,
  // NATIONWIDE batch 2 (2026-09-19): one validated source per state, so each of
  // these states is `limited` — never advertised as statewide coverage.
  arkansasConnector as unknown as StateGrantConnector<never>,
  coloradoConnector as unknown as StateGrantConnector<never>,
  minnesotaConnector as unknown as StateGrantConnector<never>,
  northDakotaConnector as unknown as StateGrantConnector<never>,
  newMexicoConnector as unknown as StateGrantConnector<never>,
  // ESCALATION PASS (2026-09-19): one validated source per state, so each of
  // these states is `limited` — never advertised as statewide coverage.
  tennesseeConnector as unknown as StateGrantConnector<never>,
  utahConnector as unknown as StateGrantConnector<never>,
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
