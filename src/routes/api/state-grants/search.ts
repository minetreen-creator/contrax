import { createFileRoute } from "@tanstack/react-router";
import {
  parseStateGrantSearchBody,
  runStateGrantSearch,
} from "~/lib/state-grants/search.server";

/**
 * POST /api/state-grants/search — Contrax Grants, STATE side (owner ROLLOUT
 * order 2026-09-18, part 2).
 *
 * Reads the STORED state opportunities (Virginia today) through the honest
 * query surface; it never calls a state website itself and never touches the
 * federal Grants.gov path. This handler is deliberately thin: validation, the
 * query, the honesty mapping and the fail-closed error shape all live in
 * runStateGrantSearch() so the integration suite can exercise exactly what this
 * route serves.
 *
 * REQUEST  (JSON body; every field optional — a bare POST is a valid search)
 *   { stateCodes?: string[], status?: 'open'|'forecast'|'closed',
 *     term?: string, limit?: number (default 25, max 100), offset?: number }
 *
 * RESPONSE 200 { ok, source, status, statesIncluded, statesMatched, totalCount,
 *   countExact, asOf, limit, offset, returned, hasMore, limitCapped, countLabel,
 *   notice, records[] } — each record carries its status label, its
 *   honesty-labelled deadline (a forecast's date is an estimate, never a
 *   deadline), its official source label ("Virginia Tourism Corporation —
 *   vatc.org") and the official link, with "Not specified" for anything the
 *   source did not publish.
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
