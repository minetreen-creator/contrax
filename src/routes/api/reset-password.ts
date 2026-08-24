import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { hashPassword } from "~/lib/password";
import { isBlockedIp } from "~/lib/request-ip";

const RESET_SECRET = "contrax-reset-2026";

async function handler({ request }: { request: Request }) {
  // Throttle a known hostile IP from resetting passwords. Exact-match only;
  // generic 403 that does not reveal why. Runs before parsing the body / any
  // token claim or password write.
  if (isBlockedIp(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = (await request.json()) as {
      email?: string;
      newPassword?: string;
      secret?: string;
      token?: string;
    };

    const newPassword = body.newPassword || "";
    if (newPassword.length < 6) {
      return Response.json({ error: "Password must be at least 6 characters." }, { status: 400 });
    }

    // Self-service path: a one-time token issued by /api/forgot-password.
    const token = (body.token || "").trim();
    if (token) {
      return await handleTokenReset(token, newPassword);
    }

    // Admin path: shared secret.
    if (body.secret !== RESET_SECRET) {
      return Response.json({ error: "Invalid reset secret." }, { status: 401 });
    }

    const email = (body.email || "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    const passwordHash = await hashPassword(newPassword);
    const updated = await sql()`
      UPDATE users
      SET password_hash = ${passwordHash}
      WHERE email = ${email}
      RETURNING id
    `;

    if (updated.length === 0) {
      return Response.json({ error: "No account found for that email." }, { status: 404 });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("[api/reset-password] error:", err);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

async function handleTokenReset(token: string, newPassword: string): Promise<Response> {
  // Atomically claim the token: it must exist, be unused, and not be expired.
  // The UPDATE acts as a lock — only one request can claim it, so the token
  // can never be used twice.
  const claimed = await sql()`
    UPDATE password_reset_tokens
    SET used = TRUE
    WHERE token = ${token} AND used = FALSE AND expires_at > NOW()
    RETURNING id, email
  `;

  if (claimed.length === 0) {
    return Response.json(
      { error: "This reset link has expired or has already been used." },
      { status: 401 },
    );
  }

  const { email } = claimed[0] as { id: number; email: string };

  const passwordHash = await hashPassword(newPassword);
  const updated = await sql()`
    UPDATE users
    SET password_hash = ${passwordHash}
    WHERE email = ${email}
    RETURNING id
  `;

  if (updated.length === 0) {
    // Account was deleted after the token was issued — treat as invalid.
    return Response.json(
      { error: "This reset link has expired or has already been used." },
      { status: 401 },
    );
  }

  return Response.json({ success: true });
}

export const Route = createFileRoute("/api/reset-password")({
  server: { handlers: { POST: handler } },
});
