import { createFileRoute } from "@tanstack/react-router";
import { setCookie } from "@tanstack/react-start/server";
import { sql } from "~/db";
import { SESSION_COOKIE } from "~/lib/auth";
import { parseCookies } from "~/lib/api-auth";

/**
 * Logs the current user out: destroys the session row and expires the session
 * cookie (the cookie is httpOnly, so the browser cannot clear it from JS — the
 * server must send the expiry Set-Cookie, same as /api/login sets it).
 */
async function handler({ request }: { request: Request }) {
  try {
    const token = parseCookies(request)[SESSION_COOKIE];
    if (token) {
      await sql()`DELETE FROM sessions WHERE token = ${token}`;
    }
    setCookie(SESSION_COOKIE, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return Response.json({ success: true });
  } catch (err) {
    console.error("[api/logout] error:", err);
    return Response.json({ error: "Failed to log out" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/logout")({
  server: { handlers: { POST: handler } },
});
