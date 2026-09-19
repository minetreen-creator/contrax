/**
 * Contrax Grants — State Grants, SERVER-SIDE BARREL (owner ROLLOUT order
 * 2026-09-18, part 1).
 *
 * Everything part 2 (the state search API + the coverage page) needs, behind one
 * import — and behind a `.server.ts` name, because this file reaches Postgres.
 * The PURE half (the connector contract, the classifier, the registry) is safe to
 * import anywhere and lives in ./connector and ./registry; import those directly
 * from anything that is also bundled for the client.
 *
 * Query surface (what part 2 will call):
 *   coverage:  listStates(), getStateEntry(), coverageCounts(), readStateRegistry()
 *   search:    queryStateGrants({ stateCode | stateCodes, status, term, limit, offset })
 *              countStateGrants(...), stateGrantStatusCounts(stateCode)
 *   health:    listStateSyncRuns(stateCode)
 *   ops:       runStateGrantSync(stateCode), runAllConnectedStateSyncs(), syncStateRegistry()
 *
 * PART 2 ADDITIONS (search/API integration + coverage UI):
 *   ./search        — the pure request contract, display rules and record view
 *   ./search.server — runStateGrantSearch() (what POST /api/state-grants/search serves)
 *   ./coverage.server — buildStateGrantCoverage() (what GET /api/state-grants/coverage serves)
 */
export * from "~/lib/state-grants/connector";
export * from "~/lib/state-grants/registry";
export * from "~/lib/state-grants/store.server";
export * from "~/lib/state-grants/sync.server";
export * from "~/lib/state-grants/search";
export * from "~/lib/state-grants/search.server";
export * from "~/lib/state-grants/coverage.server";
export { virginiaConnector } from "~/lib/state-grants/connectors/virginia";
