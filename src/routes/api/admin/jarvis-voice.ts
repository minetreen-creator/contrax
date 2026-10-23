import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { jarvisSpeech } from "~/lib/jarvis.server";

/**
 * POST /api/admin/jarvis-voice — Jarvis's spoken voice (OpenAI text-to-speech).
 * Admin only. Body: { text }. Returns audio/mpeg, or 503 so the page falls
 * back to the browser's voice.
 */
async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { text?: unknown };
  const audio = await jarvisSpeech(String(body.text ?? ""));
  if (!audio) return Response.json({ error: "Voice unavailable" }, { status: 503 });
  return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/admin/jarvis-voice")({
  server: { handlers: { POST: handler } },
});
