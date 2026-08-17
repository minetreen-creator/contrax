import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_SOURCES = ["landing_guide", "milestone_grant"] as const;
type LeadSource = (typeof ALLOWED_SOURCES)[number];

async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json()) as { email?: unknown; source?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL_PATTERN.test(email)) {
      return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    const source: LeadSource = ALLOWED_SOURCES.includes(body.source as LeadSource)
      ? (body.source as LeadSource)
      : "landing_guide";

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

    if (source === "milestone_grant") {
      // Admin-visibility reconciliation: the admin metrics + CSV export read the
      // `waitlist` table — `leads` is NOT surfaced anywhere in admin. Milestone-
      // grant leads therefore go to `waitlist` (source='milestone_grant') so the
      // owner sees them in the admin waitlist count/recent list and the
      // waitlist.csv export, without touching the landing-page form (which keeps
      // writing to `leads`). waitlist.email is UNIQUE, so a repeat capture is a
      // no-op success (the grant is one-per-device; nothing is gained by a dup).
      await sql()`
        CREATE TABLE IF NOT EXISTS waitlist (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          source TEXT DEFAULT 'landing_page',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql()`
        INSERT INTO waitlist (email, source)
        VALUES (${email}, 'milestone_grant')
        ON CONFLICT (email) DO NOTHING
      `;
    } else {
      await sql()`
        INSERT INTO leads (email, source)
        VALUES (${email}, 'landing_guide')
      `;
    }
    return Response.json({ success: true });
  } catch (error) {
    console.error("[api/lead-capture] error:", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/lead-capture")({
  server: { handlers: { POST: handler } },
});
