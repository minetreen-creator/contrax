import { createFileRoute } from "@tanstack/react-router";
import { callAI } from "~/lib/ai";
import { MAX_MESSAGES, MAX_MESSAGE_CHARS, SYSTEM_PROMPT, type ChatHistoryMessage } from "~/lib/chat";

/**
 * Chat widget support endpoint — replaces the askContrax createServerFn RPC
 * (client RPCs silently fail on production Vercel). No auth required: the chat
 * widget is a public support surface and the previous server fn did not gate
 * it either.
 */
async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json().catch(() => null)) as unknown;
    if (!Array.isArray(body)) {
      return Response.json({ error: "Invalid chat request" }, { status: 400 });
    }
    const messages: ChatHistoryMessage[] = [];
    for (const raw of body.slice(-MAX_MESSAGES)) {
      const m = (raw ?? {}) as Record<string, unknown>;
      const content = String(m.content ?? "").trim().slice(0, MAX_MESSAGE_CHARS);
      if (!content) continue;
      const role: ChatHistoryMessage["role"] = m.role === "assistant" ? "assistant" : "user";
      messages.push({ role, content });
    }
    if (messages.length === 0) {
      return Response.json({ error: "No messages to send" }, { status: 400 });
    }
    const reply = await callAI(
      [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      { max_tokens: 700, temperature: 0.5 },
    );
    return Response.json({ reply });
  } catch (err) {
    console.error("[api/chat] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "AI request failed" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/chat")({
  server: { handlers: { POST: handler } },
});
