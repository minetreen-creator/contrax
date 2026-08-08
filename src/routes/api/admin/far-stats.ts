import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { getFarClauseStats } from "~/lib/far-dfars";

/** FAR/DFARS clause counts for the admin card. */
async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  return Response.json(await getFarClauseStats());
}

export const Route = createFileRoute("/api/admin/far-stats")({
  server: { handlers: { GET: handler } },
});
