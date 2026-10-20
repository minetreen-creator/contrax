import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { cleanBody, OWNER_POLL_MS, type ChatMessage } from "~/lib/live-chat";
import { Search, UserPlus, Timer, CreditCard, PartyPopper, Radio, Flame, Map as MapIcon, Users, DollarSign, MessageCircle, Send, X } from "lucide-react";
import { getCurrentUser } from "~/lib/auth";
import { TRIAL_DAYS } from "~/lib/trial";
import { AdminHeader, AdminTabs, MrrScoreboard, SectionError, SectionLoading } from "~/components/AdminShared";
import {
  agoLabel,
  dotOffset,
  isRecentSearch,
  moneySteps,
  trialsEndingWithin,
  mapTone,
  timeLeftLabel,
  trialFractionLeft,
  type FeedItem,
  type FeedKind,
  type MapTone,
  type MoneyStats,
  type OnlineVisitor,
  type StateSearchStat,
  type TrialCard,
  type TrialHeat,
} from "~/lib/live-console";

/**
 * /admin/live — the owner console's live activity feed and trial countdown
 * board (owner 2026-10-19: "do 2,3"). Data: /api/admin/live-console, polled
 * every 15 seconds. New feed rows slide in; money rows glow.
 */

interface LiveData {
  generatedAt: string;
  map: StateSearchStat[];
  onlineCount: number;
  scannersHidden?: number;
  online: OnlineVisitor[];
  feed: FeedItem[];
  trials: TrialCard[];
  money?: MoneyStats | null;
}

const POLL_MS = 15_000;

const KIND_STYLE: Record<FeedKind, { icon: typeof Search; color: string; label: string }> = {
  search: { icon: Search, color: "#38bdf8", label: "Search" },
  signup: { icon: UserPlus, color: "#a78bfa", label: "Signup" },
  trial: { icon: Timer, color: "#34d399", label: "Trial" },
  checkout: { icon: CreditCard, color: "#fbbf24", label: "Checkout" },
  purchase: { icon: PartyPopper, color: "#f472b6", label: "Purchase" },
};

const HEAT_STYLE: Record<TrialHeat, { label: string; color: string }> = {
  hot: { label: "🔥 Hot", color: "#f97316" },
  warm: { label: "🌤 Warming", color: "#facc15" },
  cold: { label: "🧊 Cold", color: "#60a5fa" },
};

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function CountdownRing({ fraction, color }: { fraction: number; color: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true" className="live-ring">
      <circle cx="42" cy="42" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
      <circle
        cx="42"
        cy="42"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - fraction)}
        transform="rotate(-90 42 42)"
        style={{ transition: "stroke-dashoffset 1s linear", filter: `drop-shadow(0 0 6px ${color})` }}
      />
    </svg>
  );
}

function FeedRow({ item, now, fresh }: { item: FeedItem; now: number; fresh: boolean }) {
  const s = KIND_STYLE[item.kind];
  const Icon = s.icon;
  const zero = item.kind === "search" && item.detail === "0 matches";
  return (
    <li className={`live-row ${fresh ? "is-fresh" : ""} ${item.money ? "is-money" : ""}`} style={{ ["--kind" as string]: s.color }}>
      <span className="live-icon relative">
        <Icon size={16} aria-hidden="true" />
        {fresh && item.money ? <Confetti /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">
          {item.place ? <span className="text-slate-300">{item.place} · </span> : null}
          {item.title}
        </p>
        {item.detail ? (
          <p className={`text-xs ${zero ? "font-semibold text-rose-400" : "text-slate-400"}`}>{item.detail}</p>
        ) : null}
      </div>
      <span className="shrink-0 text-xs text-slate-500" title={new Date(item.at).toLocaleString()}>{agoLabel(item.at, now)}</span>
    </li>
  );
}

const CONFETTI = ["#fbbf24", "#f472b6", "#34d399", "#38bdf8", "#a78bfa", "#fb7185", "#facc15", "#22d3ee"];

/** A one-shot confetti burst for a money row that just arrived. */
function Confetti() {
  return (
    <span className="live-confetti" aria-hidden="true">
      {CONFETTI.concat(CONFETTI).map((c, i) => (
        <i key={i} style={{ background: c, ["--a" as string]: `${(i * 360) / 16}deg`, ["--d" as string]: `${28 + (i % 4) * 10}px` }} />
      ))}
    </span>
  );
}

interface TickerEntry {
  key: string;
  color: string;
  icon: typeof Search;
  text: string;
  sub: string | null;
  alert: boolean;
}

/** Feed items plus each trial's countdown, as one scrolling band. */
function tickerEntries(data: LiveData, now: number): TickerEntry[] {
  const fromFeed = data.feed.slice(0, 20).map((f) => {
    const s = KIND_STYLE[f.kind];
    return {
      key: f.id,
      color: s.color,
      icon: s.icon,
      text: `${f.place ? `${f.place} · ` : ""}${f.title}`,
      sub: [f.detail, agoLabel(f.at, now)].filter(Boolean).join(" · "),
      alert: f.kind === "search" && f.detail === "0 matches",
    };
  });
  const fromTrials = data.trials.map((t) => ({
    key: `trial-${t.userId}`,
    color: HEAT_STYLE[t.heat].color,
    icon: Timer,
    text: `${t.email.split("@")[0]} trial`,
    sub: `${timeLeftLabel(new Date(t.endsAt).getTime() - now)} · ${HEAT_STYLE[t.heat].label}`,
    alert: false,
  }));
  return [...fromFeed, ...fromTrials];
}

function Ticker({ entries }: { entries: TickerEntry[] }) {
  if (!entries.length) return null;
  // The band holds the list twice and slides left by one copy, so it loops
  // seamlessly. A short list repeats within each copy so the band is always
  // wider than the screen. Speed: about 4 seconds per entry.
  const repeat = Math.ceil(8 / entries.length);
  const base = Array.from({ length: repeat }, (_, r) => entries.map((e) => ({ ...e, key: `${r}-${e.key}` }))).flat();
  const seconds = Math.max(20, base.length * 4);
  const row = (copy: number) =>
    base.map((e) => {
      const Icon = e.icon;
      return (
        <span key={`${copy}-${e.key}`} className="live-tick" style={{ ["--kind" as string]: e.color }} aria-hidden={copy === 1 ? true : undefined}>
          <Icon size={14} aria-hidden="true" />
          <span className="font-semibold text-white">{e.text}</span>
          {e.sub ? <span className={e.alert ? "font-semibold text-rose-400" : "text-slate-400"}>{e.sub}</span> : null}
        </span>
      );
    });
  return (
    <div className="live-ticker" role="marquee" aria-label="Live activity">
      <div className="live-ticker-track" style={{ animationDuration: `${seconds}s` }}>
        {row(0)}
        {row(1)}
      </div>
    </div>
  );
}

const TONE_COLOR: Record<MapTone, string> = {
  none: "#1e293b",
  found: "#10b981",
  mixed: "#f59e0b",
  empty: "#f43f5e",
};

interface UsMapData {
  viewBox: string;
  states: Record<string, string>;
  label: Record<string, [number, number]>;
}

/** State outlines from /us-states-albers.json (us-atlas, US Census shapes), fetched once. */
function useUsMap() {
  const [map, setMap] = useState<UsMapData | null>(null);
  useEffect(() => {
    let stop = false;
    fetch("/us-states-albers.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!stop && d) setMap(d as UsMapData); })
      .catch(() => {});
    return () => { stop = true; };
  }, []);
  return map;
}

/** A real US map; color = how each state's searches went, pulse = searched in the last 15 minutes. */
function SearchMap({ stats, visitors, now, onChat }: { stats: StateSearchStat[]; visitors: OnlineVisitor[]; now: number; onChat: (v: OnlineVisitor) => void }) {
  const us = useUsMap();
  const byState = new Map(stats.map((s) => [s.state, s]));
  return (
    <div>
      {us ? (
        <svg viewBox={us.viewBox} className="live-usmap" role="img" aria-label="Searches by state, last 48 hours">
          {Object.entries(us.states).map(([code, d]) => {
            const stat = byState.get(code);
            const tone = mapTone(stat);
            return (
              <path
                key={code}
                d={d}
                className={`live-state ${tone !== "none" ? "is-on" : ""} ${isRecentSearch(stat, now) ? "is-recent" : ""}`}
                style={{ ["--tone" as string]: TONE_COLOR[tone] }}
              >
                <title>
                  {stat
                    ? `${code}: ${stat.searches} search${stat.searches === 1 ? "" : "es"}, ${stat.zero} with 0 matches, last ${agoLabel(stat.lastAt, now)}`
                    : `${code}: no searches`}
                </title>
              </path>
            );
          })}
          {stats.map((s) => {
            const at = us.label[s.state];
            if (!at) return null;
            return (
              <g key={s.state} className="live-state-badge" transform={`translate(${at[0]} ${at[1]})`}>
                <circle r="15" />
                <text y="1" textAnchor="middle" dominantBaseline="middle">{s.searches}</text>
              </g>
            );
          })}
          {(() => {
            // Live visitors: a glowing dot per person on their home state,
            // spread in a small spiral when a state has several.
            const seen = new Map<string, number>();
            return visitors.map((v) => {
              const at = v.state ? us.label[v.state] : undefined;
              if (!v.state || !at) return null;
              const i = seen.get(v.state) ?? 0;
              seen.set(v.state, i + 1);
              const [dx, dy] = dotOffset(i);
              return (
                <g
                  key={v.visitorKey}
                  className="live-visitor-dot cursor-pointer"
                  transform={`translate(${at[0] + dx} ${at[1] - 22 + dy})`}
                  onClick={() => onChat(v)}
                >
                  <circle className="live-visitor-ring" r="7" />
                  <circle r="6" />
                  <title>{`${v.place ?? v.state} · on ${v.path} · ${agoLabel(v.at, now)} · click to say hi`}</title>
                </g>
              );
            });
          })()}
        </svg>
      ) : (
        <div className="live-usmap-loading">Loading map…</div>
      )}
      <p className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
        <span><i className="live-key" style={{ background: TONE_COLOR.found }} /> found bids</span>
        <span><i className="live-key" style={{ background: TONE_COLOR.mixed }} /> some empty</span>
        <span><i className="live-key" style={{ background: TONE_COLOR.empty }} /> all 0 matches</span>
        <span><i className="live-key" style={{ background: "#22d3ee", borderRadius: 999 }} /> on the site now</span>
        <span>Number = searches · pulsing = last 15 min · hover for details</span>
      </p>
    </div>
  );
}

function OnlineNow({ count, visitors, now, hidden, onChat }: { count: number; visitors: OnlineVisitor[]; now: number; hidden: number; onChat: (v: OnlineVisitor) => void }) {
  return (
    <div className="live-online">
      <div className="flex items-baseline gap-3">
        <span className="live-online-count">{count}</span>
        <span className="text-sm text-slate-300">on the site now<br /><span className="text-xs text-slate-500">seen in the last 5 minutes</span></span>
      </div>
      {hidden > 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          {hidden} email link scanner{hidden === 1 ? "" : "s"} hidden (same page, same minute, or a data-center town)
        </p>
      ) : null}
      {visitors.length ? (
        <ul className="mt-3 space-y-1.5">
          {visitors.map((v) => (
            <li key={v.visitorKey} className="flex items-center gap-2 text-xs">
              <span className="live-dot shrink-0" aria-hidden="true" />
              <span className="truncate text-slate-200">{v.place ?? "Unknown location"}</span>
              <span className="truncate font-mono text-sky-300">{v.path}</span>
              <span className="ml-auto shrink-0 text-slate-500">{agoLabel(v.at, now)}</span>
              <button type="button" onClick={() => onChat(v)} className="live-sayhi" title="Send this visitor a message">
                <MessageCircle size={12} aria-hidden="true" /> Say hi
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-slate-500">Nobody right now.</p>
      )}
    </div>
  );
}

interface ChatThread {
  visitorId: string;
  lastAt: string;
  lastBody: string;
  lastSender: "owner" | "visitor";
  unread: number;
}

/** Last 24 hours of founder chats; unread replies glow. */
function Conversations({ threads, online, onOpen }: { threads: ChatThread[]; online: OnlineVisitor[]; onOpen: (vid: string, label: string) => void }) {
  if (!threads.length) return null;
  const here = new Map(online.map((v) => [v.vid, v]));
  return (
    <div className="mt-4">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <MessageCircle size={12} aria-hidden="true" /> Your chats · 24 hours
      </p>
      <ul className="space-y-1.5">
        {threads.map((t) => {
          const v = here.get(t.visitorId);
          const label = v ? `${v.place ?? "Unknown location"} · ${v.path}` : "Visitor (left the site)";
          return (
            <li key={t.visitorId}>
              <button type="button" onClick={() => onOpen(t.visitorId, label)} className={`live-chat-thread ${t.unread ? "is-unread" : ""}`}>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-xs font-semibold text-white">
                    {v ? <span className="live-dot mr-1.5 inline-block align-middle" aria-hidden="true" /> : null}
                    {label}
                  </span>
                  <span className="block truncate text-[11px] text-slate-400">
                    {t.lastSender === "owner" ? "You: " : ""}
                    {t.lastBody}
                  </span>
                </span>
                {t.unread ? <span className="live-chat-badge">{t.unread}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const OPENER = "Hi, I'm Nathaniel, the founder of Contrax. Can I help you find bids for your business?";

/** One conversation: polls every 5 seconds while open. */
function ChatDrawer({ vid, label, onClose }: { vid: string; label: string; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch(`/api/admin/live-chat?vid=${encodeURIComponent(vid)}`)
        .then((r) => r.json())
        .then((d) => {
          if (stop || !d.messages) return;
          setMessages(d.messages);
          setInput((cur) => (cur || d.messages.length ? cur : OPENER));
        })
        .catch(() => {});
    load();
    const t = setInterval(load, OWNER_POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [vid]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async () => {
    const body = cleanBody(input);
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/admin/live-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vid, body }),
      });
      const d = await res.json();
      if (!res.ok || !d.message) throw new Error(d.error || "Could not send");
      setMessages((prev) => [...(prev ?? []), d.message]);
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send");
    } finally {
      setSending(false);
    }
  };

  return (
    <aside className="live-chat-drawer" aria-label="Chat with a visitor">
      <header className="flex items-start justify-between gap-2 border-b border-slate-700/60 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <MessageCircle size={15} aria-hidden="true" /> Live chat
          </p>
          <p className="truncate text-xs text-slate-400">{label}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close chat" className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white">
          <X size={18} />
        </button>
      </header>
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {messages === null ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-slate-400">
            Say hi. They'll see a small card from you on whatever page they're on (checked every 15 seconds), and can reply here.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.sender === "owner" ? "justify-end" : "justify-start"}`}>
              <div className={`live-chat-bubble ${m.sender === "owner" ? "is-owner" : "is-visitor"}`}>
                {m.body}
                <span className="mt-0.5 block text-[10px] opacity-60">
                  {new Date(m.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
      {error ? <p className="px-4 text-xs text-rose-300">{error}</p> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-end gap-2 border-t border-slate-700/60 px-3 py-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          maxLength={1000}
          placeholder="Write a message…"
          className="flex-1 resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          aria-label="Send"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </form>
    </aside>
  );
}

/**
 * Money panel (owner 2026-10-20): who pays now, which trials end in the next
 * 3 days, and the last 7 days from the plan pages to Stripe checkout.
 */
function MoneyPanel({ money, trials, now }: { money: MoneyStats; trials: TrialCard[]; now: number }) {
  const ending = trialsEndingWithin(trials, 3, now);
  const steps = moneySteps(money);
  return (
    <div className="live-money">
      <div className="flex flex-wrap items-stretch gap-3">
        <div className="live-money-paying">
          <span className="text-3xl font-extrabold text-amber-300">{money.payingNow}</span>
          <span className="text-[11px] uppercase tracking-wide text-slate-400">paying now</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Last 7 days · unique visitors</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {steps.map((st, i) => (
              <span key={st.label} className="flex items-center gap-2">
                {i > 0 ? <span aria-hidden="true" className="text-slate-500">→</span> : null}
                <span className="live-money-step">
                  <b className={st.value > 0 ? "text-white" : "text-slate-500"}>{st.value}</b> {st.label}
                </span>
              </span>
            ))}
          </div>
          {money.signinRequired || money.failed ? (
            <p className="mt-2 text-xs text-slate-400">
              {money.signinRequired ? `${money.signinRequired} clicked buy signed out and were sent to sign up. ` : ""}
              {money.failed ? <span className="text-rose-300">{money.failed} hit a checkout error.</span> : null}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Trials ending in the next 3 days</p>
        {ending.length ? (
          <ul className="mt-2 space-y-1">
            {ending.map((t) => (
              <li key={t.userId} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-white">{t.email}</span>
                <span className="shrink-0 font-semibold text-amber-300">{timeLeftLabel(new Date(t.endsAt).getTime() - now)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-slate-500">None.</p>
        )}
      </div>
    </div>
  );
}

function TrialTile({ t, now }: { t: TrialCard; now: number }) {
  const msLeft = new Date(t.endsAt).getTime() - now;
  const fraction = trialFractionLeft(msLeft, TRIAL_DAYS);
  const heat = HEAT_STYLE[t.heat];
  const ringColor = fraction < 0.25 ? "#f43f5e" : fraction < 0.6 ? "#fbbf24" : "#34d399";
  return (
    <article className="live-trial">
      <div className="relative shrink-0">
        <CountdownRing fraction={fraction} color={ringColor} />
        <span className="absolute inset-0 flex flex-col items-center justify-center text-center text-[11px] font-bold leading-tight text-white">
          <span>{timeLeftLabel(msLeft).replace(" left", "")}</span>
          {msLeft > 0 ? <span className="font-normal text-slate-400">left</span> : null}
        </span>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-white" title={t.email}>{t.email}</p>
          <span className="live-heat" style={{ color: heat.color, borderColor: heat.color }}>{heat.label}</span>
        </div>
        <p className="text-xs text-slate-400">
          Last seen {agoLabel(t.lastSeen, now)} · {t.visits7d} visit{t.visits7d === 1 ? "" : "s"} this week
        </p>
        <p className="text-xs text-slate-400">
          Trade: {t.trade ? <span className="text-slate-200">{t.trade}</span> : <span className="text-rose-400">not set</span>}
          {" · "}
          {t.stateCount} state{t.stateCount === 1 ? "" : "s"}
        </p>
        {t.searches.length ? (
          <ul className="flex flex-wrap gap-1 pt-1">
            {t.searches.map((s, i) => (
              <li key={i} className={`live-chip ${s.matched === 0 ? "is-zero" : ""}`}>
                {s.trade}{s.state ? ` · ${s.state}` : ""} → {s.matched}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">No saved searches yet</p>
        )}
      </div>
    </article>
  );
}

function LivePage() {
  const [data, setData] = useState<LiveData | null>(null);
  const [error, setError] = useState("");
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [chat, setChat] = useState<{ vid: string; label: string } | null>(null);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const openChat = (v: OnlineVisitor) => setChat({ vid: v.vid, label: `${v.place ?? "Unknown location"} · ${v.path}` });

  // Founder live chat: conversations with unread replies, on the same 15s beat.
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/admin/live-chat")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => !stop && d?.threads && setThreads(d.threads))
        .catch(() => {});
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  const now = useNow(1000);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const res = await fetch("/api/admin/live-console");
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Failed to load the live console");
        if (stop) return;
        const d = body as LiveData;
        // Rows not in the previous poll slide in; nothing glows on first load.
        if (seen.current) setFresh(new Set(d.feed.filter((f) => !seen.current!.has(f.id)).map((f) => f.id)));
        seen.current = new Set(d.feed.map((f) => f.id));
        setData(d);
        setError("");
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : "Failed to load the live console");
      }
    }
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  const counts = data
    ? {
        searches: data.feed.filter((f) => f.kind === "search").length,
        zero: data.feed.filter((f) => f.kind === "search" && f.detail === "0 matches").length,
        signups: data.feed.filter((f) => f.kind === "signup").length,
        money: data.feed.filter((f) => f.money).length,
      }
    : null;

  return (
    <div className="admin-console min-h-screen bg-slate-50">
      <AdminHeader scoreboard={<MrrScoreboard />} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <AdminTabs active="live" />
        <section className="live-shell">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
                <span className="live-dot" aria-hidden="true" /> Live · last 48 hours
              </p>
              <h1 className="text-2xl font-bold text-white">Mission control</h1>
            </div>
            {counts ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: "Searches", value: counts.searches, color: "#38bdf8" },
                  { label: "Zero results", value: counts.zero, color: "#fb7185" },
                  { label: "Signups", value: counts.signups, color: "#a78bfa" },
                  { label: "Money moments", value: counts.money, color: "#fbbf24" },
                ].map((s) => (
                  <div key={s.label} className="live-stat" style={{ ["--kind" as string]: s.color }}>
                    <span className="text-xl font-extrabold" style={{ color: s.color }}>{s.value}</span>
                    <span className="text-[11px] uppercase tracking-wide text-slate-400">{s.label}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {data ? <Ticker entries={tickerEntries(data, now)} /> : null}

          {data?.money ? (
            <div className="mt-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
                <DollarSign size={15} aria-hidden="true" /> Money
              </h2>
              <MoneyPanel money={data.money} trials={data.trials} now={now} />
            </div>
          ) : null}

          {data ? (
            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
                  <MapIcon size={15} aria-hidden="true" /> Live search map · 48 hours
                </h2>
                <SearchMap stats={data.map} visitors={data.online} now={now} onChat={openChat} />
              </div>
              <div>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
                  <Users size={15} aria-hidden="true" /> On the site now
                </h2>
                <OnlineNow count={data.onlineCount} visitors={data.online.slice(0, 12)} now={now} hidden={data.scannersHidden ?? 0} onChat={openChat} />
                <Conversations threads={threads} online={data.online} onOpen={(vid, label) => setChat({ vid, label })} />
              </div>
            </div>
          ) : null}

          {error ? <SectionError message={error} /> : !data ? <SectionLoading message="Tuning in…" /> : (
            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <div>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
                  <Radio size={15} aria-hidden="true" /> Activity feed
                </h2>
                {data.feed.length ? (
                  <ul className="live-feed">
                    {data.feed.map((f) => <FeedRow key={f.id} item={f} now={now} fresh={fresh.has(f.id)} />)}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-400">Quiet for the last 48 hours.</p>
                )}
              </div>
              <div>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
                  <Flame size={15} aria-hidden="true" /> Trials on the clock ({data.trials.length})
                </h2>
                {data.trials.length ? (
                  <div className="space-y-3">
                    {data.trials.map((t) => <TrialTile key={t.userId} t={t} now={now} />)}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No trials running right now.</p>
                )}
              </div>
            </div>
          )}

        </section>
      </main>
      {chat ? <ChatDrawer vid={chat.vid} label={chat.label} onClose={() => setChat(null)} /> : null}
    </div>
  );
}

export const Route = createFileRoute("/admin/live")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: LivePage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Live | Admin | Contrax" }] }),
});
