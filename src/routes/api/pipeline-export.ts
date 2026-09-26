import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { hasBidScoutAccess } from "~/lib/plan-gates.server";
import { gateLockedPayload } from "~/lib/plan-gates";
import {
  loadPipelineRows,
  pipelineCsvFilename,
  toPipelineCsv,
  neonPipelineExportStore,
  type PipelineExportStore,
} from "~/lib/pipeline-export";

/**
 * GET /api/pipeline-export — the REAL CSV export of the signed-in user's saved
 * pipeline, behind the Bid Scout gate (owner decision 2, 2026-09-26).
 *
 *   • Not signed in                     → 401 { error: "Not authenticated" }
 *   • Signed in without Bid Scout       → 402 + the gate payload
 *                                          { locked, gate: "export",
 *                                            upgrade_required: "bid_scout", … }
 *     (an ATTEMPT-only prompt: the client opens the Bid Scout prompt and fires
 *      `export_attempted` with label "gated" at this moment — never on view)
 *   • Bid Scout (or admin/demo/grant)   → text/csv attachment of the user's own
 *                                          saved rows. Nothing is fabricated: an
 *                                          empty pipeline is a header-only file.
 *
 * Exported as a testable handler so the gate + CSV contract can be asserted
 * without a database (the store is injectable).
 */
export async function pipelineExportHandler(
  request: Request,
  deps: { store?: PipelineExportStore } = {},
): Promise<Response> {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const entitled = await hasBidScoutAccess(user.id, user);
  if (!entitled) {
    return Response.json(
      {
        ...gateLockedPayload("export"),
        error: "Bid Scout required",
      },
      { status: 402 },
    );
  }

  try {
    const rows = await loadPipelineRows(user.id, deps.store ?? neonPipelineExportStore);
    const csv = toPipelineCsv(rows);
    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${pipelineCsvFilename()}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/pipeline-export] error:", err);
    return Response.json({ error: "Export failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/pipeline-export")({
  server: { handlers: { GET: ({ request }) => pipelineExportHandler(request) } },
});
