/**
 * Google OAuth helpers for "Continue with Google" signup/login.
 *
 * Only the client ID is needed on this side (it is not secret — it ships in
 * every OAuth client). The client secret is used exclusively by the callback
 * route (`src/routes/auth/google/callback.tsx`) to exchange the authorization
 * code server-side.
 *
 * Env vars (set in Vercel project settings — Settings → Environment Variables):
 *   GOOGLE_CLIENT_ID       — OAuth 2.0 Client ID (Google Cloud Console)
 *   GOOGLE_CLIENT_SECRET   — OAuth 2.0 Client Secret (Google Cloud Console)
 *
 * The redirect URI registered in Google Cloud Console must be exactly:
 *   https://www.contrax.company/auth/google/callback
 */
import { createServerFn } from "@tanstack/react-start";

export const GOOGLE_REDIRECT_URI = "https://www.contrax.company/auth/google/callback";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * Returns the Google OAuth consent-screen URL, or null when the OAuth config
 * is not fully present. Both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be
 * set — the URL itself only needs the (non-secret) client id, but the callback
 * (src/routes/auth/google/callback.tsx) requires BOTH to exchange the code. So
 * we only advertise "Continue with Google" when the whole handshake can
 * genuinely complete; otherwise the CTA is rendered disabled/hidden rather than
 * linking to a flow that would fail server-side. Server function so the verdict
 * is computed from runtime env vars on the server.
 */
export const getGoogleAuthUrl = createServerFn({ method: "GET" }).handler(async () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "consent",
  });

  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
});
