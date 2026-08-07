import { createFileRoute } from "@tanstack/react-router";
import { setCookie } from "@tanstack/react-start/server";
import { sql } from "~/db";
import { SESSION_COOKIE } from "~/lib/auth";
import { hashPassword } from "~/lib/password";

const SESSION_TTL_DAYS = 30;

async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
      confirmPassword?: string;
      plan?: string;
    };

    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";
    const confirmPassword = body.confirmPassword || "";
    const plan = body.plan && ["starter", "professional", "agency"].includes(body.plan)
      ? body.plan
      : "starter";

    // Validation
    const errors: string[] = [];
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push("Please enter a valid email address.");
    }
    if (!password || password.length < 8) {
      errors.push("Password must be at least 8 characters.");
    }
    if (password !== confirmPassword) {
      errors.push("Passwords do not match.");
    }
    if (errors.length > 0) {
      return Response.json({ error: errors.join(" ") }, { status: 400 });
    }

    // Check for duplicate
    const existing = await sql()`SELECT id FROM users WHERE email = ${email}`;
    if (existing.length > 0) {
      return Response.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    // Create user
    const passwordHash = await hashPassword(password);
    const inserted = await sql()`
      INSERT INTO users (email, password_hash, plan_tier, trial_started_at)
      VALUES (${email}, ${passwordHash}, ${plan}, NOW())
      RETURNING id, email, created_at
    `;
    const user = inserted[0] as { id: number; email: string; created_at: Date };

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
    console.error("[api/signup] error:", err);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/signup")({
  server: { handlers: { POST: handler } },
});
