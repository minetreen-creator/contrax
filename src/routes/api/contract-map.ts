import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { buildContractMap } from "~/lib/contract-map";

/**
 * GET /api/contract-map
 *
 * Aggregates the LIVE `bids` table into a per-state summary for the /map page,
 * in ONE pass over the open-bid population (open = due_date null or >= today,
 * the same "open" notion used across the app, plus the shared low-content
 * filter so the map matches every other public open-opportunity surface).
 *
 * Returns a stable, cache-friendly shape:
 *   { states: { VA: {code,count,setAsideCount,closingSoon,statedValue,withValue,
 *                     agencies[], industries[], setAsideBreakdown[]}, ... },
 *     totals: { totalOpen, totalStates, totalStatedValue, totalWithValue,
 *               unspecified, generatedAt } }
 *
 * "statedValue" sums only estimated_value strings that parse to a positive
 * dollar figure; "withValue" is how many bids contributed, so the UI can say
 * "$218M in stated value across N bids" honestly. Bids we cannot attribute to
 * a specific state roll into totals.unspecified (never fabricated into a state).
 */
async function handler({ request }: { request: Request }) {
  try {
    const rows = await sql()`
      SELECT location, set_aside, estimated_value, agency, category, due_date
      FROM bids
      WHERE (due_date IS NULL OR due_date::date >= NOW()::date)
        AND ${sql().unsafe(LOW_CONTENT_SQL)}
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
