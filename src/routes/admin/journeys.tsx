import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect, type ReactNode } from "react";
import { getCurrentUser } from "~/lib/auth";

/**
 * Admin "Visitor Journeys" board + Visitor Intelligence panels (owner spec
 * 2026-09-05).
 *
 * One row per real person/session (grouped by the persistent contrax_vid).
 * Row summaries are served from the `visitors` summary cache (fast read-path);
 * clicking a row expands it into a full VISITOR INTELLIGENCE panel — lazily
 * fetched per-row (collapsed rows never fetch):
 *
 *   GET /api/admin/visitor-intel?visitor_id=<id>   → acquisition / location /
 *     device / engagement / inferred interests / contracts viewed / radar
 *     profile / lead score + reasons / conversion signals / known identity
 *   GET /api/admin/journeys-timeline?visitor_id=<id> → timestamped timeline
 *     (rendered as one more panel section)
 *
 * Each row also carries a "👀 Watch visitor" toggle (POST /api/admin/watch-
 * visitor). Watched rows highlight; the top banner lists watched visitors who
 * RETURNED since the admin last viewed them — that list is computed
 * server-side (journeys payload `watched_returned`), never by the client.
 *
 * PII: unauthenticated visitors → geo/behavioral display name ("Dallas, TX ·
 * Desktop", "Direct Lead · /pricing") with a muted #hash badge; linked users →
 * "local-part@…". Location is always labeled "approximate / IP-derived";
 * interests are always labeled "inferred". No raw IPs, full emails, or raw
 * user-agent strings anywhere. QA/admin/bot/test traffic is excluded
 * server-side.
 */

interface TimelineItem { t: string; label: string; kind: "page" | "event"; }
interface JourneyBadge { key: "pricing" | "brief" | "engagement"; label: string; }
interface Journey {
  visitor_id: string;
  label: string;
  visitor_hash: string | null;
  source: string | null;
  landing_page: string | null;
  city: string | null;
  region: string | null;
  device_type: string | null;
  browser_label: string | null;
  radar: boolean;
  signup: "Not started" | "Viewed" | "Started" | "Abandoned" | "Success";
  activated: boolean;
  paid: boolean;
  last_activity: string | null;
  steps: number;
  badges: JourneyBadge[];
  events: TimelineItem[]; // reliably empty on the board — the timeline is lazy
  watched?: boolean;
  watched_since?: string | null;
  returned_since_view?: boolean;
}
interface FunnelStage { stage: string; label: string; count: number; dropOffPct: number | null; }
interface AutopsyFunnelStage { stage: string; label: string; count: number; dropOffPct: number | null; }
interface AutopsyFunnelResult {
  rangeDays: number;
  from: string;
  to: string;
  funnel: AutopsyFunnelStage[];
}
interface WatchedReturned {
  visitor_id: string;
  label: string;
  visitor_hash: string | null;
  last_activity: string | null;
  watched_since: string | null;
}
interface JourneysResult {
  rangeDays: number;
  from: string;
  to: string;
  funnel: FunnelStage[];
  journeys: Journey[];
  watched_returned: WatchedReturned[];
}

// ── Visitor Intelligence payload (mirrors src/lib/visitor-intel.ts) ──────────
interface ScoreReason { points: number; reason: string; }
interface LeadScore { score: number; level: "High" | "Medium" | "Low"; reasons: ScoreReason[]; }
interface InferredInterest { key: string; label: string; evidence: string; }
interface ContractView {
  bid_id: number; path: string; title: string | null; agency: string | null;
  set_aside: string | null; naics_code: string | null; location: string | null;
  views: number; last_viewed_at: string | null;
}
interface VisitorIntel {
  visitor_id: string;
  known_identity: {
    status: "Anonymous" | "Known";
    email_masked: string | null;
    user_id: string | null;
    first_linked_at: string | null;
    plan_tier: string | null;
    subscription_status: string | null;
  };
  acquisition: {
    source: string | null; medium: string | null; campaign: string | null;
    referrer_host: string | null; landing_path: string | null;
    first_seen: string | null; last_seen: string | null;
    sessions: number; visits_distinct: number;
  };
  location: { city: string | null; region: string | null; approximate: true };
  device: { device_type: string | null; browser_label: string | null };
  engagement: {
    steps: number; sessions: number; returning: boolean;
    first_path: string | null; last_path: string | null;
    last_action: string | null; last_action_at: string | null;
    first_seen: string | null; last_seen: string | null;
  };
  interests: InferredInterest[];
  contracts_viewed: ContractView[];
  radar_profile: {
    trade: string | null; state: string | null; cert: string | null; cert_label: string | null;
    size: string | null; size_label: string | null; email_captured: boolean;
  } | null;
  lead_score: LeadScore;
  conversion_signals: {
    returned: boolean; radar_used: boolean; brief_viewed: boolean; incumbent_viewed: boolean;
    saved_bids: boolean; pricing_viewed: boolean; started_signup: boolean; signed_up: boolean;
    activated: boolean;
  };
}

const DAYS_OPTIONS = [7, 30, 90];

async function fetchJourneys(days: number): Promise<JourneysResult> {
  const res = await fetch(`/api/admin/journeys?days=${days}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load journeys" }));
    throw new Error(err.error || "Failed to load journeys");
  }
  return res.json();
}
async function fetchAutopsyFunnel(days: number): Promise<AutopsyFunnelResult> {
  const res = await fetch(`/api/admin/autopsy-funnel?days=${days}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load autopsy funnel" }));
    throw new Error(err.error || "Failed to load autopsy funnel");
  }
  return res.json();
}

async function fetchTimeline(visitorId: string): Promise<TimelineItem[]> {
  const res = await fetch(`/api/admin/journeys-timeline?visitor_id=${encodeURIComponent(visitorId)}`);
  if (!res.ok) throw new Error("Failed to load timeline");
  const data = await res.json();
  return (data?.events ?? []) as TimelineItem[];
}

async function fetchIntel(visitorId: string): Promise<VisitorIntel> {
  const res = await fetch(`/api/admin/visitor-intel?visitor_id=${encodeURIComponent(visitorId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load visitor intel" }));
    throw new Error(err.error || "Failed to load visitor intel");
  }
  return res.json();
}

async function postWatch(visitorId: string, watch: boolean): Promise<{ ok: boolean; watched: boolean; watched_since: string | null; error?: string }> {
  const res = await fetch("/api/admin/watch-visitor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitor_id: visitorId, action: watch ? "watch" : "unwatch" }),
  });
  return res.json();
}

function timeFmt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function dayFmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SignupBadge({ status }: { status: Journey["signup"] }) {
  const palette: Record<Journey["signup"], string> = {
    Success: "bg-emerald-100 text-emerald-700",
    "Not started": "bg-slate-100 text-slate-500",
    Viewed: "bg-blue-50 text-blue-700",
    Started: "bg-amber-50 text-amber-700",
    Abandoned: "bg-red-50 text-red-600",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${palette[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

function YesNo({ value, yes = "Yes", no = "No" }: { value: boolean; yes?: string; no?: string }) {
  return value ? (
    <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">{yes}</span>
  ) : (
    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400">{no}</span>
  );
}

const BADGE_STYLES: Record<JourneyBadge["key"], string> = {
  pricing: "bg-amber-100 text-amber-800",
  brief: "bg-blue-100 text-blue-700",
  engagement: "bg-emerald-100 text-emerald-700",
};

function Badges({ badges }: { badges: JourneyBadge[] }) {
  if (!badges || badges.length === 0) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1">
      {badges.map((b) => (
        <span key={b.key} className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${BADGE_STYLES[b.key] ?? "bg-slate-100 text-slate-600"}`}>
          {b.label}
        </span>
      ))}
    </span>
  );
}

/** 👀 Watch/unwatch toggle (row chip + panel button share this). */
function WatchToggle({
  visitorId, watched, onChange, compact,
}: {
  visitorId: string;
  watched: boolean;
  onChange: (watched: boolean, watchedSince: string | null) => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        if (busy) return;
        setBusy(true);
        postWatch(visitorId, !watched)
          .then((r) => {
            if (r && typeof r.watched === "boolean") onChange(r.watched, r.watched_since ?? null);
          })
          .catch(() => { /* fail-open — button stays in prior state */ })
          .finally(() => setBusy(false));
      }}
      title={watched ? "Stop watching this visitor" : "Watch this visitor — get flagged when they return"}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
        watched
          ? "border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200"
          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700"
      }`}
    >
      {busy ? "…" : "👀"} {watched ? (compact ? "Watching" : "Watching — unwatch") : compact ? "Watch" : "Watch visitor"}
    </button>
  );
}

function PanelSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function KV({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-xs text-slate-400">{k}</span>
      <span className={`text-right text-sm text-slate-700 ${mono ? "font-mono text-xs" : ""}`}>{v}</span>
    </div>
  );
}

function Sig({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${on ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
      {on ? "✓" : "—"} {label}
    </span>
  );
}

const LEVEL_STYLES: Record<LeadScore["level"], string> = {
  High: "bg-rose-100 text-rose-700",
  Medium: "bg-amber-100 text-amber-800",
  Low: "bg-slate-100 text-slate-500",
};

/** The expanded Visitor Intelligence panel (intel + timeline, lazily fetched). */
function IntelPanel({
  visitorId, watched, watchedSince, onWatchedChange, timeline, timelineLoading, timelineError,
}: {
  visitorId: string;
  watched: boolean;
  watchedSince: string | null;
  onWatchedChange: (watched: boolean, since: string | null) => void;
  timeline: TimelineItem[] | null;
  timelineLoading: boolean;
  timelineError: string;
}) {
  const [intel, setIntel] = useState<VisitorIntel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchIntel(visitorId)
      .then((d) => { if (!cancelled) setIntel(d); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load visitor intel"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visitorId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-400">Loading visitor intelligence…</p>
      </div>
    );
  }
  if (error || !intel) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-red-600">{error || "No intelligence available for this visitor."}</p>
        {timelineError && <p className="mt-1 text-xs text-red-500">{timelineError}</p>}
      </div>
    );
  }

  const { known_identity, acquisition, location, device, engagement, interests, contracts_viewed, radar_profile, lead_score, conversion_signals } = intel;
  const geoLine = [location.city, location.region].filter(Boolean).join(", ");

  return (
    <div className="space-y-3">
      {/* Header: identity + lead score + watch toggle */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            {known_identity.status === "Known" ? (
              <>Known · <span className="font-mono text-xs">{known_identity.email_masked}</span></>
            ) : (
              <>Anonymous <span className="text-xs font-normal text-slate-400">— identified by behavior only (no account linked)</span></>
            )}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            Location and interests below are derived from first-party tracking only — nothing enriched from third parties.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            {watched && watchedSince && (
              <p className="text-[10px] text-amber-700 mb-0.5">👀 watching since {dayFmt(watchedSince)}</p>
            )}
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Lead score (heuristic)</p>
            <p className="flex items-baseline justify-end gap-1.5">
              <span className="text-2xl font-bold text-slate-900">{lead_score.score}</span>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${LEVEL_STYLES[lead_score.level]}`}>{lead_score.level} intent</span>
            </p>
          </div>
          <WatchToggle visitorId={visitorId} watched={watched} onChange={onWatchedChange} />
        </div>
      </div>

      {/* Why this score — explicit, honest reasons */}
      <PanelSection title="Why this score" hint="Every point comes from a real, observed action — nothing modeled.">
        {lead_score.reasons.length === 0 ? (
          <p className="text-sm text-slate-400">No scoring signals yet — very early or single-page visit.</p>
        ) : (
          <ul className="space-y-1">
            {lead_score.reasons.map((r, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-slate-700">{r.reason}</span>
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">+{r.points}</span>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>

      <div className="grid gap-3 md:grid-cols-2">
        <PanelSection title="Acquisition" hint="First-touch attribution from UTM/referrer data.">
          <KV k="Source" v={acquisition.source ? <span className="capitalize">{acquisition.source}</span> : "—"} />
          <KV k="Medium" v={acquisition.medium ?? "—"} />
          <KV k="Campaign" v={acquisition.campaign ?? "—"} />
          <KV k="Referrer" v={acquisition.referrer_host ?? "—"} mono />
          <KV k="Landing path" v={acquisition.landing_path ?? "—"} mono />
          <KV k="First seen" v={acquisition.first_seen ? dayFmt(acquisition.first_seen) : "—"} />
          <KV k="Last seen" v={acquisition.last_seen ? `${dayFmt(acquisition.last_seen)}${engagement.last_action ? ` · ${engagement.last_action.replace(/_/g, " ")}` : ""}` : "—"} />
          <KV k="Sessions" v={`${acquisition.sessions}${acquisition.visits_distinct > 0 && acquisition.visits_distinct !== acquisition.sessions ? ` (${acquisition.visits_distinct} distinct visit${acquisition.visits_distinct === 1 ? "" : "s"})` : ""}`} />
        </PanelSection>

        <div className="space-y-3">
          <PanelSection title="Location & device">
            <KV k="Approximate location" v={geoLine || "Unknown"} />
            <p className="mt-1 text-[11px] text-amber-700 bg-amber-50 rounded-md px-2 py-1">
              ⚠️ Approximate / IP-derived — a coarse city-level estimate, not an exact address.
            </p>
            <div className="mt-2">
              <KV k="Device" v={device.device_type ? <span className="capitalize">{device.device_type}</span> : "—"} />
              <KV k="Browser" v={device.browser_label ?? "—"} />
            </div>
          </PanelSection>
          <PanelSection title="Conversion signals" hint="Derived from real tracked rows.">
            <div className="flex flex-wrap gap-1.5">
              <Sig on={conversion_signals.returned} label="Returned" />
              <Sig on={conversion_signals.radar_used} label="Radar used" />
              <Sig on={conversion_signals.brief_viewed} label="Brief viewed" />
              <Sig on={conversion_signals.incumbent_viewed} label="Incumbent viewed" />
              <Sig on={conversion_signals.saved_bids} label="Saved bids" />
              <Sig on={conversion_signals.pricing_viewed} label="Pricing viewed" />
              <Sig on={conversion_signals.started_signup} label="Started signup" />
              <Sig on={conversion_signals.signed_up} label="Signed up" />
              <Sig on={conversion_signals.activated} label="Activated" />
            </div>
          </PanelSection>
        </div>

        <PanelSection title="Engagement">
          <KV k="Steps" v={engagement.steps} />
          <KV k="Sessions" v={engagement.sessions} />
          <KV k="Returning visitor" v={engagement.returning ? "Yes — active on a later day" : "No — same-day only"} />
          <KV k="First path" v={engagement.first_path ?? "—"} mono />
          <KV k="Last path" v={engagement.last_path ?? "—"} mono />
          <KV k="First seen" v={engagement.first_seen ? timeFmt(engagement.first_seen) : "—"} />
          <KV k="Last seen" v={engagement.last_seen ? timeFmt(engagement.last_seen) : "—"} />
        </PanelSection>

        <PanelSection title="Interests (inferred)" hint="Rule-based inference from pages viewed and events fired — a guess, not a fact.">
          {interests.length === 0 ? (
            <p className="text-sm text-slate-400">Not enough activity to infer anything yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {interests.map((i) => (
                <li key={i.key} className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-slate-700">{i.label}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{i.evidence}</span>
                </li>
              ))}
            </ul>
          )}
        </PanelSection>

        <PanelSection title="Contracts viewed" hint="Real /bid/ pages this visitor opened, matched to the live bids table.">
          {contracts_viewed.length === 0 ? (
            <p className="text-sm text-slate-400">No contract detail pages viewed.</p>
          ) : (
            <ul className="space-y-2">
              {contracts_viewed.map((c) => (
                <li key={c.bid_id} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2">
                  <a href={c.path} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-700 hover:underline">
                    {c.title ?? `Bid #${c.bid_id}`}
                  </a>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {[c.agency, c.set_aside, c.naics_code ? `NAICS ${c.naics_code}` : null, c.location].filter(Boolean).join(" · ") || `#${c.bid_id}`}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {c.views} view{c.views === 1 ? "" : "s"}{c.last_viewed_at ? ` · last ${timeFmt(c.last_viewed_at)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </PanelSection>

        <PanelSection
          title="Radar profile"
          hint={radar_profile ? "Criteria the visitor entered themselves in Radar / 'Save your matches'." : "No radar criteria captured from this visitor."}
        >
          {radar_profile ? (
            <>
              <KV k="Trade / NAICS" v={radar_profile.trade || "—"} />
              <KV k="State" v={radar_profile.state || "Nationwide"} />
              <KV k="Certification" v={radar_profile.cert_label ?? "—"} />
              <KV k="Size" v={radar_profile.size_label ?? "—"} />
              {radar_profile.email_captured && <p className="mt-1 text-[11px] text-slate-400">Via a voluntary "Save your matches" submission.</p>}
            </>
          ) : (
            <p className="text-sm text-slate-400">Nothing voluntarily shared yet.</p>
          )}
        </PanelSection>
      </div>

      {/* Timeline — merged as one more section of the panel */}
      <PanelSection title={`Timeline · ${timelineLoading ? "…" : `${timeline?.length ?? 0} ${(timeline?.length ?? 0) === 1 ? "step" : "steps"}`}`}>
        {timelineLoading ? (
          <p className="text-sm text-slate-400">Loading timeline…</p>
        ) : timelineError ? (
          <p className="text-sm text-red-600">{timelineError}</p>
        ) : timeline && timeline.length === 0 ? (
          <p className="text-sm text-slate-400">No tracked events.</p>
        ) : (
          <ul className="space-y-1.5 border-l-2 border-slate-100 pl-4">
            {(timeline ?? []).map((ev, i) => (
              <li key={i} className="flex items-baseline gap-3 text-sm">
                <span className="shrink-0 whitespace-nowrap font-mono text-xs text-slate-400">{timeFmt(ev.t)}</span>
                <span className="text-slate-700">{ev.label}</span>
                {ev.kind === "page" && (
                  <span className="inline-flex rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">view</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
    </div>
  );
}

function JourneyRow({ j, onWatchedChange }: { j: Journey; onWatchedChange: (visitorId: string, watched: boolean, since: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [watched, setWatched] = useState(!!j.watched);
  const [watchedSince, setWatchedSince] = useState<string | null>(j.watched_since ?? null);
  // Lazy per-expanded-row fetches — collapsed rows never fetch. Kept in local
  // state so toggling closed→open again doesn't re-fetch.
  const [events, setEvents] = useState<TimelineItem[] | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (events !== null) return; // already loaded once
    let cancelled = false;
    setTimelineLoading(true);
    setTimelineError("");
    fetchTimeline(j.visitor_id)
      .then((ev) => { if (!cancelled) setEvents(ev); })
      .catch(() => { if (!cancelled) setTimelineError("Failed to load timeline"); })
      .finally(() => { if (!cancelled) setTimelineLoading(false); });
    return () => { cancelled = true; };
  }, [open, events, j.visitor_id]);

  const handleWatchedChange = (w: boolean, since: string | null) => {
    setWatched(w);
    setWatchedSince(since);
    onWatchedChange(j.visitor_id, w, since);
  };

  // The summary cache's LIFETIME step count (j.steps) is the CANONICAL
  // "Steps N" for a row, shown identically whether collapsed or expanded. It
  // must never be overridden downward by the lazily-loaded timeline's length:
  // for QA/test/admin egress-IP rows the timeline endpoint is IP-excluded and
  // returns [] while the summary still carries the lifetime count — letting the
  // timeline length drive the count would flip a row from "Steps 6" to "Steps 0"
  // on expand. j.steps and a non-excluded timeline both measure lifetime, so
  // they agree for real visitors; using j.steps only corrects the excluded-IP
  // case. (Math.max(j.steps, events.length) was rejected: it could override
  // j.steps UPWARD and break the always-agree guarantee.)
  const stepCount = j.steps;

  return (
    <>
      <tr
        onClick={() => setOpen((o) => !o)}
        className={`border-t cursor-pointer transition-colors ${watched ? "border-amber-200 bg-amber-50/50 hover:bg-amber-50" : "border-slate-50 hover:bg-blue-50/40"}`}
      >
        <td className="px-5 py-3">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-slate-800">{j.label}</span>
            {j.visitor_hash && (
              <span className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-400" title="Visitor id (last 4)">
                {j.visitor_hash}
              </span>
            )}
            {j.returned_since_view && (
              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700" title="Active since you last viewed this visitor">
                ↩ returned
              </span>
            )}
          </div>
          <Badges badges={j.badges} />
          <div className="mt-1.5 flex items-center gap-1.5">
            <WatchToggle visitorId={j.visitor_id} watched={watched} onChange={handleWatchedChange} compact />
          </div>
          {j.device_type && (
            <p className="mt-1 text-[10px] text-slate-400">
              {[j.city, j.region].filter(Boolean).join(", ")}
              {j.browser_label ? ` · ${j.browser_label}` : ` · ${j.device_type}`}
            </p>
          )}
        </td>
        <td className="px-5 py-3 text-slate-600">{j.source ? <span className="capitalize">{j.source}</span> : "—"}</td>
        <td className="px-5 py-3 text-slate-500 max-w-[180px] truncate font-mono">{j.landing_page ?? "—"}</td>
        <td className="px-5 py-3"><YesNo value={j.radar} /></td>
        <td className="px-5 py-3"><SignupBadge status={j.signup} /></td>
        <td className="px-5 py-3"><YesNo value={j.activated} yes={"Yes"} /></td>
        <td className="px-5 py-3 text-slate-500 whitespace-nowrap">
          {j.last_activity ? timeFmt(j.last_activity) : "—"}
        </td>
        <td className="px-5 py-3 text-slate-400">
          <span className="text-xs">{open ? "▾" : "▸"} {stepCount}</span>
        </td>
      </tr>
      {open && (
        <tr className={watched ? "bg-amber-50/40" : "bg-slate-50/60"}>
          <td colSpan={8} className="px-6 py-4">
            <IntelPanel
              visitorId={j.visitor_id}
              watched={watched}
              watchedSince={watchedSince}
              onWatchedChange={handleWatchedChange}
              timeline={events}
              timelineLoading={timelineLoading}
              timelineError={timelineError}
            />
          </td>
        </tr>
      )}
    </>
  );
}

export const Route = createFileRoute("/admin/journeys")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: JourneysPage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Visitor Journeys | Admin | Contrax" }] }),
});

function JourneysPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<JourneysResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Autopsy Acquisition funnel (owner 2026-09-05) — the distinct 9-stage view.
  const [autopsyFunnel, setAutopsyFunnel] = useState<AutopsyFunnelResult | null>(null);
  const [autopsyLoading, setAutopsyLoading] = useState(true);
  const [autopsyError, setAutopsyError] = useState("");
  // Banner rows dismissed for this browser session (admin can clear them).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchJourneys(days)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load journeys"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  // Autopsy Acquisition funnel — LIVE per-stage counts + drop-off. The funnel
  // is a distinct admin read-surface but the write side reuses the SAME
  // funnel_events plumbing (no parallel system) — the owner's exact 9 stages.
  useEffect(() => {
    let cancelled = false;
    setAutopsyLoading(true);
    setAutopsyError("");
    fetchAutopsyFunnel(days)
      .then((d) => { if (!cancelled) setAutopsyFunnel(d); })
      .catch((err) => { if (!cancelled) setAutopsyError(err instanceof Error ? err.message : "Failed to load autopsy funnel"); })
      .finally(() => { if (!cancelled) setAutopsyLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  // A watch toggle happened in a row — refresh board data in the background so
  // the highlight + server-authoritative returned-banner re-sync.
  const handleWatchedChange = (visitorId: string, watched: boolean, since: string | null) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        journeys: prev.journeys.map((j) =>
          j.visitor_id === visitorId ? { ...j, watched, watched_since: since, returned_since_view: watched ? j.returned_since_view : false } : j,
        ),
        watched_returned: watched
          ? prev.watched_returned
          : prev.watched_returned.filter((w) => w.visitor_id !== visitorId),
      };
    });
    fetchJourneys(days)
      .then((d) => setData(d))
      .catch(() => { /* keep optimistic state */ });
  };

  const bannerRows = (data?.watched_returned ?? []).filter((w) => !dismissed.has(w.visitor_id));

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-2">
            <img src="/logo.png" alt="Contrax" className="h-8 w-auto" />
          </a>
          <div className="flex items-center gap-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">Admin</span>
            <a href="/admin" className="text-sm font-medium text-slate-500 hover:text-slate-700">Admin Dashboard &rarr;</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Visitor Journeys</h1>
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
            {DAYS_OPTIONS.map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${days === d ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Watched-visitors-returned banner (server-authoritative) */}
        {bannerRows.length > 0 && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-amber-900">
                👀 {bannerRows.length} watched visitor{bannerRows.length === 1 ? "" : "s"} returned since you last viewed them
              </p>
              <button
                type="button"
                onClick={() => setDismissed(new Set((data?.watched_returned ?? []).map((w) => w.visitor_id)))}
                className="text-xs font-medium text-amber-700 underline hover:text-amber-900"
              >
                Dismiss all
              </button>
            </div>
            <ul className="mt-2 space-y-1">
              {bannerRows.map((w) => (
                <li key={w.visitor_id} className="flex flex-wrap items-center gap-2 text-sm text-amber-900">
                  <span className="font-medium">{w.label}</span>
                  {w.visitor_hash && <span className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] text-amber-600">{w.visitor_hash}</span>}
                  {w.last_activity && <span className="text-xs text-amber-700">active {timeFmt(w.last_activity)}</span>}
                  <button
                    type="button"
                    onClick={() => setDismissed((prev) => new Set([...prev, w.visitor_id]))}
                    className="text-xs text-amber-600 underline hover:text-amber-800"
                  >
                    dismiss
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-amber-700">
              Server-computed from watched_visitors.last_viewed_at — expanding a visitor's panel marks them viewed.
            </p>
          </div>
        )}

        {/* Autopsy Acquisition funnel (owner 2026-09-05 — 9 exact stages) */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Autopsy Acquisition funnel</h2>
          <p className="mb-3 text-xs text-slate-500">
            "Why did you lose?" → lost solicitation → real award found → autopsy preview → signup wall → free
            signup → complete first autopsy viewed → Radar cross-sell → paid. Stages 3–8 are attributed to
            autopsy-funnel visitors only (organic signups never count here). QA/admin/bot/test traffic excluded.
          </p>
          {autopsyError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{autopsyError}</div>
          ) : autopsyLoading || !autopsyFunnel ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-400">Loading autopsy funnel…</div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
                {autopsyFunnel.funnel.map((s, i) => (
                  <div key={s.stage} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                      {i + 1}. {s.label}
                    </p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{s.count}</p>
                    {s.dropOffPct !== null && s.count < autopsyFunnel.funnel[i - 1].count && (
                      <p className="mt-0.5 text-[10px] text-red-500">−{s.dropOffPct}% from prior</p>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[10px] text-slate-400">
                Live counts + drop-off per consecutive stage. Stage 6 reuses the existing signup-complete event;
                stage 8 reuses radar completion / the cross-sell click; stage 9 derives from live subscriptions on
                autopsy-involved accounts.
              </p>
            </div>
          )}
        </section>
        {/* Unified funnel */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Unified funnel</h2>
          <p className="mb-3 text-xs text-slate-500">
            Qualified visit → Radar completed → Signup completed → Activated → Paid. <strong>Activated</strong> = first successful
            AI Brief, saved bid, match-score action, or alert creation. QA/admin/bot/test traffic excluded.
          </p>
          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
          ) : loading || !data ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-400">Loading journeys…</div>
          ) : data.funnel.length === 0 || data.journeys.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <p className="text-sm font-medium text-slate-700">No human visitor journeys in this range.</p>
              <p className="mt-1 text-xs text-slate-400">
                Real (non-bot, non-QA) visitors with a persistent visitor id show up here as their events accumulate.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {data.funnel.map((s, i) => (
                <div key={s.stage} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{s.label}</p>
                  <p className="mt-1 text-3xl font-bold text-slate-900">{s.count}</p>
                  {s.dropOffPct !== null && s.count < data.funnel[i - 1].count && (
                    <p className="mt-0.5 text-[11px] text-red-500">−{s.dropOffPct}% from prior</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Journeys table */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-2">People</h2>
          <p className="mb-3 text-xs text-slate-500">
            Click a row to open its Visitor Intelligence panel — acquisition, approximate location, inferred interests, contracts
            viewed, lead score with reasons, and full timeline. Unauthenticated visitors are labeled by geo/behavior with a muted
            #hash; linked users = email local-part. 👀 Watch flags a visitor and highlights them here when they return.
          </p>
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-400">Loading journeys…</div>
          ) : error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
          ) : !data || data.journeys.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No journeys in this range.</div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                      <th className="px-5 py-3 font-medium">Visitor</th>
                      <th className="px-5 py-3 font-medium">Source</th>
                      <th className="px-5 py-3 font-medium">Landing</th>
                      <th className="px-5 py-3 font-medium">Radar</th>
                      <th className="px-5 py-3 font-medium">Signup</th>
                      <th className="px-5 py-3 font-medium">Activated</th>
                      <th className="px-5 py-3 font-medium">Last action</th>
                      <th className="px-5 py-3 font-medium">Steps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.journeys.map((j) => (
                      <JourneyRow key={j.visitor_id} j={j} onWatchedChange={handleWatchedChange} />
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-5 py-3 text-[10px] text-slate-400 border-t border-slate-100">
                Panel data is fetched from stored funnel_events + page_views when you expand a row — nothing fabricated, and
                collapsed rows stay lightweight. Location is approximate / IP-derived; interests are inferred from behavior.
                Some rows predate per-visitor id tracking (recorded without a visitor_id) and aren't shown.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
