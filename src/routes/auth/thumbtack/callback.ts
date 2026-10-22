import { createFileRoute } from "@tanstack/react-router";
import { parseCookies } from "~/lib/api-auth";
import {
  exchangeCode,
  fetchBusinessProfile,
  saveConnection,
  thumbtackConfig,
  THUMBTACK_NONCE_COOKIE,
  verifyState,
} from "~/lib/thumbtack.server";

/**
 * GET /auth/thumbtack/callback — the redirect URI registered with Thumbtack
 * (PINT-4484). Verifies the signed state against the nonce cookie, exchanges
 * the code for tokens, reads the business profile (read-only), stores it
 * encrypted, and returns the pro to /settings.
 */
const back = (status: string) =>
  new Response(null, {
    status: 302,
    headers: {
      Location: `/settings?thumbtack=${status}`,
      "Set-Cookie": `${THUMBTACK_NONCE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    },
  });

async function handler({ request }: { request: Request }): Promise<Response> {
  const cfg = thumbtackConfig();
  if (!cfg) return back("unavailable");
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("invalid");
  const userId = verifyState(cfg, state, parseCookies(request)[THUMBTACK_NONCE_COOKIE] ?? null);
  if (!userId) return back("invalid");
  try {
    const tokens = await exchangeCode(cfg, code);
    const profile = await fetchBusinessProfile(cfg, tokens.access_token);
    await saveConnection(userId, tokens, profile);
    return back("connected");
  } catch (e) {
    console.error("[thumbtack] connect failed:", e instanceof Error ? e.message : e);
    return back("error");
  }
}

export const Route = createFileRoute("/auth/thumbtack/callback")({ server: { handlers: { GET: handler } } });
