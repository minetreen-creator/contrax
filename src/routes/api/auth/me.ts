import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";

async function handler({ request }: { request: Request }): Promise<Response> {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  return Response.json(user);
}

export const Route = createFileRoute("/api/auth/me")({
  server: { handlers: { GET: handler } },
});
