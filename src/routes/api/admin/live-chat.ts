import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { cleanBody } from "~/lib/live-chat";
import { addChatMessage, chatThread, recentThreads } from "~/lib/live-chat.server";

/**
 * GET/POST /api/admin/live-chat — the owner side of the founder live chat
 * (admin only). GET ?vid= returns one thread; GET alone lists the last 24
 * hours' conversations with unread replies. POST {vid, body} says something.
 */
const VID_RE = /^[A-Za-z0-9-]{8,64}$/;

async function admin(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  return null;
}

async function GET({ request }: { request: Request }) {
  const denied = await admin(request);
  if (denied) return denied;
  const vid = new URL(request.url).searchParams.get("vid") ?? "";
  try {
    if (vid) {
      if (!VID_RE.test(vid)) return Response.json({ error: "Bad visitor" }, { status: 400 });
      return Response.json({ messages: await chatThread(vid) });
    }
    return Response.json({ threads: await recentThreads() });
  } catch (err) {
    console.error("[api/admin/live-chat] read failed:", err);
    return Response.json({ error: "Could not load chats" }, { status: 500 });
  }
}

async function POST({ request }: { request: Request }) {
  const denied = await admin(request);
  if (denied) return denied;
  const data = (await request.json().catch(() => ({}))) as { vid?: unknown; body?: unknown };
  const vid = typeof data.vid === "string" ? data.vid : "";
  const body = cleanBody(data.body);
  if (!VID_RE.test(vid)) return Response.json({ error: "Bad visitor" }, { status: 400 });
  if (!body) return Response.json({ error: "Message is empty or too long" }, { status: 400 });
  try {
    return Response.json({ message: await addChatMessage(vid, "owner", body) });
  } catch (err) {
    console.error("[api/admin/live-chat] send failed:", err);
    return Response.json({ error: "Could not send" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/live-chat")({
  server: { handlers: { GET, POST } },
});
