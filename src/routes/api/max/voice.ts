import { createFileRoute } from "@tanstack/react-router";
import { checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { maxSpeech } from "~/lib/max.server";

/** POST /api/max/voice — Max's spoken voice. Body: { text, lang? }. audio/mpeg, or 503 (the page falls back to the browser's voice). */
async function handler({ request }: { request: Request }) {
  const r = await checkIpLimit(request, "max_voice_hour", 40, 3600);
  if (!r.allowed) return rateLimitedResponse(r);
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; lang?: unknown };
  const { audio, status } = await maxSpeech(String(body.text ?? "").slice(0, 900), body.lang === "es" ? "es" : "en");
  // upstream: OpenAI's HTTP status only (401/403 = the key's project lacks audio access), to diagnose without logs.
  if (!audio) return Response.json({ error: "Voice unavailable", upstream: status }, { status: 503 });
  return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/max/voice")({ server: { handlers: { POST: handler } } });
