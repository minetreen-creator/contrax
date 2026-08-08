import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { callAI } from "~/lib/ai";
import { fetchCopilotContext } from "~/lib/copilot";
import { getUserFromRequest } from "~/lib/api-auth";

const SYSTEM_PROMPT = `You are Contrax Copilot, a senior government contracting strategist with deep expertise in federal procurement, set-aside programs (8(a), SDVOSB, WOSB, HUBZone), and small business growth. You have full access to this business's profile, certifications, bid history, win/loss patterns, and knowledge base.
Your job: give clear, actionable, specific strategic advice. Cite the business's actual data — mention their NAICS codes, recent bids, win rates, and patterns by name. Be direct about competitive weaknesses. When you spot an opportunity (e.g. "Three of your active bids are 8(a) set-asides expiring in Q3 — prioritize the $250K DHS contract"), say so.
Never make up data. If you don't have enough information, say so and ask. Keep responses concise but substantive — 2-4 paragraphs unless the user asks for detail.`;

/** Saves a chat message, creating the table on first use. */
async function saveMessage(userEmail: string, role: string, content: string) {
  await sql()`CREATE TABLE IF NOT EXISTS copilot_messages (
    id SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql()`INSERT INTO copilot_messages (user_email, role, content) VALUES (${userEmail}, ${role}, ${content})`;
}

async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json().catch(() => null)) as { message?: unknown } | null;
    if (!body || typeof body.message !== "string" || body.message.trim().length === 0) {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    const message = body.message.trim();
    // Save the user's message first so the conversation is never lost.
    await saveMessage(user.email, "user", message);
    // Assemble context: system prompt + business context + last 20 messages + new message.
    const context = await fetchCopilotContext(user.email);
    const historyRows = await sql()`
      SELECT role, content FROM copilot_messages
      WHERE user_email = ${user.email}
      ORDER BY id DESC LIMIT 20`;
    const history = (historyRows as { role: string; content: string }[])
      .slice()
      .reverse()
      .map((m) => ({ role: m.role, content: m.content }));
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: `BUSINESS DATA CONTEXT (real data from this business's Contrax account — cite it by name):\n${context}` },
      ...history,
      { role: "user", content: message },
    ];
    let reply: string;
    try {
      reply = await callAI(messages, { max_tokens: 900, temperature: 0.4 });
    } catch (err) {
      return Response.json(
        { error: `AI request failed: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 },
      );
    }
    await saveMessage(user.email, "assistant", reply);
    return Response.json({ reply });
  } catch (err) {
    console.error("[api/copilot] error:", err);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/copilot")({
  server: { handlers: { POST: handler } },
});
