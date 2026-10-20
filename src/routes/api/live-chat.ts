import { createFileRoute } from "@tanstack/react-router";
import { visitorIdFromCookieHeader } from "~/lib/free-score-limit.server";
import { cleanBody, visitorMayReply } from "~/lib/live-chat";
import { addChatMessage, chatThread, overReplyLimit, recentVisitorReplies } from "~/lib/live-chat.server";

/**
 * GET/POST /api/live-chat — the visitor side of the founder live chat. The
 * visitor is the browser's own `contrax_vid` cookie, never a parameter, so a
 * page can only read and answer its own thread. POST is a reply and only
 * works inside a thread the owner started (see live-chat.ts).
 */
async function GET({ request }: { request: Request }) {
  const vid = visitorIdFromCookieHeader(request.headers.get("cookie"));
  if (!vid) return Response.json({ messages: [] });
  try {
    return Response.json({ messages: await chatThread(vid) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/live-chat] read failed:", err);
    return Response.json({ messages: [] });
  }
}

async function POST({ request }: { request: Request }) {
  const vid = visitorIdFromCookieHeader(request.headers.get("cookie"));
  if (!vid) return Response.json({ error: "No conversation" }, { status: 400 });
  const body = cleanBody(((await request.json().catch(() => ({}))) as { body?: unknown }).body);
  if (!body) return Response.json({ error: "Message is empty or too long" }, { status: 400 });
  try {
    if (!visitorMayReply(await chatThread(vid))) return Response.json({ error: "No conversation" }, { status: 403 });
    if (overReplyLimit(await recentVisitorReplies(vid))) return Response.json({ error: "Too many messages, try again later" }, { status: 429 });
    return Response.json({ message: await addChatMessage(vid, "visitor", body) });
  } catch (err) {
    console.error("[api/live-chat] reply failed:", err);
    return Response.json({ error: "Could not send" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/live-chat")({
  server: { handlers: { GET, POST } },
});
