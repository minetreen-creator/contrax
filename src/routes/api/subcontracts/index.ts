import { createFileRoute } from "@tanstack/react-router";
import { readSubcontractsPayload } from "~/lib/subcontracts/read.server";

/**
 * GET /api/subcontracts — the /subcontracts page's single read (owner directive
 * 2026-09-25; BUILD-PLAN.md §6.3). READ-ONLY: it reads what the SUBNet sweeper
 * stored and nothing else — no crawl, no external call, no write, no cache table.
 *
 * RESPONSE 200 — either
 *   { rows[], counts: { total, byState[], byTrade[] },
 *     coverage: { source: "SBA SUBNet", tier, lastSyncAt, lastCheckedAt,
 *                 missingClosingDateCount, excludedText },
 *     primeDirectory: { fy, sourceUrl, counts: { total } },
 *     generatedAt }
 *   …where `rows` is the STORED OPEN set only (`status = 'open'`: the source
 *   published a closing date that has not passed), the counts are derived from
 *   those same rows, `lastSyncAt` is the latest SUCCESSFUL sweep's finish time, and
 *   `missingClosingDateCount` is the real count of rows the open list excludes
 *   because no closing date is stated.
 * or the explicit fail-closed shape
 *   { unavailable: { reason, explanation, sourceUrl } }
 * — returned when the tables are absent (a database without migration 050), when no
 * completed sweep is recorded, or when the store cannot be read. The page renders
 * an honest "not available" state for it; it never turns it into an empty list,
 * because "no rows" and "we could not look" are different statements.
 *
 * The prime-directory ROWS are deliberately NOT shipped here: the annual FY24 file
 * is 2,917 companies and belongs to `/api/subcontracts/primes` (paged, filtered).
 * Only its stored total, fiscal year and official source URL ride along.
 *
 * ACCESS: public and anonymous (parity with the Grants surfaces). No auth, no
 * subscription, no cap, no analytics event, no pricing copy. `Cache-Control:
 * no-store` — the numbers move when the daily sweep runs.
 */
const NO_STORE = { "cache-control": "no-store" } as const;

async function handler(): Promise<Response> {
  const payload = await readSubcontractsPayload(new Date());
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json", ...NO_STORE },
  });
}

export const Route = createFileRoute("/api/subcontracts/")({
  server: { handlers: { GET: handler } },
});
