import { createFileRoute } from "@tanstack/react-router";
import {
  parseStateGrantSearchBody,
  runStateGrantSearch,
} from "~/lib/state-grants/search.server";

/**
 * POST /api/state-grants/search — Contrax Grants, STATE side (owner ROLLOUT
 * order 2026-09-18, part 2; re-cut onto the corrected model, R1 2026-09-19).
 *
 * Reads the STORED state opportunities (Virginia — `limited` — today) through
 * the honest query surface; it never calls a state website itself and never
 * touches the federal Grants.gov path. This handler is deliberately thin:
 * validation, the registry gate, the query, the honesty mapping and the
 * fail-closed error shape all live in runStateGrantSearch() so the integration
 * suite can exercise exactly what this route serves.
 *
 * REQUEST  (JSON body; every field optional — a bare POST is a valid search)
 *   { stateCodes?: string[],
 *     status?: 'open'|'upcoming'|'rolling'|'closed'|'unverified',
 *     term?: string,
 *     eligibleApplicants?: string, eligibleGeography?: string,
 *     categories?: string[], awardRange?: string,
 *     awardMinAmount?: number, awardMaxAmount?: number,
 *     totalFunding?: string, matchingRequirement?: string,
 *     limit?: number (default 25, max 100), offset?: number }
 *   `forecast` is NOT a status any more: it is rejected by name rather than
 *   silently treated as "any status".
 *
 * RESPONSE 200 { ok, source, status, statesIncluded, statesMatched,
 *   uncoveredStates, uncoveredNotice, totalCount, countExact, asOf, limit,
 *   offset, returned, hasMore, limitCapped, countLabel, filters, notice,
 *   records[] } — each record carries its status label, its honestly-labelled
 *   date line (an estimate is never a deadline), its source (from
 *   state_grant_sources) with the official link, and "Not specified" for
 *   anything the agency did not publish.
 *          400 { ok: false, error }   present-but-invalid input
 *          500 { ok: false, error }   store failure — NO partial result set
 *
 * ACCESS: anonymous and free (parity with federal grants). No auth, no
 * subscription, no per-visitor cap, no analytics event, no pricing copy.
 * Every response is `Cache-Control: no-store`.
 */
const NO_STORE = { "cache-control": "no-store" } as const;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...NO_STORE },
  });
}

async function handler({ request }: { request: Request }): Promise<Response> {
  const parsedBody = parseStateGrantSearchBody(await request.text());
  if (!parsedBody.ok) {
    return json({ ok: false, error: parsedBody.error }, 400);
  }
  const outcome = await runStateGrantSearch(parsedBody.value, new Date());
  return json(outcome.body, outcome.status);
}

export const Route = createFileRoute("/api/state-grants/search")({
  server: { handlers: { POST: handler } },
});
