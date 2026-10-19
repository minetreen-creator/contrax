import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Search, UserPlus, Timer, CreditCard, PartyPopper, Radio, Flame } from "lucide-react";
import { getCurrentUser } from "~/lib/auth";
import { TRIAL_DAYS } from "~/lib/trial";
import { AdminHeader, AdminTabs, MrrScoreboard, SectionError, SectionLoading } from "~/components/AdminShared";
import {
  agoLabel,
  timeLeftLabel,
  trialFractionLeft,
  type FeedItem,
  type FeedKind,
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
  feed: FeedItem[];
  trials: TrialCard[];
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
      <span className="live-icon"><Icon size={16} aria-hidden="true" /></span>
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

function TrialTile({ t, now }: { t: TrialCard; now: number }) {
  const msLeft = new Date(t.endsAt).getTime() - now;
  const fraction = trialFractionLeft(msLeft, TRIAL_DAYS);
  const heat = HEAT_STYLE[t.heat];
  const ringColor = fraction < 0.25 ? "#f43f5e" : fraction < 0.6 ? "#fbbf24" : "#34d399";
  return (
    <article className="live-trial">
      <div className="relative shrink-0">
        <CountdownRing fraction={fraction} color={ringColor} />
        <span className="absolute inset-0 flex items-center justify-center text-center text-[11px] font-bold leading-tight text-white">
          {timeLeftLabel(msLeft).replace(" left", "")}
          <br />
          <span className="font-normal text-slate-400">left</span>
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
