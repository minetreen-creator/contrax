import { createFileRoute } from "@tanstack/react-router";
import { setCookie } from "@tanstack/react-start/server";
import { sql } from "~/db";
import { SESSION_COOKIE } from "~/lib/auth";
import { verifyPassword } from "~/lib/password";
import { isBlockedIp } from "~/lib/request-ip";
import {
  checkEmailLimit,
  checkIpLimit,
  rateLimitedResponse,
} from "~/lib/rate-limit";

const SESSION_TTL_DAYS = 30;
// Let an attacker burn quota on EVERY attempt (even failed), before any DB
// write or credential verification. Two independent caps: a per-IP window for
// broad credential-stuffing and a per-account window so one email cannot be
// hammered from many IPs. Both increment on each POST, so a failed-login
// scanner exhausts its allowance immediately.
const LOGIN_IP_LIMIT = 20; // attempts per IP per 15 min
const LOGIN_IP_WINDOW = 15 * 60;
const LOGIN_EMAIL_LIMIT = 10; // attempts per account per 15 min
const LOGIN_EMAIL_WINDOW = 15 * 60;

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

    // ── Rate limiting (before credential verification, so brute-force burns
    //    quota immediately). IP + account caps; fail-open on any limiter error.
    const ipLimit = await checkIpLimit(request, "login_ip", LOGIN_IP_LIMIT, LOGIN_IP_WINDOW);
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit);
    const acctLimit = await checkEmailLimit(email, "login_email", LOGIN_EMAIL_LIMIT, LOGIN_EMAIL_WINDOW);
    if (!acctLimit.allowed) return rateLimitedResponse(acctLimit);

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
