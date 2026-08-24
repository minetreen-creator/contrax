import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { sendPasswordResetEmail } from "~/lib/email";
import { isBlockedIp } from "~/lib/request-ip";

// Migration-style DDL — idempotent, runs on every request so the table
// self-heals on any environment that hasn't applied it yet.
const CREATE_RESET_TOKENS_TABLE = `
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`;

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

async function handler({ request }: { request: Request }) {
  // Throttle a known hostile IP from requesting a password reset. Exact-match
  // only; generic 403 that does not reveal why. Runs before any token issuing.
  if (isBlockedIp(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = (await request.json()) as { email?: string };
    const email = (body.email || "").trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    const db = sql();
    // db.unsafe() is a fragment factory — inlines DDL safely when interpolated
    await db`${db.unsafe(CREATE_RESET_TOKENS_TABLE)}`;

    const user = await db`SELECT id FROM users WHERE email = ${email}`;

    let token: string | undefined;
    if (user.length > 0) {
      token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
      await db`
        INSERT INTO password_reset_tokens (email, token, expires_at)
        VALUES (${email}, ${token}, ${expiresAt.toISOString()})
      `;

      if (process.env.RESEND_API_KEY) {
        // Email delivery configured — send the reset link (never throws).
        await sendPasswordResetEmail(email, token);
      }
    }

    // Always return success — never reveal whether the email is registered.
    return Response.json({
      success: true,
      // When email delivery isn't configured, hand the token back so the UI
      // can display the reset link directly.
      token: process.env.RESEND_API_KEY ? undefined : token,
      message: "If an account exists for that email, a password reset link has been sent.",
    });
  } catch (err) {
    console.error("[api/forgot-password] error:", err);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/forgot-password")({
  server: { handlers: { POST: handler } },
});
