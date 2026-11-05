import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentUser } from "~/lib/auth";
import { ADMIN_SECTIONS, ADMIN_TABS, fetchFinance, moneyWhole, type FinanceResult } from "~/components/AdminShared";
import { greeting, type AttentionItem, type CommandCounts, type OperationRow } from "~/lib/command-center";

/**
 * /admin/command — Command Center (owner 2026-11-05: "I need an admin
 * dashboard like this!"). One screen: greeting, what needs the owner, a
 * message box for Jarvis, the automated jobs and Quick Capture notes. Every
 * number comes from /api/admin/command (real data; zero counts are hidden).
 */
export const Route = createFileRoute("/admin/command")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: CommandCenter,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Command Center | Admin | Contrax" }] }),
});

const OWNER_FIRST_NAME = "Nathaniel";

interface CommandData {
  now: string;
  counts: CommandCounts;
  attention: AttentionItem[];
  operations: OperationRow[];
  tiles: { working: number; waiting: number; needsApproval: number; problems: number };
  notes: { id: number; body: string; created_at: string }[];
}

const STATUS = {
  working: { label: "Working", cls: "text-cyan-300 border-cyan-400/40 bg-cyan-400/10" },
  waiting: { label: "Waiting", cls: "text-slate-300 border-slate-500/40 bg-slate-500/10" },
  "needs-approval": { label: "Needs approval", cls: "text-amber-300 border-amber-400/40 bg-amber-400/10" },
  problem: { label: "Problem", cls: "text-rose-300 border-rose-400/40 bg-rose-400/10" },
} as const;

const KIND = {
  money: { label: "Money", cls: "bg-emerald-400/15 text-emerald-300" },
  approve: { label: "Approve", cls: "bg-amber-400/15 text-amber-300" },
  fix: { label: "Fix", cls: "bg-rose-400/15 text-rose-300" },
} as const;

const etTime = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const ago = (iso: string | null, now: string) => {
  if (!iso) return "no run recorded";
  const m = Math.round((new Date(now).getTime() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

function CommandCenter() {
  const [data, setData] = useState<CommandData | null>(null);
  const [error, setError] = useState("");
  const [fin, setFin] = useState<FinanceResult | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/command")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed to load");
        setData(j);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);
  useEffect(() => {
    load();
    fetchFinance().then(setFin).catch(() => setFin(null));
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="min-h-screen bg-[#0b0618] text-slate-100">
      <div className="flex">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <main className="min-w-0 flex-1 px-4 py-4 sm:px-6 lg:px-8">
          <div className="mb-3 flex items-center justify-between gap-2 lg:hidden">
            <button onClick={() => setNavOpen(true)} className="rounded-lg border border-fuchsia-400/40 px-3 py-1.5 text-sm font-semibold text-fuchsia-200">☰ Menu</button>
            <MoneyChip fin={fin} />
          </div>
          <Hero now={data?.now ?? null} fin={fin} />
          {error && <p className="mt-4 rounded-lg border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>}
          {data && (
            <p className="mt-3 text-xs text-slate-400">
              Last bid sync {ago(data.counts.lastSyncAt, data.now)} · {data.counts.openBids.toLocaleString("en-US")} open bids · {data.counts.newBidsToday.toLocaleString("en-US")} new in the last 24 h · refreshes every minute
            </p>
          )}
          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <Attention data={data} />
            <Jarvis />
            <Operations data={data} />
            <Notes data={data} reload={load} />
            <TraceCopy />
          </div>
        </main>
      </div>
    </div>
  );
}

function Panel({ title, icon, right, children }: { title: string; icon: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-fuchsia-500/25 bg-[#140b2b]/90 p-5 shadow-[0_0_40px_-20px_rgba(217,70,239,0.6)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-extrabold italic uppercase tracking-wide text-white">
          <span aria-hidden="true">{icon}</span>
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function MoneyChip({ fin }: { fin: FinanceResult | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-200">
      <span className="text-emerald-400">●</span>
      {fin ? `MRR ${moneyWhole(fin.mrrCents)} · Customers ${fin.customerCount}` : "MRR … · Customers …"}
    </span>
  );
}

function Hero({ now, fin }: { now: string | null; fin: FinanceResult | null }) {
  const when = now ? new Date(now) : new Date();
  return (
    <div className="relative overflow-hidden rounded-2xl border border-fuchsia-500/30 bg-gradient-to-br from-[#2a0f4f] via-[#1a0b36] to-[#0b0618] p-6 sm:p-8">
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 right-8 h-56 w-56 rounded-full bg-gradient-to-b from-amber-300 via-orange-500 to-fuchsia-600 opacity-70 [mask-image:repeating-linear-gradient(to_bottom,black_0_14px,transparent_14px_20px)]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-[linear-gradient(to_right,rgba(34,211,238,0.25)_1px,transparent_1px),linear-gradient(to_top,rgba(34,211,238,0.25)_1px,transparent_1px)] bg-[size:28px_14px] [mask-image:linear-gradient(to_top,black,transparent)]" />
      <div className="relative">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-300">Contrax · Command Center</p>
        <h1 className="mt-2 text-3xl font-black italic uppercase leading-tight text-white drop-shadow-[0_0_12px_rgba(244,114,182,0.6)] sm:text-5xl">
          {greeting(when)}, {OWNER_FIRST_NAME}
        </h1>
        <p className="mt-2 text-slate-300">Here's what needs your attention.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-cyan-400/50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-cyan-200">{etTime(when.toISOString())} ET</span>
          <span className="hidden lg:inline"><MoneyChip fin={fin} /></span>
        </div>
      </div>
    </div>
  );
}

function Attention({ data }: { data: CommandData | null }) {
  const items = data?.attention ?? [];
  return (
    <Panel title={`Needs your attention (${data ? items.length : "…"})`} icon="⚡">
      {!data ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-300">Nothing waiting on you.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.key}>
              <a href={i.href} className="block rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 no-underline transition hover:border-fuchsia-400/50 hover:bg-white/[0.06]">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${KIND[i.kind].cls}`}>{KIND[i.kind].label}</span>
                  <span className="font-semibold text-white">{i.label}</span>
                  <span className="ml-auto text-cyan-300">→</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{i.detail}</p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Jarvis() {
  const [turns, setTurns] = useState<{ role: "user" | "assistant"; content: string }[]>([
    { role: "assistant", content: "Good to see you. Ask me about visitors, searches, outreach or revenue." },
  ]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [turns]);
  const send = async () => {
    const question = q.trim();
    if (!question || busy) return;
    setQ("");
    const history = turns.slice(-8);
    setTurns((t) => [...t, { role: "user", content: question }]);
    setBusy(true);
    try {
      const r = await fetch("/api/admin/jarvis", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, snapshot: {}, history }) });
      const j = (await r.json().catch(() => ({}))) as { say?: string; error?: string };
      setTurns((t) => [...t, { role: "assistant", content: j.say ?? j.error ?? "Something went wrong." }]);
    } catch {
      setTurns((t) => [...t, { role: "assistant", content: "I couldn't reach the server." }]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Message Jarvis" icon="✉️" right={<a href="/admin/live" className="text-xs text-cyan-300 underline">Voice mode →</a>}>
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {turns.map((t, i) => (
          <div key={i} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${t.role === "assistant" ? "border border-cyan-400/40 bg-cyan-400/[0.06] text-slate-100" : "ml-auto bg-fuchsia-500/20 text-white"}`}>
            {t.role === "assistant" && <p className="text-[10px] font-bold uppercase tracking-wide text-cyan-300">Jarvis</p>}
            {t.content}
          </div>
        ))}
        {busy && <p className="text-xs text-slate-400">Jarvis is thinking…</p>}
        <div ref={end} />
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Message Jarvis…" className="min-w-0 flex-1 rounded-xl border border-fuchsia-500/30 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none" />
        <button type="submit" disabled={busy || !q.trim()} className="rounded-xl border border-emerald-400/50 px-4 py-2 text-sm font-bold text-emerald-300 disabled:opacity-40">Send</button>
      </form>
    </Panel>
  );
}

function Operations({ data }: { data: CommandData | null }) {
  const t = data?.tiles;
  const tile = (label: string, value: number | undefined, cls: string) => (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-3xl font-black ${cls}`}>{value ?? "…"}</p>
    </div>
  );
  return (
    <Panel title="Contrax ops · live" icon="◆">
      <p className="-mt-1 mb-3 text-xs text-slate-400">From what each job last wrote to the database, not guesses.</p>
      <div className="grid grid-cols-2 gap-3">
        {tile("Working", t?.working, "text-cyan-300")}
        {tile("Waiting", t?.waiting, "text-slate-200")}
        {tile("Needs approval", t?.needsApproval, "text-amber-300")}
        {tile("Problems", t?.problems, "text-rose-300")}
      </div>
      <ul className="mt-4 divide-y divide-white/10">
        {(data?.operations ?? []).map((o) => (
          <li key={o.name} className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-white">{o.name}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {o.summary}
              {o.lastAt && data ? ` · last ${ago(o.lastAt, data.now)}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Notes({ data, reload }: { data: CommandData | null; reload: () => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const post = async (payload: unknown) => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not save");
      reload();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Quick capture" icon="＋">
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await post({ action: "note", body })) setBody("");
        }}
      >
        <input value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} placeholder="A note, an idea, someone to call back…" className="min-w-0 flex-1 rounded-xl border border-fuchsia-500/30 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none" />
        <button type="submit" disabled={busy || !body.trim()} className="rounded-xl bg-gradient-to-r from-fuchsia-600 to-pink-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Save</button>
      </form>
      {err && <p className="mt-2 text-xs text-rose-300">{err}</p>}
      <ul className="mt-3 space-y-2">
        {(data?.notes ?? []).map((n) => (
          <li key={n.id} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <button aria-label="Mark done" onClick={() => post({ action: "done", id: n.id })} className="mt-0.5 h-4 w-4 shrink-0 rounded border border-cyan-400/60 hover:bg-cyan-400/30" />
            <span className="text-sm text-slate-100">{n.body}</span>
            <span className="ml-auto shrink-0 text-[11px] text-slate-500">{new Date(n.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}</span>
          </li>
        ))}
        {data && data.notes.length === 0 && <li className="text-sm text-slate-400">No open notes.</li>}
      </ul>
    </Panel>
  );
}

interface TraceHit {
  token: string;
  bid_id: number | null;
  bid_title: string | null;
  served_at: string | null;
  country: string | null;
  user_agent: string | null;
  views_that_hour: number;
}

/**
 * Owner 2026-11-05 ("Do both"): paste text copied from another site; the hidden
 * bid-page watermark (src/lib/bid-watermark.ts) says which visit took it.
 */
function TraceCopy() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [hits, setHits] = useState<TraceHit[]>([]);
  const check = async () => {
    setBusy(true);
    setMsg("");
    setHits([]);
    try {
      const r = await fetch("/api/admin/watermark", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const j = (await r.json().catch(() => ({}))) as { found?: TraceHit[]; note?: string; error?: string };
      if (!r.ok) throw new Error(j.error || "Lookup failed");
      setHits(j.found ?? []);
      if (!j.found?.length) setMsg(j.note ?? "No Contrax watermark in that text.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Trace a copied listing" icon="🔎">
      <p className="text-xs text-slate-400">Found one of our bids on another site? Copy its description there and paste it here. Pages served since Nov 5 carry an invisible code that names the visit that copied it.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Paste the copied description…" className="mt-3 w-full rounded-xl border border-fuchsia-500/30 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none" />
      <button type="button" onClick={check} disabled={busy || !text.trim()} className="mt-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-pink-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{busy ? "Checking…" : "Trace it"}</button>
      {msg && <p className="mt-2 text-sm text-slate-300">{msg}</p>}
      {hits.length > 0 && (
        <ul className="mt-3 space-y-2">
          {hits.map((h) => (
            <li key={h.token} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100">
              {h.bid_id === null ? (
                <span>Code {h.token}: not one of ours, or from before Nov 5.</span>
              ) : (
                <>
                  <a href={`/bid/${h.bid_id}`} className="font-semibold text-cyan-300">{h.bid_title || `Bid ${h.bid_id}`}</a>
                  <p className="mt-1 text-xs text-slate-400">
                    Copied {h.served_at ? etTime(h.served_at) : "?"} ET · {h.country ?? "country unknown"} · same visitor read {h.views_that_hour} bid page{h.views_that_hour === 1 ? "" : "s"} within 30 min
                  </p>
                  {h.user_agent && <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{h.user_agent}</p>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-slate-400">
        Evidence files (CSV, for your lawyer): <a href="/api/admin/evidence-export?part=burst" className="font-semibold text-cyan-300">Nov 5 scrape</a> · <a href="/api/admin/evidence-export?part=recon" className="font-semibold text-cyan-300">Oct 29–31 server visits</a>
      </p>
    </Panel>
  );
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = (
    <nav className="flex h-full flex-col gap-4 p-4">
      <a href="/admin/command" className="block no-underline">
        <p className="text-2xl font-black italic tracking-tight text-cyan-300 drop-shadow-[0_0_10px_rgba(34,211,238,0.6)]">CONTRAX</p>
        <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-fuchsia-400">Command Center</p>
      </a>
      <a href="/admin/command" className="rounded-xl border border-fuchsia-500/60 bg-fuchsia-500/15 px-3 py-2 text-sm font-semibold text-white no-underline">● Home</a>
      {ADMIN_SECTIONS.map((section) => (
        <div key={section}>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-cyan-300">▸ {section}</p>
          <ul className="space-y-0.5">
            {ADMIN_TABS.filter((t) => t.group === section && t.key !== "command").map((t) => (
              <li key={t.key}>
                <a href={t.href} className="block rounded-lg px-3 py-1.5 text-sm text-slate-300 no-underline hover:bg-white/5 hover:text-white">{t.label}</a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <a href="/dashboard" className="mt-auto rounded-xl border border-white/15 px-3 py-2 text-center text-sm text-slate-300 no-underline hover:text-white">Customer dashboard ↗</a>
    </nav>
  );
  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-fuchsia-500/20 bg-[#0e0721] lg:block">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-label="Menu">
          <button aria-label="Close menu" className="absolute inset-0 bg-black/60" onClick={onClose} />
          <aside className="absolute inset-y-0 left-0 w-64 overflow-y-auto border-r border-fuchsia-500/30 bg-[#0e0721]">{nav}</aside>
        </div>
      )}
    </>
  );
}
