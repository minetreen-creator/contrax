import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { refreshBusinessProfile, thumbtackConfig } from "~/lib/thumbtack.server";

/**
 * GET /api/thumbtack/refresh-check — proves automatic token refresh for the
 * signed-in user's Thumbtack connection (Thumbtack asked to confirm it before
 * issuing production credentials, PINT-4484, 2026-10-23): renews the access
 * token with the stored refresh token now, then re-reads the business profile
 * with the new token. Returns what happened; never returns a token.
 */
async function get({ request }: { request: Request }): Promise<Response> {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const cfg = thumbtackConfig();
  if (!cfg) return Response.json({ error: "Thumbtack is not configured" }, { status: 503 });
  const checkedAt = new Date().toISOString();
  try {
    const r = await refreshBusinessProfile(cfg, user.id, { forceRefresh: true });
    if (!r) return Response.json({ connected: false, checkedAt });
    return Response.json({
      connected: true,
      checkedAt,
      refreshed: r.token.refreshed,
      refreshTokenRotated: r.token.rotated,
      newAccessTokenExpiresAt: r.token.expiresAt,
      profileReadWithNewToken: r.profileRead,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[thumbtack] refresh check failed:", message);
    return Response.json({ connected: true, checkedAt, refreshed: false, error: message }, { status: 502 });
  }
}

export const Route = createFileRoute("/api/thumbtack/refresh-check")({ server: { handlers: { GET: get } } });
