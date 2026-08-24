import { createFileRoute } from "@tanstack/react-router";
import { setCookie } from "@tanstack/react-start/server";
import { sql } from "~/db";
import { SESSION_COOKIE } from "~/lib/auth";
import { verifyPassword } from "~/lib/password";
import { isBlockedIp } from "~/lib/request-ip";

const SESSION_TTL_DAYS = 30;

async function handler({ request }: { request: Request }) {
  // Throttle a known hostile IP from logging in. Exact-match only; generic 403
  // that does not reveal why. Runs before parsing the body / any DB write.
  if (isBlockedIp(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
    };

    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";

    // Validation
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    if (!password) {
      return Response.json({ error: "Password is required." }, { status: 400 });
    }

    // Look up user
    const rows = await sql()`
      SELECT id, email, password_hash, created_at
      FROM users
      WHERE email = ${email}
    `;

    if (rows.length === 0) {
      return Response.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const user = rows[0] as {
      id: number;
      email: string;
      password_hash: string;
      created_at: Date;
    };

    // Verify password
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return Response.json({ error: "Invalid email or password." }, { status: 401 });
    }

    // Create session
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await sql()`
      INSERT INTO sessions (user_id, token, expires_at)
      VALUES (${user.id}, ${token}, ${expiresAt.toISOString()})
    `;

    setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    });

    return Response.json({
      success: true,
      user: { id: user.id, email: user.email, created_at: String(user.created_at) },
    });
  } catch (err) {
    console.error("[api/login] error:", err);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/login")({
  server: { handlers: { POST: handler } },
});
