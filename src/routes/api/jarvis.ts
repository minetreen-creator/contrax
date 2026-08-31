/**
 * POST /api/jarvis — admin-only grounded executive assistant endpoint.
 *
 * Mirrors the admin API auth pattern (e.g. src/routes/api/admin/acquisition.ts):
 *   401 when unauthenticated, 403 when the caller is not an admin.
 *
 * Body: { "question": string }
 * Response: { answer, sources, grounded } — see src/lib/jarvis.
 *
 * READ-ONLY: all business data reads are SELECTs inside the readers; the only
 * non-SELECT on this path is the shared rate-limit upsert (checkRateLimit uses
 * the existing `rate_limits` infra — NOT a Jarvis business write). OpenAI keys /
 * DB credentials stay server-side (callAI reads OPENAI_API_KEY here, never the
 * browser).
 *
 * RATE LIMIT: 30 calls/hour per admin user (scope `jarvis`, keyed by user id).
 * Fail-open on DB error so a Neon blip can't lock the owner out.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { checkRateLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { askJarvis } from "~/lib/jarvis";

const RATE_LIMIT_PER_HOUR = 30;

async function handler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

    // Per-admin-user rate limit (30 calls/hour). Fail-open by design.
    const rl = await checkRateLimit({
      scope: "jarvis",
      key: `user:${user.id}`,
      limit: RATE_LIMIT_PER_HOUR,
      windowSec: 3600,
    });
    if (!rl.allowed) return rateLimitedResponse(rl);

    const body = (await request.json().catch(() => null)) as { question?: unknown } | null;
    const question = typeof body?.question === "string" ? body.question : "";
    if (!question.trim()) {
      return Response.json({ error: "Missing question" }, { status: 400 });
    }

    const result = await askJarvis(question);
    return Response.json(result);
  } catch (err) {
    console.error("[api/jarvis] error:", err);
    return Response.json({ error: "Jarvis is unavailable right now." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/jarvis")({
  server: { handlers: { POST: handler } },
});
