import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json()) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL_PATTERN.test(email)) {
      return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    // Keep this migration lazy so existing deployments do not need a separate
    // database migration before the landing-page form can accept a lead.
    await sql()`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        source TEXT DEFAULT 'landing_guide',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql()`
      INSERT INTO leads (email, source)
      VALUES (${email}, 'landing_guide')
    `;
    return Response.json({ success: true });
  } catch (error) {
    console.error("[api/lead-capture] error:", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/lead-capture")({
  server: { handlers: { POST: handler } },
});
