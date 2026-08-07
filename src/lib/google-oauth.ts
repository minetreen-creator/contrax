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
 * Returns the Google OAuth consent-screen URL, or null when GOOGLE_CLIENT_ID
 * is not configured. Server function so the URL is built from the runtime
 * env var on the server — client-side navigation still resolves it via RPC.
 */
export const getGoogleAuthUrl = createServerFn({ method: "GET" }).handler(async () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return null;

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
