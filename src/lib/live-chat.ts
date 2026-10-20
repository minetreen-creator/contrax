/**
 * Founder live chat (owner 2026-10-20): from Mission control the owner says hi
 * to a visitor who is on the site right now; the visitor sees a small pop-up
 * and can reply. Only the owner starts a conversation — a visitor can reply
 * to a thread, never open one. Messages poll; there is no socket.
 *
 * PURE and client-safe. Storage and rate limits live in live-chat.server.ts.
 */

export type ChatSender = "owner" | "visitor";

export interface ChatMessage {
  id: number;
  sender: ChatSender;
  body: string;
  at: string;
}

/** Longest message either side can send. */
export const MAX_CHAT_BODY = 1000;
/** Most replies one visitor can send in an hour. */
export const VISITOR_REPLIES_PER_HOUR = 30;
/** How often an open page checks for a new message. */
export const VISITOR_POLL_MS = 15_000;
/** How often an open chat in Mission control checks for replies. */
export const OWNER_POLL_MS = 5_000;

/** Trimmed text, or null when empty or too long. */
export function cleanBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const body = raw.replace(/\r\n/g, "\n").trim();
  if (!body || body.length > MAX_CHAT_BODY) return null;
  return body;
}

/** A visitor may reply only inside a thread the owner started. */
export function visitorMayReply(thread: readonly Pick<ChatMessage, "sender">[]): boolean {
  return thread.some((m) => m.sender === "owner");
}

/** Visitor replies newer than the owner's last message (the unread count in Mission control). */
export function unreadFromVisitor(thread: readonly Pick<ChatMessage, "sender" | "at">[]): number {
  let lastOwner = -1;
  thread.forEach((m, i) => {
    if (m.sender === "owner") lastOwner = i;
  });
  return thread.slice(lastOwner + 1).filter((m) => m.sender === "visitor").length;
}

/** Paths where the visitor pop-up never shows. */
export function chatHiddenOn(pathname: string): boolean {
  return pathname.startsWith("/admin") || pathname.startsWith("/post-checkout");
}
