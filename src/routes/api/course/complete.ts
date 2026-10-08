import { createFileRoute } from "@tanstack/react-router";
import { validateCompletion } from "~/lib/course-construction";
import { completionCourse } from "~/lib/course-catalog";
import { recordCompletion } from "~/lib/course.server";
import { checkRateLimit } from "~/lib/rate-limit";
import { getClientIp } from "~/lib/request-ip";

/**
 * POST /api/course/complete { name, email, state, visitorId? } → { token }
 * Records a course completion and returns the certificate token (owner 2026-10-07).
 */
async function handler({ request }: { request: Request }) {
  try {
    const parsed: unknown = await request.json().catch(() => ({}));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "Invalid completion request." }, { status: 400 });
    const body = parsed as Record<string, unknown>;
    const course = completionCourse(body);
    if (!course.ok) return Response.json({ error: course.error }, { status: 400 });
    const v = validateCompletion(body);
    if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
    const limit = await checkRateLimit({ scope: "course_complete", key: `ip:${getClientIp(request) ?? "unknown"}`, limit: 10, windowSec: 3600 });
    if (!limit.allowed) return Response.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
    const vid = typeof body.visitorId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(body.visitorId) ? body.visitorId : null;
    const token = await recordCompletion(course.id, v.value, vid);
    return Response.json({ token });
  } catch (err) {
    console.error("[api/course/complete] error:", err);
    return Response.json({ error: "Couldn't save your completion. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/course/complete")({ server: { handlers: { POST: handler } } });
