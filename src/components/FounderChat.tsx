import { useEffect, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Send, X } from "lucide-react";
import { trackEvent } from "~/lib/track";
import { chatHiddenOn, MAX_CHAT_BODY, VISITOR_POLL_MS, type ChatMessage } from "~/lib/live-chat";

/**
 * Founder live chat, visitor side (owner 2026-10-20). Invisible until the
 * owner says hi from Mission control; then a small card opens bottom-left
 * (the AI assistant bubble is bottom-right) and the visitor can reply. Checks
 * for messages every 15 seconds while the tab is visible.
 */
export function FounderChat() {
  const { pathname } = useLocation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [open, setOpen] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const lastOwnerId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hidden = chatHiddenOn(pathname);

  useEffect(() => {
    if (hidden) return;
    let stop = false;
    async function poll() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/live-chat", { cache: "no-store" });
        const d = (await res.json()) as { messages?: ChatMessage[] };
        if (stop || !d.messages) return;
        setMessages(d.messages);
        const newest = [...d.messages].reverse().find((m) => m.sender === "owner");
        if (newest && newest.id > lastOwnerId.current) {
          if (lastOwnerId.current === 0) trackEvent("live_chat_shown");
          lastOwnerId.current = newest.id;
          setOpen(true);
        }
      } catch {}
    }
    const first = setTimeout(poll, 2000);
    const t = setInterval(poll, VISITOR_POLL_MS);
    return () => {
      stop = true;
      clearTimeout(first);
      clearInterval(t);
    };
  }, [hidden]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  if (hidden || !messages.some((m) => m.sender === "owner")) return null;

  const send = async () => {
    const body = input.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/live-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const d = (await res.json()) as { message?: ChatMessage; error?: string };
      if (!res.ok || !d.message) throw new Error(d.error || "Could not send");
      setMessages((prev) => [...prev, d.message!]);
      setInput("");
      trackEvent("live_chat_reply");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send");
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-50 rounded-full bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg sm:bottom-5 sm:left-5"
      >
        💬 Message from Nathaniel
      </button>
    );
  }

  return (
    <section
      aria-label="Message from the founder of Contrax"
      className="animate-chat-slide-up fixed bottom-4 left-4 z-50 flex max-h-[min(440px,calc(100dvh-6rem))] w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15 sm:bottom-5 sm:left-5"
    >
      <header className="flex items-center justify-between gap-2 bg-slate-900 px-3.5 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">Nathaniel · Founder of Contrax</p>
          <p className="text-[11px] text-emerald-300">● A real person, here now</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Minimize"
          className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </header>
      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto bg-slate-50 px-3.5 py-3">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender === "visitor" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                m.sender === "visitor"
                  ? "rounded-br-md bg-amber-500 text-white"
                  : "rounded-bl-md bg-white text-slate-800 ring-1 ring-slate-200"
              }`}
            >
              {m.body}
            </div>
          </div>
        ))}
      </div>
      {error ? <p className="bg-white px-3.5 pt-2 text-xs text-rose-600">{error}</p> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-2.5"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Write a reply…"
          maxLength={MAX_CHAT_BODY}
          aria-label="Your reply"
          className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          aria-label="Send reply"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white hover:bg-amber-400 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </section>
  );
}
