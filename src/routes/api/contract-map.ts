import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import {
  OPEN_BID_SQL,
  AWARD_NOTICE_EXCLUSION_SQL,
  CLOSED_EXCLUSION_SQL,
} from "~/lib/open-bids";
import { buildContractMap } from "~/lib/contract-map";

/**
 * GET /api/contract-map
 *
 * Aggregates the LIVE `bids` table into a per-state summary for the /map page,
 * in ONE pass over the open-bid population. "Open" here means a REAL deadline
 * still ahead (`OPEN_BID_SQL`, owner-approved 2026-10-19): a stored notice with
 * no due date is NOT an open bid. It also drops award / justification notices
 * (`AWARD_NOTICE_EXCLUSION_SQL`) and the award-only city feeds
 * (`AWARD_EXCLUSION_SQL`), plus the shared low-content filter so the map matches
 * every other public open-opportunity surface.
 *
 * Returns a stable, cache-friendly shape:
 *   { states: { VA: {code,count,federalCount,stateLocalCount,setAsideCount,
 *                     closingSoon,statedValue,withValue,
 *                     agencies[], industries[], setAsideBreakdown[]}, ... },
 *     totals: { totalOpen, federalOpen, stateLocalOpen, totalStates,
 *               totalStatedValue, totalWithValue,
 *               unspecified, generatedAt } }
 *
 * `federalOpen` / `stateLocalOpen` split `totalOpen` by the row's `source` using
 * the same classifier that renders the "Federal" badge (owner 2026-10-19: the
 * homepage counter must never present a blended all-source figure as federal).
 *
 * "statedValue" sums only estimated_value strings that parse to a positive
 * dollar figure; "withValue" is how many bids contributed, so the UI can say
 * "$218M in stated value across N bids" honestly. Bids we cannot attribute to
 * a specific state roll into totals.unspecified (never fabricated into a state).
 */
async function handler({ request: _request }: { request: Request }) {
  try {
    const rows = await sql()`
      SELECT location, set_aside, estimated_value, agency, category, due_date, source
      FROM bids
      WHERE ${sql().unsafe(OPEN_BID_SQL)}
        AND ${sql().unsafe(LOW_CONTENT_SQL)}
        AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
        AND ${sql().unsafe(AWARD_NOTICE_EXCLUSION_SQL)}
        AND ${sql().unsafe(CLOSED_EXCLUSION_SQL)}
    `;
    return Response.json(buildContractMap(rows as any), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch {
    return Response.json(
      { error: "Contract map temporarily unavailable" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/contract-map")({
  server: { handlers: { GET: handler } },
});
