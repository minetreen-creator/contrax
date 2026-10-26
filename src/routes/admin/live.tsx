import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cleanBody, OWNER_POLL_MS, type ChatMessage } from "~/lib/live-chat";
import { afterWakeWord, bootReport, isWakePhrase, JARVIS_VISUALS, type JarvisAction, type JarvisServerStats, type JarvisSnapshot, type JarvisVisual, type SimMonth, type SimResult } from "~/lib/jarvis";
import { announcements, isRedAlert, HOT_SCORE, pageName, radarSpot, type Announcement, type AnnounceState, type LeadLevel } from "~/lib/hot-leads";
import { Search, UserPlus, Timer, CreditCard, PartyPopper, Radio, Flame, Map as MapIcon, Users, DollarSign, MessageCircle, Send, X, Volume2, VolumeX, Crosshair, ScanEye } from "lucide-react";
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
import type { TrackedVisitor, VisitorTrail } from "~/lib/scraper-watch";

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
  tracked?: TrackedVisitor[];
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
            // Live visitors: a glowing dot per person at their city when the
            // coordinates are known (owner 2026-10-21: San Jose sat in the
            // middle of California), else above their state's center; dots on
            // the same spot spread in a small spiral.
            const seen = new Map<string, number>();
            return visitors.map((v) => {
              const center = v.state ? us.label[v.state] : undefined;
              if (!v.state || (!v.point && !center)) return null;
              const [x, y] = v.point ?? [center![0], center![1] - 22];
              const spot = v.point ? `${Math.round(x / 8)},${Math.round(y / 8)}` : v.state;
              const i = seen.get(spot) ?? 0;
              seen.set(spot, i + 1);
              const [dx, dy] = dotOffset(i);
              return (
                <g
                  key={v.visitorKey}
                  className="live-visitor-dot cursor-pointer"
                  transform={`translate(${x + dx} ${y + dy})`}
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

function OnlineNow({ count, visitors, now, hidden, onChat, onTrack }: { count: number; visitors: OnlineVisitor[]; now: number; hidden: number; onChat: (v: OnlineVisitor) => void; onTrack: (v: OnlineVisitor) => void }) {
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
              <button type="button" onClick={() => onTrack(v)} className={`live-track${v.tracked ? " is-on" : ""}`} title="See what this visitor is doing and keep tabs on them">
                <ScanEye size={12} aria-hidden="true" /> {v.tracked ? "Tracked" : "Track"}
              </button>
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

/** Scraper tracker list (src/lib/scraper-watch.ts): pinned visitors, live or not. */
function TrackedList({ tracked, now, onOpen }: { tracked: TrackedVisitor[]; now: number; onOpen: (vid: string, label: string) => void }) {
  if (!tracked.length) return null;
  return (
    <div className="mt-4">
      <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400">
        <ScanEye size={13} aria-hidden="true" /> Tracked · {tracked.length}
      </p>
      <ul className="space-y-1.5">
        {tracked.map((t) => {
          const label = `${t.place ?? "Unknown location"}${t.country && t.country !== "US" ? ` (${t.country})` : ""}`;
          return (
            <li key={t.vid}>
              <button type="button" onClick={() => onOpen(t.vid, label)} className="live-tracked-row">
                <span className={`h-2 w-2 shrink-0 rounded-full ${t.online ? "bg-emerald-400" : "bg-slate-600"}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-left text-slate-200">
                  {label}
                  {t.note ? <span className="text-slate-500"> · {t.note}</span> : null}
                </span>
                {t.returned ? <span className="shrink-0 text-[10px] font-bold uppercase text-amber-300">came back</span> : null}
                <span className="shrink-0 text-slate-500">{t.online ? "on now" : agoLabel(t.lastSeen, now)}</span>
                <span className="shrink-0 text-slate-500">{t.views24h} views/24h</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One visitor's trail: what they hit, how fast, from where, and which bot signals fired. */
function TrackDrawer({ vid, label, onClose, onChanged }: { vid: string; label: string; onClose: () => void; onChanged: () => void }) {
  const [trail, setTrail] = useState<VisitorTrail | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const now = useNow(1000);

  const load = useCallback(() => {
    fetch(`/api/admin/track-visitor?vid=${encodeURIComponent(vid)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Could not load this visitor");
        setTrail(d as VisitorTrail);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load this visitor"));
  }, [vid]);
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const toggle = async () => {
    if (!trail || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/track-visitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vid, action: trail.tracked ? "untrack" : "track", note: note || (trail.likelyScraper ? "likely scraper" : "") }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not save");
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="live-chat-drawer" aria-label="Visitor trail">
      <header className="flex items-start justify-between gap-2 border-b border-slate-700/60 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <ScanEye size={15} aria-hidden="true" /> Visitor trail
          </p>
          <p className="truncate text-xs text-slate-400">{label}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white">
          <X size={18} />
        </button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-xs">
        {error ? <p className="text-rose-300">{error}</p> : null}
        {!trail ? (
          !error ? <p className="text-slate-500">Loading…</p> : null
        ) : (
          <>
            <div className={`rounded-xl border px-3 py-2 ${trail.likelyScraper ? "border-rose-500/40 bg-rose-500/10" : "border-slate-700 bg-slate-800/40"}`}>
              <p className={`text-sm font-bold ${trail.likelyScraper ? "text-rose-200" : "text-slate-200"}`}>
                {trail.likelyScraper ? "Likely a scraper" : trail.signals.length ? "Some bot signals" : "Looks like a person"}
              </p>
              {trail.signals.length ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-300">
                  {trail.signals.map((sig) => <li key={sig.key}>{sig.label}</li>)}
                </ul>
              ) : (
                <p className="mt-1 text-slate-400">No bot signals so far.</p>
              )}
            </div>

            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt className="text-slate-500">Where</dt><dd className="text-slate-200">{trail.place ?? "Unknown"}{trail.country ? ` · ${trail.country}` : ""} <span className="text-slate-500">(from IP, approximate)</span></dd>
              <dt className="text-slate-500">IP</dt><dd className="font-mono text-slate-200">{trail.ip ?? "not kept"}{trail.sameIpVisitors ? <span className="text-slate-500"> · {trail.sameIpVisitors} other id{trail.sameIpVisitors === 1 ? "" : "s"} today</span> : null}</dd>
              <dt className="text-slate-500">Browser</dt><dd className="text-slate-200">{[trail.browser, trail.device].filter(Boolean).join(" · ") || "Unknown"}</dd>
              <dt className="text-slate-500">First seen</dt><dd className="text-slate-200">{agoLabel(trail.firstSeen, now)}</dd>
              <dt className="text-slate-500">Last seen</dt><dd className="text-slate-200">{agoLabel(trail.lastSeen, now)}</dd>
              <dt className="text-slate-500">Pages</dt><dd className="text-slate-200">{trail.viewsTotal} total · {trail.viewsHour} this hour{trail.medianGap !== null ? ` · ~${Math.round(trail.medianGap)}s apart` : ""}</dd>
            </dl>
            {trail.userAgent ? <p className="break-all font-mono text-[10px] leading-relaxed text-slate-500">{trail.userAgent}</p> : null}

            <div>
              <p className="mb-1 font-bold uppercase tracking-wide text-slate-400">Pages hit</p>
              <ul className="space-y-0.5">
                {trail.pages.map((p) => (
                  <li key={p.path} className="flex gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-sky-300">{p.path}</span>
                    <span className="shrink-0 text-slate-400">×{p.views}</span>
                    <span className="shrink-0 text-slate-500">{agoLabel(p.lastAt, now)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {trail.searches.length ? (
              <div>
                <p className="mb-1 font-bold uppercase tracking-wide text-slate-400">Radar searches</p>
                <ul className="space-y-0.5">
                  {trail.searches.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="min-w-0 flex-1 truncate text-slate-200">{r.trade}{r.state ? ` · ${r.state}` : ""}</span>
                      <span className="shrink-0 text-slate-400">{r.matched} match{r.matched === 1 ? "" : "es"}</span>
                      <span className="shrink-0 text-slate-500">{agoLabel(r.at, now)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
      {trail ? (
        <div className="flex items-center gap-2 border-t border-slate-700/60 px-3 py-3">
          {!trail.tracked ? (
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={trail.likelyScraper ? "likely scraper" : "Note (optional)"}
              maxLength={200}
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500"
            />
          ) : (
            <p className="min-w-0 flex-1 truncate text-xs text-slate-400">Tracked {agoLabel(trail.trackedAt, now)}{trail.note ? ` · ${trail.note}` : ""}</p>
          )}
          <button type="button" onClick={toggle} disabled={saving} className={`live-track${trail.tracked ? " is-on" : ""} !px-3 !py-1.5 !text-xs`}>
            <ScanEye size={13} aria-hidden="true" /> {trail.tracked ? "Stop tracking" : "Track"}
          </button>
        </div>
      ) : null}
    </aside>
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
          {money.firstMonth ? (
            <p className="mt-2 text-xs text-slate-300">
              <b className="text-emerald-300">$5 first month:</b> {money.firstMonth.started} started · {money.firstMonth.payingNow} paying now ·{" "}
              {money.firstMonth.pastMonthOne} past month one at $19 · {money.firstMonth.canceled} canceled
            </p>
          ) : null}
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

const VOICE_KEY = "contrax_live_voice";

/** Short tones before each spoken line (WebAudio, no sound files). */
function playTone(ctx: AudioContext, tone: Announcement["tone"]) {
  const notes: [number, number][] =
    tone === "money" ? [[1318, 0], [1760, 0.09], [2093, 0.18]] : tone === "hot" ? [[523, 0], [784, 0.12]] : [[880, 0]];
  for (const [freq, delay] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone === "money" ? "triangle" : "sine";
    osc.frequency.value = freq;
    const t = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.25);
  }
}

/** Red Alert siren: two rising-and-falling wails, about 1.6 seconds. */
function playSiren(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  const t = ctx.currentTime;
  for (let i = 0; i < 2; i++) {
    osc.frequency.setValueAtTime(620, t + i * 0.8);
    osc.frequency.linearRampToValueAtTime(1180, t + i * 0.8 + 0.4);
    osc.frequency.linearRampToValueAtTime(620, t + i * 0.8 + 0.8);
  }
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
  gain.gain.setValueAtTime(0.12, t + 1.5);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 1.65);
}

/**
 * Voice Announcer: Mission Control reads new activity out loud. Off until the
 * owner clicks the button (browsers only allow sound after a click); the
 * choice is remembered on this device.
 */
function useVoiceAnnouncer() {
  const [on, setOn] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const queue = useRef<Announcement[]>([]);
  const speaking = useRef(false);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    try {
      if (localStorage.getItem(VOICE_KEY) === "on") setOn(true);
    } catch {
      /* storage blocked */
    }
  }, []);

  const next = () => {
    const line = queue.current.shift();
    if (!line) {
      speaking.current = false;
      return;
    }
    speaking.current = true;
    if (audio.current) {
      if (audio.current.state === "suspended") audio.current.resume().catch(() => {});
      playTone(audio.current, line.tone);
    }
    const u = new SpeechSynthesisUtterance(line.text);
    u.rate = 1.05;
    u.onend = u.onerror = () => setTimeout(next, 400);
    setTimeout(() => window.speechSynthesis.speak(u), 350);
  };

  const say = (lines: Announcement[]) => {
    if (!on || !supported || !lines.length) return;
    // A tab left open in the background shouldn't build up a backlog.
    queue.current = [...queue.current, ...lines].slice(-8);
    if (speaking.current) return;
    // Red Alert: the siren first, then the words.
    if (audio.current && lines.some(isRedAlert)) {
      speaking.current = true;
      if (audio.current.state === "suspended") audio.current.resume().catch(() => {});
      playSiren(audio.current);
      setTimeout(next, 1700);
    } else {
      next();
    }
  };

  const toggle = () => {
    const v = !on;
    setOn(v);
    try {
      localStorage.setItem(VOICE_KEY, v ? "on" : "off");
    } catch {
      /* storage blocked */
    }
    if (v) {
      try {
        audio.current ??= new AudioContext();
        audio.current.resume().catch(() => {});
      } catch {
        /* no WebAudio */
      }
      queue.current = [{ text: "Voice announcer on. I'll tell you when something happens.", tone: "blip" }];
      speaking.current = false;
      next();
    } else {
      queue.current = [];
      speaking.current = false;
      if (supported) window.speechSynthesis.cancel();
    }
  };

  return { on, toggle, say, supported };
}

function VoiceToggle({ on, onToggle, supported }: { on: boolean; onToggle: () => void; supported: boolean }) {
  if (!supported) return null;
  return (
    <button type="button" onClick={onToggle} className={`live-voice ${on ? "live-voice-on" : ""}`} aria-pressed={on} title="Mission Control reads new activity out loud">
      {on ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}
      {on ? "Voice on" : "Turn on voice"}
      {on ? <span className="live-voice-bars" aria-hidden="true"><i /><i /><i /></span> : null}
    </button>
  );
}

const LEAD_COLOR: Record<LeadLevel, string> = { hot: "#f97316", warm: "#facc15", cold: "#38bdf8" };

/** Hot Lead Radar: everyone on the site now, hottest at the center. */
function HotLeadRadar({ visitors, onChat }: { visitors: OnlineVisitor[]; onChat: (v: OnlineVisitor) => void }) {
  const scored = visitors.filter((v) => v.lead).sort((a, b) => b.lead!.score - a.lead!.score);
  const hot = scored.filter((v) => v.lead!.level === "hot").length;
  return (
    <div className="live-radar">
      <div className="live-radar-scope">
        <svg viewBox="0 0 100 100" role="img" aria-label={`${scored.length} visitors on the radar, ${hot} hot`}>
          <defs>
            <radialGradient id="radar-bg" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#14532d" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#022c22" stopOpacity="0.15" />
            </radialGradient>
            <linearGradient id="radar-sweep" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#4ade80" stopOpacity="0" />
              <stop offset="100%" stopColor="#4ade80" stopOpacity="0.45" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="48" fill="url(#radar-bg)" stroke="#22c55e" strokeOpacity="0.5" strokeWidth="0.6" />
          {[36, 24, 12].map((r) => (
            <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#22c55e" strokeOpacity="0.25" strokeWidth="0.4" />
          ))}
          <line x1="2" y1="50" x2="98" y2="50" stroke="#22c55e" strokeOpacity="0.2" strokeWidth="0.3" />
          <line x1="50" y1="2" x2="50" y2="98" stroke="#22c55e" strokeOpacity="0.2" strokeWidth="0.3" />
          <g className="live-radar-sweep">
            <path d="M50 50 L98 50 A48 48 0 0 0 83.9 16.1 Z" fill="url(#radar-sweep)" />
            <line x1="50" y1="50" x2="98" y2="50" stroke="#4ade80" strokeWidth="0.6" />
          </g>
          {scored.map((v) => {
            const p = radarSpot(v.vid, v.lead!.score);
            const c = LEAD_COLOR[v.lead!.level];
            return (
              <g key={v.visitorKey} className={`live-radar-blip live-radar-${v.lead!.level}`} onClick={() => onChat(v)} style={{ cursor: "pointer" }}>
                <title>{`${v.place ?? "Unknown location"} · ${pageName(v.path)} · score ${v.lead!.score}`}</title>
                {v.lead!.level === "hot" ? <circle cx={p.x} cy={p.y} r="4" fill={c} className="live-radar-ping" /> : null}
                <circle cx={p.x} cy={p.y} r={v.lead!.level === "hot" ? 2.4 : 1.7} fill={c} />
              </g>
            );
          })}
        </svg>
        <span className="live-radar-center" aria-hidden="true">BUY</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-400">
          Closer to the center = closer to buying. <span style={{ color: LEAD_COLOR.hot }}>● hot</span> {HOT_SCORE}+ ·{" "}
          <span style={{ color: LEAD_COLOR.warm }}>● warm</span> · <span style={{ color: LEAD_COLOR.cold }}>● just looking</span>
        </p>
        {scored.length ? (
          <ul className="mt-2 space-y-1.5">
            {scored.slice(0, 6).map((v) => (
              <li key={v.visitorKey} className={`live-lead live-lead-${v.lead!.level}`}>
                <span className="live-lead-score" style={{ color: LEAD_COLOR[v.lead!.level] }}>{v.lead!.score}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-slate-100">
                    {v.lead!.level === "hot" ? "🔥 " : ""}
                    {v.place ?? "Unknown location"} · <span className="text-sky-300">{pageName(v.path)}</span>
                  </span>
                  {v.lead!.reasons.length ? <span className="block truncate text-[11px] text-slate-400">{v.lead!.reasons.join(" · ")}</span> : null}
                </span>
                <button type="button" onClick={() => onChat(v)} className="live-sayhi" title="Send this visitor a message">
                  <MessageCircle size={12} aria-hidden="true" /> Say hi
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-slate-500">Nobody on the radar right now.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Red Alert Mode: a sale, a checkout or a visitor who just turned hot flashes
 * the whole screen red with an INCOMING banner (siren too when the voice is
 * on). Closes itself after 30 seconds.
 */
function RedAlert({ alert, more, visitor, onSayHi, onClose }: { alert: Announcement; more: number; visitor: OnlineVisitor | null; onSayHi: (v: OnlineVisitor) => void; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 30_000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const title = document.title;
    let flip = false;
    const blink = setInterval(() => {
      flip = !flip;
      document.title = flip ? "🚨 INCOMING" : title;
    }, 900);
    return () => {
      clearTimeout(t);
      clearInterval(blink);
      document.title = title;
      window.removeEventListener("keydown", onKey);
    };
  }, [alert, onClose]);
  const money = alert.tone === "money";
  return (
    <div className={`live-redalert ${money ? "live-redalert-money" : ""}`} role="alertdialog" aria-live="assertive" aria-label="Red alert">
      <div className="live-redalert-card">
        <p className="live-redalert-kicker">🚨 {money ? "Money incoming" : "Hot lead incoming"} 🚨</p>
        <p className="live-redalert-title">INCOMING</p>
        <p className="live-redalert-text">{alert.text}</p>
        {visitor?.lead?.reasons.length ? <p className="live-redalert-sub">{visitor.lead.reasons.join(" · ")}</p> : null}
        {more > 0 ? <p className="live-redalert-sub">+{more} more alert{more === 1 ? "" : "s"}</p> : null}
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {visitor ? (
            <button type="button" className="live-redalert-go" onClick={() => onSayHi(visitor)}>
              <MessageCircle size={16} aria-hidden="true" /> Say hi now
            </button>
          ) : null}
          <button type="button" className="live-redalert-close" onClick={onClose}>
            {visitor ? "Not now" : "Got it"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** What Mission Control shows, trimmed for Jarvis. */
function jarvisSnapshot(data: LiveData, now: number): JarvisSnapshot {
  return {
    onlineCount: data.onlineCount,
    online: data.online
      .filter((v) => v.lead)
      .sort((a, b) => b.lead!.score - a.lead!.score)
      .slice(0, 15)
      .map((v) => ({ vid: v.vid, place: v.place, page: pageName(v.path), path: v.path.slice(0, 120), score: v.lead!.score, level: v.lead!.level, reasons: v.lead!.reasons })),
    feed: data.feed.slice(0, 25).map((f) => ({ kind: f.kind, title: f.title, place: f.place, detail: f.detail, minutesAgo: Math.round((now - new Date(f.at).getTime()) / 60_000) })),
    trials: data.trials.slice(0, 15).map((t) => ({
      who: t.email.split("@")[0],
      hoursLeft: Math.round((new Date(t.endsAt).getTime() - now) / 3_600_000),
      heat: t.heat,
      trade: t.trade,
      visits7d: t.visits7d,
    })),
    money: data.money ? { payingNow: data.money.payingNow, sawPlans: data.money.sawPlans, clickedBuy: data.money.clickedBuy, openedCheckout: data.money.openedCheckout } : null,
  };
}

type JarvisState = "idle" | "listening" | "thinking" | "speaking";
interface JarvisTurn {
  role: "user" | "assistant";
  content: string;
}
type Recognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};
const WAKE_KEY = "contrax_jarvis_wake";

function makeRecognizer(): Recognizer | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  const R = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!R) return null;
  const r = new R();
  r.lang = "en-US";
  r.interimResults = false;
  return r;
}

/** A British male voice when the browser has one, for the full J.A.R.V.I.S. effect. */
function jarvisVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => /daniel|google uk english male|arthur|george|ryan.*(uk|gb)/i.test(v.name)) ??
    voices.find((v) => v.lang === "en-GB") ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null
  );
}

/**
 * Jarvis: ask Mission Control anything out loud (or type it). Click the
 * reactor (or press J) to talk; "Wake word" keeps listening for "Jarvis…".
 * Answers come from /api/admin/jarvis and are spoken back.
 */
/** A "show me" display: what the server looked up (map draws from the page's data). */
interface HoloVisual {
  kind: JarvisVisual | "simulation";
  days: number;
  rows?: unknown;
}

const HOLO_TITLES: Record<HoloVisual["kind"], string> = {
  simulation: "Simulation",
  map: "Live map",
  funnel: "Funnel",
  traffic: "Visitors per day",
  sources: "Traffic sources",
  pages: "Top pages",
  searches: "Top searches",
};

/** Horizontal glowing bars, growing in one after another. */
function HoloBars({ items }: { items: { label: string; value: number; sub?: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="text-center text-cyan-200">No data for this period.</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => (
        <li key={it.label + i} className="holo-row" style={{ animationDelay: `${i * 90}ms` }}>
          <div className="flex justify-between gap-3 text-sm">
            <span className="truncate text-cyan-50">{it.label}</span>
            <span className="shrink-0 font-bold text-cyan-200">{it.value.toLocaleString("en-US")}{it.sub ? <span className="ml-1 font-normal text-cyan-400">{it.sub}</span> : null}</span>
          </div>
          <div className="holo-track">
            <div className="holo-fill" style={{ width: `${Math.max(2, (it.value / max) * 100)}%`, animationDelay: `${i * 90}ms` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function HoloFunnel({ rows }: { rows: Record<string, number> }) {
  const steps: [string, string][] = [
    ["visited", "Visited"],
    ["searched", "Searched"],
    ["search_found_bids", "Found bids"],
    ["saw_signup", "Saw signup"],
    ["signed_up", "Signed up"],
    ["saw_pricing", "Saw pricing"],
    ["clicked_buy", "Clicked buy"],
  ];
  const top = Math.max(1, Number(rows.visited) || 0);
  return (
    <div className="space-y-1.5">
      {steps.map(([k, label], i) => {
        const v = Number(rows[k]) || 0;
        const w = Math.max(6, (v / top) * 100);
        return (
          <div key={k} className="holo-row" style={{ animationDelay: `${i * 120}ms` }}>
            <div className="holo-funnel-step" style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }}>
              <span>{label}</span>
              <strong>{v.toLocaleString("en-US")}</strong>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HoloColumns({ rows }: { rows: { day: string; visitors: number; from_paid_ads?: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.visitors) || 0));
  if (!rows.length) return <p className="text-center text-cyan-200">No visitors in this period.</p>;
  return (
    <div className="holo-columns">
      {rows.map((r, i) => (
        <div key={r.day} className="holo-col" title={`${r.day}: ${r.visitors}`}>
          <span className="text-xs font-bold text-cyan-100">{r.visitors}</span>
          <div className="holo-col-bar" style={{ height: `${Math.max(3, (Number(r.visitors) / max) * 100)}%`, animationDelay: `${i * 60}ms` }} />
          <span className="holo-col-label">{r.day.split(" ").slice(1).join(" ")}</span>
        </div>
      ))}
    </div>
  );
}

/** "Jarvis, what if…": one month today vs the scenario, side by side. */
function HoloSimulation({ sim }: { sim: SimResult }) {
  const rows: [keyof SimMonth, string, (n: number) => string][] = [
    ["visitors", "Visitors", (n) => n.toLocaleString("en-US")],
    ["searches", "Searches", (n) => n.toLocaleString("en-US")],
    ["signups", "Signups", (n) => n.toLocaleString("en-US")],
    ["newPaying", "New paying customers", (n) => n.toLocaleString("en-US")],
    ["newMonthlyRevenue", "New monthly revenue", (n) => `$${n.toLocaleString("en-US")}`],
  ];
  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-x-4 gap-y-2 text-sm">
        <span />
        <span className="text-xs uppercase tracking-widest text-cyan-400">Today</span>
        <span className="text-xs uppercase tracking-widest text-cyan-400">Projected</span>
        <span />
        {rows.map(([k, label, fmt]) => {
          const a = sim.today[k];
          const b = sim.projected[k];
          const pct = a > 0 ? Math.round(((b - a) / a) * 100) : b > 0 ? null : 0;
          return (
            <div key={k} className="contents">
              <span className="text-cyan-50">{label}</span>
              <span className="text-right text-cyan-200">{fmt(a)}</span>
              <span className="text-right text-lg font-extrabold text-cyan-50">{fmt(b)}</span>
              <span className={`text-right text-xs font-bold ${b > a ? "text-emerald-300" : b < a ? "text-rose-300" : "text-cyan-400"}`}>
                {pct === null ? "new" : pct === 0 ? "=" : `${pct > 0 ? "+" : ""}${pct}%`}
              </span>
            </div>
          );
        })}
      </div>
      <ul className="mt-4 space-y-1 border-t border-cyan-400/20 pt-3 text-xs text-cyan-300">
        {sim.assumptions.map((a) => (
          <li key={a}>▸ {a}</li>
        ))}
      </ul>
    </div>
  );
}

/** "Jarvis, show me…": a hologram-style display over Mission Control. */
function HoloDisplay({ visual, data, now, onChat, onClose }: { visual: HoloVisual; data: LiveData; now: number; onChat: (v: OnlineVisitor) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const rows = visual.rows;
  const list = (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
  let body: ReactNode;
  if (visual.kind === "simulation") body = <HoloSimulation sim={rows as SimResult} />;
  else if (visual.kind === "map") body = <SearchMap stats={data.map} visitors={data.online} now={now} onChat={onChat} />;
  else if (visual.kind === "funnel") body = <HoloFunnel rows={(rows ?? {}) as Record<string, number>} />;
  else if (visual.kind === "traffic") body = <HoloColumns rows={list as { day: string; visitors: number }[]} />;
  else if (visual.kind === "sources")
    body = <HoloBars items={list.map((r) => ({ label: `${r.source}${r.medium && r.medium !== "-" ? ` · ${r.medium}` : ""}`, value: Number(r.visitors) || 0 }))} />;
  else if (visual.kind === "pages") body = <HoloBars items={list.map((r) => ({ label: String(r.page), value: Number(r.visitors) || 0, sub: "visitors" }))} />;
  else
    body = (
      <HoloBars
        items={list.map((r) => ({
          label: `${r.trade} · ${r.state || "any state"}`,
          value: Number(r.searches) || 0,
          sub: Number(r.found_nothing) ? `${r.found_nothing} found nothing` : undefined,
        }))}
      />
    );
  return (
    <div className="holo-overlay" role="dialog" aria-label={HOLO_TITLES[visual.kind]} onClick={onClose}>
      <div className="holo-panel" onClick={(e) => e.stopPropagation()}>
        <div className="holo-scan" aria-hidden="true" />
        <div className="flex items-baseline justify-between gap-3">
          <p className="holo-title">
            {HOLO_TITLES[visual.kind]}
            {visual.kind === "simulation" ? <span className="ml-2 text-sm font-normal text-cyan-300">one month, projected</span> : visual.kind !== "map" ? <span className="ml-2 text-sm font-normal text-cyan-300">last {visual.days} day{visual.days === 1 ? "" : "s"}</span> : null}
          </p>
          <button type="button" onClick={onClose} className="text-cyan-300 hover:text-white" aria-label="Close display">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-cyan-400">{visual.kind === "simulation" ? "A projection from your own last 30 days, not a promise." : JARVIS_VISUALS[visual.kind]}</p>
        <div className="holo-body">{body}</div>
      </div>
    </div>
  );
}

/** "Jarvis, wake up": a full-screen boot sequence that reads the day's status. */
function BootSequence({ lines, done, onClose }: { lines: string[]; done: boolean; onClose: () => void }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const t = setInterval(() => setShown((n) => (n >= lines.length ? n : n + 1)), 420);
    return () => clearInterval(t);
  }, [lines]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="boot-overlay" role="dialog" aria-label="Jarvis start-up" onClick={onClose}>
      <div className="boot-grid" aria-hidden="true" />
      <div className="boot-core" aria-hidden="true">
        <span className="boot-ring b1" />
        <span className="boot-ring b2" />
        <span className="boot-ring b3" />
        <span className="boot-ring b4" />
        <span className="boot-heart" />
      </div>
      <p className="boot-title">J.A.R.V.I.S.</p>
      <ul className="boot-lines">
        {lines.slice(0, shown).map((l, i) => (
          <li key={i} className={i === lines.length - 1 ? "boot-ok" : ""}>
            <span className="boot-tick">{i === lines.length - 1 ? "◆" : "▸"}</span> {l}
            {i > 1 && i < lines.length - 1 ? <span className="boot-check"> ✓</span> : null}
          </li>
        ))}
      </ul>
      <p className="boot-hint">{done ? "Click anywhere to continue" : " "}</p>
    </div>
  );
}

/** Start-up sound: a rising sweep and a chime (WebAudio, after a click or voice command). */
function playBootSound() {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 1.6);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1.85);
    for (const [f, d] of [[1318, 1.7], [1760, 1.85]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.1, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(t + d);
      o.stop(t + d + 0.65);
    }
    setTimeout(() => ctx.close().catch(() => {}), 3000);
  } catch {
    /* no WebAudio */
  }
}

function Jarvis({ data, now, onChat }: { data: LiveData; now: number; onChat: (v: OnlineVisitor) => void }) {
  const [state, setState] = useState<JarvisState>("idle");
  const [turns, setTurns] = useState<JarvisTurn[]>([]);
  const [typed, setTyped] = useState("");
  const [wake, setWake] = useState(false);
  const [note, setNote] = useState("");
  const dataRef = useRef({ data, now });
  dataRef.current = { data, now };
  const turnsRef = useRef<JarvisTurn[]>([]);
  turnsRef.current = turns;
  const wakeRef = useRef<Recognizer | null>(null);
  const wakeOn = useRef(false);
  const busy = useRef(false);
  const [hasMic, setHasMic] = useState(false);
  const [display, setDisplay] = useState<HoloVisual | null>(null);
  const [boot, setBoot] = useState<{ lines: string[]; done: boolean } | null>(null);
  const closeDisplay = useCallback(() => setDisplay(null), []);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopSpeaking = () => {
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
  };
  const closeBoot = useCallback(() => {
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    setBoot(null);
  }, []);

  useEffect(() => {
    setHasMic(!!makeRecognizer());
    try {
      if (localStorage.getItem(WAKE_KEY) === "on") setWake(true);
    } catch {
      /* storage blocked */
    }
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
  }, []);

  /** The browser's own voice: the fallback when the AI voice can't play. */
  const speakBrowser = (text: string) =>
    new Promise<void>((done) => {
      if (!("speechSynthesis" in window)) return done();
      const u = new SpeechSynthesisUtterance(text);
      const v = jarvisVoice();
      if (v) u.voice = v;
      u.rate = 1.02;
      u.pitch = 0.9;
      u.onend = u.onerror = () => done();
      window.speechSynthesis.speak(u);
    });

  /** Jarvis's real voice (owner 2026-10-23, "1,2,5"): /api/admin/jarvis-voice, else the browser's. */
  const speak = async (text: string) => {
    stopSpeaking();
    let src = "";
    try {
      const res = await fetch("/api/admin/jarvis-voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (res.ok) src = URL.createObjectURL(await res.blob());
    } catch {
      /* fall back below */
    }
    if (!src) return speakBrowser(text);
    const audio = new Audio(src);
    audioRef.current = audio;
    await new Promise<void>((done) => {
      const end = () => {
        URL.revokeObjectURL(src);
        if (audioRef.current === audio) audioRef.current = null;
        done();
      };
      audio.onended = audio.onerror = audio.onpause = end;
      audio.play().catch(() => {
        // Autoplay blocked: say it with the browser's voice instead.
        audio.onended = audio.onerror = audio.onpause = null;
        URL.revokeObjectURL(src);
        if (audioRef.current === audio) audioRef.current = null;
        speakBrowser(text).then(done);
      });
    });
  };

  const act = (a: JarvisAction | null, visual?: HoloVisual | null) => {
    if (!a) return;
    if (a.type === "chat") {
      const v = dataRef.current.data.online.find((o) => o.vid === a.vid);
      if (v) onChat(v);
    } else if (a.type === "show") {
      setDisplay(a.visual === "map" ? { kind: "map", days: a.days } : visual ?? null);
    } else {
      window.open(a.path, "_blank", "noopener");
    }
  };

  /** "Jarvis, wake up": the boot sequence, then the day's status out loud. */
  const runBoot = async () => {
    setState("thinking");
    playBootSound();
    setBoot({ lines: ["Initializing J.A.R.V.I.S."], done: false });
    let stats: JarvisServerStats = { now: new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }), visitorsToday: null, visitorsYesterday: null, week: null, outreach: null };
    try {
      const res = await fetch("/api/admin/jarvis");
      if (res.ok) stats = (await res.json()) as JarvisServerStats;
    } catch {
      /* boot with what the page has */
    }
    const report = bootReport(stats, jarvisSnapshot(dataRef.current.data, dataRef.current.now));
    setBoot({ lines: report.lines, done: false });
    setTurns((t) => [...t, { role: "assistant" as const, content: report.spoken }].slice(-12));
    await new Promise((r) => setTimeout(r, 420 * report.lines.length + 300));
    setState("speaking");
    wakeRef.current?.stop();
    await speak(report.spoken);
    setBoot((b) => (b ? { ...b, done: true } : b));
  };

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy.current) return;
    busy.current = true;
    setNote("");
    if (isWakePhrase(q)) {
      setTurns((t) => [...t, { role: "user" as const, content: q }].slice(-12));
      try {
        await runBoot();
      } finally {
        busy.current = false;
        setState("idle");
        if (wakeOn.current) startWake();
      }
      return;
    }
    const history = turnsRef.current.slice(-8);
    setTurns((t) => [...t, { role: "user" as const, content: q }].slice(-12));
    setState("thinking");
    try {
      const res = await fetch("/api/admin/jarvis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, snapshot: jarvisSnapshot(dataRef.current.data, dataRef.current.now), history }),
      });
      const j = (await res.json().catch(() => ({}))) as { say?: string; action?: JarvisAction | null; visual?: HoloVisual | null; error?: string };
      const say = j.say ?? j.error ?? "Sorry, sir, something went wrong.";
      setTurns((t) => [...t, { role: "assistant" as const, content: say }].slice(-12));
      if (j.visual?.kind === "simulation") setDisplay(j.visual);
      act(j.action ?? null, j.visual ?? null);
      setState("speaking");
      wakeRef.current?.stop();
      await speak(say);
    } catch {
      setNote("Couldn't reach Jarvis. Check the connection.");
    } finally {
      busy.current = false;
      setState("idle");
      if (wakeOn.current) startWake();
    }
  };
  const askRef = useRef(ask);
  askRef.current = ask;

  /** Push to talk: one question. */
  const listenOnce = () => {
    if (busy.current) {
      stopSpeaking();
      return;
    }
    const r = makeRecognizer();
    if (!r) {
      setNote("Voice needs Chrome or Edge. You can type below.");
      return;
    }
    wakeRef.current?.stop();
    r.continuous = false;
    let heard = "";
    r.onresult = (e) => {
      heard = Array.from(e.results).map((x) => x[0].transcript).join(" ");
    };
    r.onerror = (e) => e.error === "not-allowed" && setNote("Allow the microphone for this site to talk to Jarvis.");
    r.onend = () => {
      if (heard.trim()) askRef.current(afterWakeWord(heard) || heard);
      else {
        setState("idle");
        if (wakeOn.current) startWake();
      }
    };
    setState("listening");
    try {
      r.start();
    } catch {
      setState("idle");
    }
  };

  /** Wake word: keep listening; anything after "Jarvis" is a question. */
  const startWake = () => {
    if (!wakeOn.current || busy.current) return;
    const r = makeRecognizer();
    if (!r) return;
    r.continuous = true;
    let pending = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const text = e.results[i][0].transcript;
        const q = afterWakeWord(text);
        if (q === null) continue;
        pending = true;
        r.stop();
        if (q) askRef.current(q);
        else {
          speak("Yes, sir?").then(listenOnce);
        }
        return;
      }
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") {
        wakeOn.current = false;
        setWake(false);
        setNote("Allow the microphone for this site to use the wake word.");
      }
    };
    // Browsers end continuous listening every so often; pick it back up.
    r.onend = () => {
      if (!pending && wakeOn.current && !busy.current) setTimeout(startWake, 300);
    };
    wakeRef.current = r;
    try {
      r.start();
    } catch {
      /* already running */
    }
  };

  useEffect(() => {
    wakeOn.current = wake;
    try {
      localStorage.setItem(WAKE_KEY, wake ? "on" : "off");
    } catch {
      /* storage blocked */
    }
    if (wake) startWake();
    else wakeRef.current?.stop();
    return () => wakeRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wake]);

  // Press J (outside a text box) to talk.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key.toLowerCase() !== "j" || e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      listenOnce();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const label = { idle: hasMic ? "Click the reactor or press J to talk" : "Type a question below", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking… (click to stop)" }[state];
  const last = turns.slice(-4);

  return (
    <div className="live-jarvis">
      <button type="button" className={`live-jarvis-core is-${state}`} onClick={listenOnce} aria-label="Talk to Jarvis">
        <span className="live-jarvis-ring r1" />
        <span className="live-jarvis-ring r2" />
        <span className="live-jarvis-ring r3" />
        <span className="live-jarvis-heart">J</span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-lg font-extrabold tracking-[0.25em] text-cyan-200">J.A.R.V.I.S.</p>
          <span className="text-xs text-slate-400">{label}</span>
          {hasMic ? (
            <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-300">
              <input type="checkbox" checked={wake} onChange={(e) => setWake(e.target.checked)} />
              Always listening for "Jarvis"
            </label>
          ) : null}
        </div>
        {last.length ? (
          <ul className="mt-2 space-y-1.5">
            {last.map((t, i) => (
              <li key={i} className={t.role === "user" ? "text-xs text-slate-400" : "text-sm text-cyan-50"}>
                {t.role === "user" ? `You: ${t.content}` : t.content}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-400">Try: "Jarvis, wake up", "Show me the funnel", "What if I double the ad budget?", "Any hot leads?", "Say hi to the hottest lead".</p>
        )}
        {note ? <p className="mt-2 text-xs font-semibold text-amber-300">{note}</p> : null}
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask(typed);
            setTyped("");
          }}
        >
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Ask Jarvis…" className="live-jarvis-input min-w-0 flex-1" maxLength={300} />
          <button type="submit" className="live-jarvis-btn" disabled={state === "thinking"}>Ask</button>
          <button type="button" className="live-jarvis-btn" disabled={state === "thinking"} onClick={() => ask("Give me my briefing: how things are going today versus yesterday, anything hot right now, and the one thing I should do next.")}>
            Briefing
          </button>
          <button type="button" className="live-jarvis-btn" disabled={state === "thinking"} onClick={() => ask("Wake up")}>
            Wake up
          </button>
        </form>
      </div>
      {boot ? <BootSequence lines={boot.lines} done={boot.done} onClose={closeBoot} /> : null}
      {display ? <HoloDisplay visual={display} data={data} now={now} onChat={onChat} onClose={closeDisplay} /> : null}
    </div>
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
  const [track, setTrack] = useState<{ vid: string; label: string } | null>(null);
  const [reload, setReload] = useState(0);
  const openTrack = (v: OnlineVisitor) => setTrack({ vid: v.vid, label: `${v.place ?? "Unknown location"} · ${v.path}` });
  const voice = useVoiceAnnouncer();
  const sayRef = useRef(voice.say);
  sayRef.current = voice.say;
  const heard = useRef<AnnounceState | null>(null);
  const [redAlert, setRedAlert] = useState<{ alert: Announcement; more: number } | null>(null);
  const closeRedAlert = useCallback(() => setRedAlert(null), []);

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
        const said = announcements(heard.current, d.feed, d.online);
        heard.current = said.state;
        sayRef.current(said.lines);
        const red = said.lines.filter(isRedAlert);
        if (red.length) setRedAlert({ alert: red[0], more: red.length - 1 });
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
  }, [reload]);

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
              <div className="mt-2">
                <VoiceToggle on={voice.on} onToggle={voice.toggle} supported={voice.supported} />
              </div>
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
                <OnlineNow count={data.onlineCount} visitors={data.online.slice(0, 12)} now={now} hidden={data.scannersHidden ?? 0} onChat={openChat} onTrack={openTrack} />
                <TrackedList tracked={data.tracked ?? []} now={now} onOpen={(vid, label) => setTrack({ vid, label })} />
                <Conversations threads={threads} online={data.online} onOpen={(vid, label) => setChat({ vid, label })} />
              </div>
            </div>
          ) : null}

          {data ? (
            <div className="mt-6">
              <Jarvis data={data} now={now} onChat={openChat} />
            </div>
          ) : null}

          {data ? (
            <div className="mt-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
                <Crosshair size={15} aria-hidden="true" /> Hot lead radar
              </h2>
              <HotLeadRadar visitors={data.online} onChat={openChat} />
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
      {redAlert ? (
        <RedAlert
          alert={redAlert.alert}
          more={redAlert.more}
          visitor={(redAlert.alert.vid && data?.online.find((v) => v.vid === redAlert.alert.vid)) || null}
          onSayHi={(v) => {
            setRedAlert(null);
            openChat(v);
          }}
          onClose={closeRedAlert}
        />
      ) : null}
      {chat ? <ChatDrawer vid={chat.vid} label={chat.label} onClose={() => setChat(null)} /> : null}
      {track ? <TrackDrawer vid={track.vid} label={track.label} onClose={() => setTrack(null)} onChanged={() => setReload((n) => n + 1)} /> : null}
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
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Live | Admin | Contrax" },
      // iPhone Home Screen app, needed for web push on iOS 16.4+ (issue #788).
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Contrax" },
      { name: "theme-color", content: "#0b1220" },
    ],
    links: [
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/logo-square.png" },
    ],
  }),
});
