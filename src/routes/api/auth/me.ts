import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { anonHintSetCookie } from "~/lib/anon-hint";

async function handler({ request }: { request: Request }): Promise<Response> {
  const user = await getUserFromRequest(request);
  if (!user) {
    // Known-anonymous hint (src/lib/anon-hint.ts): the browser skips this call
    // for the next hour; any login clears it.
    return Response.json(
      { error: "Not authenticated" },
      { status: 401, headers: { "set-cookie": anonHintSetCookie(), "cache-control": "no-store" } },
    );
  }
  return Response.json(user);
}

export const Route = createFileRoute("/api/auth/me")({
  server: { handlers: { GET: handler } },
});
