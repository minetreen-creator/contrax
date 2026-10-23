import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { askJarvis, serverStats } from "~/lib/jarvis.server";

/**
 * POST /api/admin/jarvis — Mission Control's voice assistant (src/lib/jarvis.ts,
 * brain in src/lib/jarvis.server.ts). Admin only. Body: { question, snapshot,
 * history }. Returns { say, action, visual? }.
 */
async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: "Jarvis needs OPENAI_API_KEY" }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { question?: unknown; snapshot?: unknown; history?: unknown };
  const question = String(body.question ?? "").trim();
  if (!question) return Response.json({ error: "Ask me something" }, { status: 400 });
  return Response.json(await askJarvis({ question, snapshot: body.snapshot, history: body.history }));
}

/** GET: the counts for the "wake up" boot sequence (no AI call). */
async function statsHandler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  return Response.json(await serverStats());
}

export const Route = createFileRoute("/api/admin/jarvis")({
  server: { handlers: { POST: handler, GET: statsHandler } },
});
