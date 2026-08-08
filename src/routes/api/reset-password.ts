import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { hashPassword } from "~/lib/password";

const RESET_SECRET = "contrax-reset-2026";

async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json()) as {
      email?: string;
      newPassword?: string;
      secret?: string;
    };

    if (body.secret !== RESET_SECRET) {
      return Response.json({ error: "Invalid reset secret." }, { status: 401 });
    }

    const email = (body.email || "").trim().toLowerCase();
    const newPassword = body.newPassword || "";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return Response.json({ error: "Password must be at least 6 characters." }, { status: 400 });
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

export const Route = createFileRoute("/api/reset-password")({
  server: { handlers: { POST: handler } },
});
