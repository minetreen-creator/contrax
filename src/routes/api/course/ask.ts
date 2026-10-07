import { createFileRoute } from "@tanstack/react-router";
import { callAI } from "~/lib/ai";
import { askSystemPrompt, ASK_FALLBACK, LESSONS } from "~/lib/course-construction";
import { checkRateLimit } from "~/lib/rate-limit";
import { getClientIp } from "~/lib/request-ip";

/**
 * POST /api/course/ask { lessonId, question } → { answer }
 * The course's AI study helper (owner 2026-10-07). Answers only from the course
 * text (askSystemPrompt); anything else gets the fixed "ask your SBA office" reply.
 * 20 questions per hour per network.
 */
async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json().catch(() => ({}))) as { lessonId?: unknown; question?: unknown };
    const question = String(body.question ?? "").trim();
    if (question.length < 3) return Response.json({ error: "Type a question first." }, { status: 400 });
    if (question.length > 400) return Response.json({ error: "Keep the question under 400 characters." }, { status: 400 });
    const lesson = LESSONS.find((l) => l.id === body.lessonId);

    const limit = await checkRateLimit({ scope: "course_ask", key: `ip:${getClientIp(request) ?? "unknown"}`, limit: 20, windowSec: 3600 });
    if (!limit.allowed) return Response.json({ error: "You've asked a lot of questions this hour. Please try again later." }, { status: 429 });

    const answer = await callAI(
      [
        { role: "system", content: askSystemPrompt() },
        { role: "user", content: lesson ? `(Student is on the lesson "${lesson.title}")\n${question}` : question },
      ],
      { max_tokens: 300, temperature: 0.2 },
    );
    return Response.json({ answer: answer.trim() || ASK_FALLBACK });
  } catch (err) {
    console.error("[api/course/ask] error:", err);
    return Response.json({ error: "The helper is unavailable right now. Please try again shortly." }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/course/ask")({ server: { handlers: { POST: handler } } });
