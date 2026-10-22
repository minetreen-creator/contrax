import { createFileRoute } from "@tanstack/react-router";
import { randomBytes } from "node:crypto";
import { getUserFromRequest } from "~/lib/api-auth";
import { authorizeUrl, signState, thumbtackConfig, THUMBTACK_NONCE_COOKIE } from "~/lib/thumbtack.server";

/**
 * GET /api/thumbtack/connect — start "Connect with Thumbtack" for the signed-in
 * user: set a short-lived nonce cookie and redirect to Thumbtack's consent page
 * with a signed state (thumbtack.server.ts).
 */
async function handler({ request }: { request: Request }): Promise<Response> {
  const user = await getUserFromRequest(request);
  if (!user) return new Response(null, { status: 302, headers: { Location: "/login?next=/settings" } });
  const cfg = thumbtackConfig();
  if (!cfg) return new Response(null, { status: 302, headers: { Location: "/settings?thumbtack=unavailable" } });
  const nonce = randomBytes(16).toString("base64url");
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl(cfg, signState(cfg, user.id, nonce)),
      "Set-Cookie": `${THUMBTACK_NONCE_COOKIE}=${nonce}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

export const Route = createFileRoute("/api/thumbtack/connect")({ server: { handlers: { GET: handler } } });
