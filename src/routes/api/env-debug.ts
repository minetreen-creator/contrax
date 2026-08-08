import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/env-debug — temporary diagnostic endpoint.
 * Returns boolean presence + length of key env vars (no values exposed).
 * Remove after STRIPE_SECRET_KEY is confirmed working.
 */
async function handler(): Promise<Response> {
  const env = process.env as Record<string, string | undefined>;
  return Response.json({
    STRIPE_SECRET_KEY_present: !!env.STRIPE_SECRET_KEY,
    STRIPE_SECRET_KEY_length: (env.STRIPE_SECRET_KEY ?? "").length,
    STRIPE_WEBHOOK_SECRET_present: !!env.STRIPE_WEBHOOK_SECRET,
    DATABASE_URL_present: !!env.DATABASE_URL,
    stripe_related_keys: Object.keys(env).filter(k =>
      k.toLowerCase().includes("stripe"),
    ),
  });
}

export const Route = createFileRoute("/api/env-debug")({
  server: { handlers: { GET: handler } },
});
