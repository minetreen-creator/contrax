/**
 * Storage for the founder live chat (see live-chat.ts): one row per message in
 * `live_chat_messages`, keyed by the visitor's `contrax_vid` cookie.
 */
import { sql } from "~/db";
import { unreadFromVisitor, VISITOR_REPLIES_PER_HOUR, type ChatMessage, type ChatSender } from "~/lib/live-chat";

let ready: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  ready ??= (async () => {
    await sql()`CREATE TABLE IF NOT EXISTS live_chat_messages (
      id SERIAL PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql()`CREATE INDEX IF NOT EXISTS live_chat_visitor_idx ON live_chat_messages (visitor_id, id)`;
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

const toMessage = (r: { id: number; sender: string; body: string; created_at: Date | string }): ChatMessage => ({
  id: Number(r.id),
  sender: r.sender === "owner" ? "owner" : "visitor",
  body: String(r.body),
  at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
});

/** The last 50 messages with one visitor, oldest first. */
export async function chatThread(visitorId: string): Promise<ChatMessage[]> {
  await ensureTable();
  const rows = (await sql()`
    SELECT * FROM (
      SELECT id, sender, body, created_at FROM live_chat_messages
      WHERE visitor_id = ${visitorId} ORDER BY id DESC LIMIT 50
    ) t ORDER BY id ASC
  `) as { id: number; sender: string; body: string; created_at: Date | string }[];
  return rows.map(toMessage);
}

export async function addChatMessage(visitorId: string, sender: ChatSender, body: string): Promise<ChatMessage> {
  await ensureTable();
  const [row] = (await sql()`
    INSERT INTO live_chat_messages (visitor_id, sender, body) VALUES (${visitorId}, ${sender}, ${body})
    RETURNING id, sender, body, created_at
  `) as { id: number; sender: string; body: string; created_at: Date | string }[];
  return toMessage(row);
}

/** Replies this visitor sent in the last hour. */
export async function recentVisitorReplies(visitorId: string): Promise<number> {
  await ensureTable();
  const [r] = (await sql()`
    SELECT COUNT(*)::int AS n FROM live_chat_messages
    WHERE visitor_id = ${visitorId} AND sender = 'visitor' AND created_at > NOW() - INTERVAL '1 hour'
  `) as { n: number }[];
  return Number(r?.n ?? 0);
}

export function overReplyLimit(count: number): boolean {
  return count >= VISITOR_REPLIES_PER_HOUR;
}

export interface ChatThreadSummary {
  visitorId: string;
  lastAt: string;
  lastBody: string;
  lastSender: ChatSender;
  unread: number;
}

/** Conversations with a message in the last 24 hours, newest first. */
export async function recentThreads(): Promise<ChatThreadSummary[]> {
  await ensureTable();
  const rows = (await sql()`
    SELECT visitor_id, id, sender, body, created_at FROM live_chat_messages
    WHERE visitor_id IN (
      SELECT DISTINCT visitor_id FROM live_chat_messages WHERE created_at > NOW() - INTERVAL '24 hours'
    )
    ORDER BY visitor_id, id
  `) as { visitor_id: string; id: number; sender: string; body: string; created_at: Date | string }[];
  const byVisitor = new Map<string, ChatMessage[]>();
  for (const r of rows) {
    const list = byVisitor.get(r.visitor_id) ?? [];
    list.push(toMessage(r));
    byVisitor.set(r.visitor_id, list);
  }
  return [...byVisitor.entries()]
    .map(([visitorId, msgs]) => {
      const last = msgs[msgs.length - 1];
      return { visitorId, lastAt: last.at, lastBody: last.body.slice(0, 120), lastSender: last.sender, unread: unreadFromVisitor(msgs) };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
