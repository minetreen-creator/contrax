import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";
export const Route = createFileRoute("/api/copilot-history")({ server: { handlers: { GET: async ({ request }) => { const user = await getUserFromRequest(request); if (!user) return Response.json([]); try { const rows = await sql()`SELECT role, content FROM copilot_messages WHERE user_email = ${user.email} ORDER BY id DESC LIMIT 50`; return Response.json((rows as any[]).reverse().map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }))); } catch { return Response.json([]); } } } } });
