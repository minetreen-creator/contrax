import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { connectionStatus, deleteConnection, thumbtackConfig } from "~/lib/thumbtack.server";

/**
 * GET    /api/thumbtack/connection — is this user's Thumbtack account connected?
 * DELETE /api/thumbtack/connection — disconnect: delete every stored Thumbtack
 *                                    token and profile field for the user.
 */
async function get({ request }: { request: Request }): Promise<Response> {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!thumbtackConfig()) return Response.json({ available: false, connected: false });
  return Response.json({ available: true, ...(await connectionStatus(user.id)) });
}

async function del({ request }: { request: Request }): Promise<Response> {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  await deleteConnection(user.id);
  return Response.json({ connected: false });
}

export const Route = createFileRoute("/api/thumbtack/connection")({ server: { handlers: { GET: get, DELETE: del } } });
