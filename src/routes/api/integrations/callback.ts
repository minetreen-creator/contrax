import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";

/**
 * OAuth callback handler for Agency-tier integrations.
 * Receives the authorization code from the provider, stores the connection,
 * and redirects back to the workspace page.
 *
 * Env vars required per provider (placeholder logic until configured):
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 *   OUTLOOK_CLIENT_ID / OUTLOOK_CLIENT_SECRET
 *   SLACK_CLIENT_ID / SLACK_CLIENT_SECRET
 *   TEAMS_CLIENT_ID / TEAMS_CLIENT_SECRET
 *   GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET
 *   ONEDRIVE_CLIENT_ID / ONEDRIVE_CLIENT_SECRET
 */

const validProviders = [
  "google_calendar", "outlook_calendar", "slack",
  "teams", "google_drive", "onedrive",
];

async function handleOAuthCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const provider = url.searchParams.get("provider");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/workspace?error=oauth_denied" },
    });
  }

  if (!code || !state || !provider) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/workspace?error=invalid_callback" },
    });
  }

  if (!validProviders.includes(provider)) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/workspace?error=unknown_provider" },
    });
  }

  try {
    let userId: number;
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64").toString());
      userId = decoded.userId;
      if (!userId || typeof userId !== "number") throw new Error("Invalid state payload");
    } catch {
      return new Response(null, {
        status: 302,
        headers: { Location: "/workspace?error=invalid_state" },
      });
    }

    await sql()`CREATE TABLE IF NOT EXISTS integrations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      provider TEXT NOT NULL CHECK (provider IN ('google_calendar','outlook_calendar','slack','teams','google_drive','onedrive')),
      access_token TEXT,
      refresh_token TEXT,
      status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('active','disconnected')),
      connected_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, provider)
    )`;

    await sql()`INSERT INTO integrations (user_id, provider, access_token, status, connected_at)
      VALUES (${userId}, ${provider}, ${"placeholder_" + code.substring(0, 20)}, 'active', NOW())
      ON CONFLICT (user_id, provider) DO UPDATE SET
        access_token = ${"placeholder_" + code.substring(0, 20)},
        refresh_token = NULL,
        status = 'active',
        connected_at = NOW(),
        updated_at = NOW()`;

    return new Response(null, {
      status: 302,
      headers: { Location: "/workspace?integration=connected" },
    });
  } catch (err) {
    console.error("OAuth callback error:", err);
    return new Response(null, {
      status: 302,
      headers: { Location: "/workspace?error=callback_failed" },
    });
  }
}

export const Route = createFileRoute("/api/integrations/callback")({
  // Use the server-handlers pattern (not `loader`) so this OAuth handler —
  // which talks to the database and uses Node's Buffer — stays server-only.
  // A `loader` is retained in the client bundle, which dragged
  // `~/db` / @neondatabase/serverless (and Buffer shims) into the client
  // entry chunk. See the sibling route `src/routes/api/integrations.ts`.
  server: {
    handlers: {
      GET: ({ request }) => handleOAuthCallback(request),
    },
  },
});
