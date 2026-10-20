import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { latestRun } from "~/lib/path-checks.server";

/** GET /api/admin/path-checks — the latest daily money-path check (admin only). */
async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  return Response.json(await latestRun());
}

export const Route = createFileRoute("/api/admin/path-checks")({
  server: { handlers: { GET: handler } },
});
