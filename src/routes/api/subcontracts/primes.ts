import { createFileRoute } from "@tanstack/react-router";
import { isPrimesQueryError, parsePrimesQuery } from "~/lib/subcontracts/read";
import { readPrimesPayload } from "~/lib/subcontracts/read.server";

/**
 * GET /api/subcontracts/primes?naics=&state=&page=&limit= — the annual SBA FY24
 * prime-contractor directory, PAGED and FILTERED SERVER-SIDE (owner directive
 * 2026-09-25; BUILD-PLAN.md §6.3/§6.4 #6). 2,917 companies are never shipped whole.
 *
 * QUERY
 *   naics  2–6 digit NAICS code (the code half of the stored `"541330: TITLE"`);
 *          a full "code: TITLE" value is accepted and reduced to its code.
 *   state  a state name exactly as the SBA file writes it (the filter options are
 *          read from the stored file, so the UI only ever offers real values).
 *   page   1-based, default 1, max 500.        limit  1–100, default 25.
 * An ABSENT parameter means "no restriction"; a PRESENT but invalid value is a
 * hard 400 — never silently coerced into a different question than the one asked.
 *
 * RESPONSE 200
 *   { rows[] (company, UEI, agencies, NAICS, state, plan type, source link),
 *     counts: { filtered, directoryTotal }, fy, sourceUrl, page, limit, hasMore,
 *     options: { naics[], states[], naicsTruncated }, generatedAt }
 *          400 { ok: false, error }  invalid present parameter
 * or the same fail-closed `{ unavailable: { reason, explanation, sourceUrl } }`
 * shape as /api/subcontracts when the table is absent or unreadable.
 *
 * `fy` is echoed from the STORED rows (never hardcoded) and the section is labelled
 * historical on the page: these are companies to approach, not open opportunities.
 * `Cache-Control: no-store`; the annual load makes a stale page load unlikely to
 * matter, but an operator re-load can change the file under the same URL.
 */
const NO_STORE = { "cache-control": "no-store" } as const;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...NO_STORE },
  });
}

async function handler({ request }: { request: Request }): Promise<Response> {
  const parsed = parsePrimesQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
  const payload = await readPrimesPayload(parsed.value, new Date());
  // The read layer re-validates before it reads (see readPrimesPayload): a query that
  // reaches it invalid answers 400 here rather than being mistaken for a store failure.
  if (isPrimesQueryError(payload)) return json(payload, 400);
  return json(payload, 200);
}

export const Route = createFileRoute("/api/subcontracts/primes")({
  server: { handlers: { GET: handler } },
});
