import { createFileRoute } from "@tanstack/react-router";
import { COURSE_ID, validateCompletion } from "~/lib/course-construction";
import { recordCompletion } from "~/lib/course.server";
import { checkRateLimit } from "~/lib/rate-limit";
import { getClientIp } from "~/lib/request-ip";

/**
 * POST /api/course/complete { name, email, state, visitorId? } → { token }
 * Records a course completion and returns the certificate token (owner 2026-10-07).
 */
async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const v = validateCompletion(body);
    if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
    const limit = await checkRateLimit({ scope: "course_complete", key: `ip:${getClientIp(request) ?? "unknown"}`, limit: 10, windowSec: 3600 });
    if (!limit.allowed) return Response.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
    const vid = typeof body.visitorId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(body.visitorId) ? body.visitorId : null;
    const token = await recordCompletion(COURSE_ID, v.value, vid);
    return Response.json({ token });
  } catch (err) {
    console.error("[api/course/complete] error:", err);
    return Response.json({ error: "Couldn't save your completion. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/course/complete")({ server: { handlers: { POST: handler } } });
