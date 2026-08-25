import { createFileRoute } from "@tanstack/react-router";
import { setCookie } from "@tanstack/react-start/server";
import { isBlockedIp } from "~/lib/request-ip";
import {
  LINKEDIN_AUTH_ENDPOINT,
  LINKEDIN_REDIRECT_URI,
  LINKEDIN_SCOPES,
  LINKEDIN_STATE_COOKIE,
  LINKEDIN_STATE_TTL_SECONDS,
} from "~/lib/linkedin-oauth";

const VALID_PLANS = ["basic", "starter", "professional", "agency"] as const;

/**
 * Initiates LinkedIn OAuth. Linked from the "Continue with LinkedIn" button on
 * the signup/login pages (`/api/linkedin/start`).
 *
 *   1. Rejects a known hostile IP (mirror the Google callback guard).
 *   2. Does NOT build a broken URL when `LINKEDIN_CLIENT_ID` is absent — sends
 *      the user back to /signup with a non-scare note instead. The button is
 *      also disabled client-side while the key is missing.
 *   3. Generates a random CSRF nonce, stores it in a short-lived httpOnly
 *      cookie, and forwards it (plus the save-to-pipeline / plan intent) inside
 *      LinkedIn's mandatory `state` parameter.
 *   4. 302-redirects to LinkedIn's authorization endpoint.
 *
 * The redirect-while-setting-cookie must happen via a real HTTP response (this
 * full-page navigation), which is why the nonce cookie is set here rather than
 * through a client RPC server-fn.
 */
async function handler({ request }: { request: Request }) {
  // Exact-match hostile-IP guard before any redirect / cookie work.
  if (isBlockedIp(request)) {
    return new Response(null, { status: 302, headers: { Location: "/login?error=account_unavailable" } });
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) {
    // Keys not configured yet — never emit a broken OAuth URL. Non-scare note.
    return new Response(null, {
      status: 302,
      headers: { Location: "/signup?error=linkedin_not_configured" },
    });
  }

  // Carry the save-to-pipeline / plan intent through LinkedIn's `state`
  // (mirrors how the Google flow rides `state`). `next` is re-validated by
  // safeNext() at redirect time on the callback (open-redirect guard).
  const url = new URL(request.url);
  const saveBidRaw = url.searchParams.get("save_bid");
  const saveBid = saveBidRaw && /^\d{1,10}$/.test(saveBidRaw) ? Number(saveBidRaw) : null;
  const next = url.searchParams.get("next");
  const planRaw = url.searchParams.get("plan");
  const plan =
    typeof planRaw === "string" && (VALID_PLANS as readonly string[]).includes(planRaw)
      ? planRaw
      : undefined;

  // CSRF nonce shared between the httpOnly cookie and LinkedIn's echoed `state`.
  const nonce = crypto.randomUUID();
  const state = JSON.stringify({
    nonce,
    save_bid: saveBid,
    next: typeof next === "string" ? next.slice(0, 500) : null,
    plan,
  });

  setCookie(LINKEDIN_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: LINKEDIN_STATE_TTL_SECONDS,
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: LINKEDIN_REDIRECT_URI,
    scope: LINKEDIN_SCOPES,
    state,
  });

  return new Response(null, {
    status: 302,
    headers: { Location: `${LINKEDIN_AUTH_ENDPOINT}?${params.toString()}` },
  });
}

export const Route = createFileRoute("/api/linkedin/start")({
  server: { handlers: { GET: handler } },
});
