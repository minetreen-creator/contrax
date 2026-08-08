import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import type { ChatHistoryMessage } from "~/lib/chat";

const WELCOME: ChatHistoryMessage = {
  role: "assistant",
  content:
    "Hi! I'm the Contrax assistant. Ask me about bid matching, proposal drafting, win-probability scoring, certification deadlines, pricing, or how to get started.",
};

const ERROR_MESSAGE: ChatHistoryMessage = {
  role: "assistant",
  content:
    "Sorry — I couldn't reach the AI right now. Please try your question again in a moment.",
};

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatHistoryMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, open]);

  // Autofocus the input when the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const history = [...messages, { role: "user" as const, content: text }];
    setMessages(history);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(history),
      }).then((r) => r.json());
      if (!res.reply) throw new Error(res.error || "Chat request failed");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.reply },
      ]);
    } catch {
      setMessages((prev) => [...prev, ERROR_MESSAGE]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <section
          aria-label="Contrax AI chat support"
          className="animate-chat-slide-up flex h-[500px] max-h-[calc(100dvh-7rem)] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10"
        >
          {/* Header */}
          <header className="flex items-center justify-between gap-2 bg-slate-900 px-3.5 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500">
                <MessageCircle className="h-4 w-4 text-white" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">
                  Contrax Assistant
                </p>
                <p className="text-[11px] text-slate-400">AI chat support</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3.5 py-4"
          >
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-amber-500 px-3.5 py-2.5 text-sm text-white shadow-sm">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm ring-1 ring-slate-200">
                    {m.content}
                  </div>
                </div>
              )
            )}
            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                  Thinking…
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-slate-200 bg-white px-3 pt-2.5">
            <p className="text-[10px] text-slate-400">
              AI-powered · Your data is not used for training. <a href="/privacy#6-ai-data-handling" className="underline underline-offset-2 hover:text-slate-600">Learn more</a>
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-center gap-2 bg-white px-3 pb-2.5 pt-1"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about Contrax…"
              disabled={loading}
              maxLength={2000}
              aria-label="Your question"
              className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              aria-label="Send message"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white shadow-sm transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </form>
        </section>
      )}

      {/* Floating bubble */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close chat support" : "Open chat support"}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-white shadow-lg shadow-amber-500/30 transition-transform hover:scale-105 hover:bg-amber-400"
      >
        {open ? (
          <X className="h-6 w-6" />
        ) : (
          <MessageCircle className="h-6 w-6" />
        )}
      </button>
    </div>
  );
}
