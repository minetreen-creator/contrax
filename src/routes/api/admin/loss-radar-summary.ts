import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { loadLossRadar } from "~/lib/lossRadar";

/** Count of Loss Radar prospects at or above the high-value threshold. */
async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  try {
    const data = await loadLossRadar();
    return Response.json({ highValueProspects: data.highValueCount });
  } catch {
    return Response.json({ highValueProspects: 0 });
  }
}

export const Route = createFileRoute("/api/admin/loss-radar-summary")({
  server: { handlers: { GET: handler } },
});
