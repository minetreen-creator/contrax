import { createFileRoute } from "@tanstack/react-router";
import { buildStateGrantCoverage } from "~/lib/state-grants/coverage.server";

/**
 * GET /api/state-grants/coverage — honest state-grant coverage facts
 * (owner ROLLOUT order 2026-09-18, part 2).
 *
 * The registry half comes from the DERIVED registry (registry.ts listStates()),
 * recomputed per request — never from the state_grant_registry mirror table, so
 * the mirror can never change what coverage Contrax claims. The sync half (last
 * successful sync, record counts, per-status counts) comes from the live tables.
 *
 * RESPONSE 200 { ok, headline, noNationwideCoverage, counts, states[],
 *                connected[], notice, federalGrantsUrl, searchUrl }
 *          500 { ok: false, error } — no partial payload (fail closed); the
 *              coverage PAGE still renders the derived registry from the pure
 *              module and says the sync facts could not be read.
 *
 * ACCESS: public, anonymous, no auth, no events, no pricing. `Cache-Control:
 * no-store` (the numbers move when a sync runs).
 */
const NO_STORE = { "cache-control": "no-store" } as const;

async function handler(): Promise<Response> {
  const outcome = await buildStateGrantCoverage(new Date());
  return new Response(JSON.stringify(outcome.body), {
    status: outcome.status,
    headers: { "content-type": "application/json", ...NO_STORE },
  });
}

export const Route = createFileRoute("/api/state-grants/coverage")({
  server: { handlers: { GET: handler } },
});
