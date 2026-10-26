import { StoryFunnel } from "~/components/StoryFunnel";
import { LearnFunnel } from "~/components/LearnFunnel";
import { RecompetesFunnel } from "~/components/RecompetesFunnel";
import { countryLabel, visitorCountry } from "~/lib/visitor-geo";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect, type ReactNode } from "react";
import { getCurrentUser } from "~/lib/auth";
import {
  AdminHeader,
  AdminTabs,
  MrrScoreboard,
} from "~/components/AdminShared";

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
 * PII: unauthenticated visitors → geo/behavioral display name ("Dallas, TX ·
 * Desktop", "Direct Lead · /pricing") with a muted #hash badge; linked users →
 * "local-part@…". Location is always labeled "approximate / IP-derived";
 * interests are always labeled "inferred". Full IPs appear only inside this
 * authenticated admin panel; every detail access is audited server-side. Full
 * emails and raw user-agent strings are never shown. QA/admin/bot/test traffic
 * is excluded server-side.
 */

interface TimelineItem { t: string; label: string; kind: "page" | "event"; }
interface JourneyBadge { key: "pricing" | "brief"; label: string; }
/** Rule-based operator guidance (owner 2026-09-06) — computed server-side. */
interface ConversionOpportunity {
  reasons: { points: number; reason: string }[];
  best_next: string;
  obstacle: string;
  cta: string;
  channel: "outreach" | "onsite";
}
interface Journey {
  visitor_id: string;
  label: string;
  visitor_hash: string | null;
  source: string | null;
  source_label?: string | null;
  landing_page: string | null;
  city: string | null;
  region: string | null;
  country?: string | null;
  paid_click?: boolean;
  /** Browsers folded into this row (ad app + Safari/Chrome on the same phone). */
  same_device_browsers?: number;
  first_ip?: string | null;
  last_ip?: string | null;
  /** This visitor's IP is on the site-wide blocklist (src/lib/ip-block.server.ts). */
  ip_blocked?: boolean;
  device_type: string | null;
  browser_label: string | null;
  radar: boolean;
  engaged?: boolean;
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
  /** Board-side lead score (same heuristic as the intel panel; owner 2026-09-06). */
  lead_score?: { score: number; level: "Very High" | "High" | "Medium" | "Low"; reasons: { points: number; reason: string }[]; automated?: string | null };
  /** Present ONLY on High / Very High rows. */
  conversion_opportunity?: ConversionOpportunity;
}
interface FunnelStage { stage: string; label: string; count: number; dropOffPct: number | null; }
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
  /** Max: asked a question / tried the product (Radar or Max) / gave Max an email. */
  maxFunnel?: { askedMax: number; triedProduct: number; emailFromMax: number };
  journeys: Journey[];
  watched_returned: WatchedReturned[];
}

// ── Visitor Intelligence payload (mirrors src/lib/visitor-intel.ts) ──────────
interface ScoreReason { points: number; reason: string; }
interface LeadScore { score: number; level: "Very High" | "High" | "Medium" | "Low"; reasons: ScoreReason[]; automated?: string | null; }
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
  network: { first_ip: string | null; last_ip: string | null; changed: boolean; retention_days: 90 };
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
    size: string | null; size_label: string | null; matched_count: number | null; shown_count: number | null; email_captured: boolean;
    alert_status: "pending" | "confirmed" | "unsubscribed" | null;
    source: "email_save" | "anonymous_scan";
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
async function fetchTimeline(visitorId: string): Promise<TimelineItem[]> {
  const res = await fetch(`/api/admin/journeys-timeline?visitor_id=${encodeURIComponent(visitorId)}`);
  if (!res.ok) throw new Error("Timeline unavailable — tracking data could not be loaded. This does not mean the visitor had zero activity.");
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

function timeFmt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function dayFmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const BADGE_STYLES: Record<JourneyBadge["key"], string> = {
  pricing: "bg-amber-100 text-amber-800",
  brief: "bg-blue-100 text-blue-700",
};

function Badges({ badges }: { badges: JourneyBadge[] }) {
  if (!badges || badges.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <span key={b.key} className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${BADGE_STYLES[b.key] ?? "bg-slate-100 text-slate-600"}`}>
          {b.label}
        </span>
      ))}
    </span>
  );
}

/** 🎯 Conversion Opportunity panel (owner 2026-09-06) — rendered ONLY for High
 * / Very High intent rows. All four sections are rule-based and read-side: they
 * explain what the row already knows, suggest the single best next step, name
 * the obstacle standing between this visitor and conversion, and give the
 * operator a concrete on-site CTA copy suggestion. Never urgency/pressure
 * language — the server-side copy forbids it. */
function OpportunityPanel({ opp, score, level }: { opp: ConversionOpportunity; score: number; level: string }) {
  return (
    <section className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">🎯 Conversion Opportunity</p>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${LEVEL_STYLES[level as LeadScore["level"]]}`}>
          {LEVEL_LABEL[level as LeadScore["level"]]} · {score}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-rose-600/80">
        Rule-based guidance from this visitor's observed actions — what to do next, what's in the way, and a CTA to try.
      </p>
      <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${opp.channel === "outreach" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>
        {opp.channel === "outreach" ? "Direct outreach available" : "On-site action only"}
      </span>

      <div className="mt-3 space-y-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-800">Why they're hot</p>
          {opp.reasons.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">High intent score with no explicit reason rows — score driven by the level itself.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {opp.reasons.map((r, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-slate-700">✓ {r.reason}</span>
                  <span className="shrink-0 rounded bg-rose-100 px-1.5 py-0.5 font-mono text-[11px] text-rose-700">+{r.points}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-800">Best next conversion</p>
          <p className="mt-1 text-sm text-slate-800">{opp.best_next}</p>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-800">Current obstacle</p>
          <p className="mt-1 text-sm text-slate-700">{opp.obstacle}</p>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-800">Recommended on-site CTA</p>
          <p className="mt-1 inline-flex rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-800">{opp.cta}</p>
        </div>
      </div>
    </section>
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
  "Very High": "bg-rose-100 text-rose-700",
  High: "bg-amber-100 text-amber-800",
  Medium: "bg-yellow-100 text-yellow-800",
  Low: "bg-slate-100 text-slate-500",
};
const LEVEL_LABEL: Record<LeadScore["level"], string> = {
  "Very High": "🔥 Very High",
  High: "High",
  Medium: "Medium",
  Low: "Low",
};

/** The expanded Visitor Intelligence panel (intel + timeline, lazily fetched). */
function IntelPanel({
  visitorId, onIntelLoaded, timeline, timelineLoading, timelineError, summarySteps,
}: {
  visitorId: string;
  onIntelLoaded: (intel: VisitorIntel) => void;
  timeline: TimelineItem[] | null;
  timelineLoading: boolean;
  timelineError: string;
  summarySteps: number;
}) {
  const [intel, setIntel] = useState<VisitorIntel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchIntel(visitorId)
      .then((d) => { if (!cancelled) { setIntel(d); onIntelLoaded(d); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load visitor intel"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visitorId, onIntelLoaded]);

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

  const { known_identity, acquisition, location, network, device, engagement, interests, contracts_viewed, radar_profile, lead_score, conversion_signals } = intel;
  const geoLine = [location.city, location.region].filter(Boolean).join(", ");

  return (
    <div className="space-y-3">
      {/* Header: identity + lead score */}
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
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Lead score (heuristic)</p>
            <p className="flex items-baseline justify-end gap-1.5">
              <span className="text-2xl font-bold text-slate-900">{lead_score.score}</span>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${LEVEL_STYLES[lead_score.level]}`}>{LEVEL_LABEL[lead_score.level]} intent</span>
            </p>
            {lead_score.automated && (
              <p className="mt-1 inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">🤖 Likely automated</p>
            )}
          </div>
        </div>
      </div>

      {/* Why this score — explicit, honest reasons */}
      <PanelSection title="Why this score" hint="Every point comes from a real, observed action — nothing modeled.">
        {lead_score.automated ? (
          <p className="text-sm text-slate-600">
            Scored 0: {lead_score.automated}. This is most likely a bot, crawler or link checker, not a lead.
          </p>
        ) : lead_score.reasons.length === 0 ? (
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
              <KV k="First IP" v={network.first_ip ?? "Unavailable"} mono />
              <KV k="Latest IP" v={network.last_ip ?? "Unavailable"} mono />
              <KV k="IP changed" v={network.changed ? "Yes" : "No"} />
              <KV k="Device" v={device.device_type ? <span className="capitalize">{device.device_type}</span> : "—"} />
              <KV k="Browser" v={device.browser_label ?? "—"} />
            </div>
            <p className="mt-2 text-[10px] text-slate-400">
              Admin-only · access logged · raw network identifiers retained up to {network.retention_days} days.
            </p>
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
          hint={radar_profile
            ? radar_profile.alert_status
              ? "Criteria from a Radar scan; the visitor signed up for match alerts."
              : radar_profile.email_captured
                ? "Criteria voluntarily saved through 'Save your matches'."
                : "Non-contact criteria captured from a completed Radar scan."
            : "No server-side Radar profile saved for this visitor."}
        >
          {radar_profile ? (
            <>
              <KV k="Trade / NAICS" v={radar_profile.trade || "—"} />
              <KV k="State" v={radar_profile.state || "Nationwide"} />
              <KV k="Certification" v={radar_profile.cert_label ?? "—"} />
              <KV k="Size" v={radar_profile.size_label ?? "—"} />
              {radar_profile.matched_count !== null && (
                <KV
                  k="Matches found"
                  v={radar_profile.shown_count !== null && radar_profile.shown_count < radar_profile.matched_count
                    ? `${radar_profile.matched_count} (${radar_profile.shown_count} shown free)`
                    : String(radar_profile.matched_count)}
                />
              )}
              {radar_profile.alert_status && (
                <p className="mt-1 text-[11px] text-slate-500">
                  {radar_profile.alert_status === "confirmed"
                    ? "Email captured via match alerts (confirmed)."
                    : radar_profile.alert_status === "pending"
                      ? "Email captured via match alerts (not yet confirmed)."
                      : "Signed up for match alerts, since unsubscribed."}{" "}
                  <a href="/admin/radar-leads" className="underline">See Radar leads</a>
                </p>
              )}
              {radar_profile.email_captured && !radar_profile.alert_status && <p className="mt-1 text-[11px] text-slate-400">Via a voluntary "Save your matches" submission.</p>}
              {!radar_profile.email_captured && <p className="mt-1 text-[11px] text-slate-400">Anonymous scan criteria only — no contact details captured.</p>}
            </>
          ) : (
            <p className="text-sm text-slate-400">No criteria were stored server-side.</p>
          )}
        </PanelSection>
      </div>

      {/* Timeline — merged as one more section of the panel */}
      {!timelineLoading && !timelineError && timeline !== null && summarySteps > timeline.length && timeline.length > 0 && (
        <p className="text-xs text-amber-700">Partial history: summary reports {summarySteps} steps, but only {timeline.length} detailed records are available.</p>
      )}
      <PanelSection title={`Timeline · ${timelineLoading ? "…" : `${timeline?.length ?? 0} ${(timeline?.length ?? 0) === 1 ? "step" : "steps"}`}`}>
        {timelineLoading ? (
          <p className="text-sm text-slate-400">Loading timeline…</p>
        ) : timelineError ? (
          <p className="text-sm text-red-600">{timelineError}</p>
        ) : timeline && timeline.length === 0 ? (
          <p className="text-sm text-amber-700">{summarySteps > 0 ? `Summary recorded ${summarySteps} steps, but detailed history is unavailable. Do not interpret this as no activity.` : "No tracked events."}</p>
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

/** One phrase for how far a visitor got (owner 2026-10-06: one line per row). */
function didLabel(j: Journey): string {
  if (j.paid) return "Paying customer";
  if (j.activated) return "Signed up and used it";
  if (j.signup === "Success") return "Signed up";
  if (j.signup === "Started" || j.signup === "Abandoned") return "Started signup";
  if (j.radar) return "Ran a Radar scan";
  if (j.signup === "Viewed") return "Looked at signup";
  // page_engaged (owner 2026-10-06): read 15+ s or scrolled halfway vs. bounced.
  if (j.engaged) return "Stayed and read";
  return "Browsed";
}

function JourneyRow({ j }: { j: Journey }) {
  const [summaryIntel, setSummaryIntel] = useState<VisitorIntel | null>(null);
  const [open, setOpen] = useState(false);
  const [oppOpen, setOppOpen] = useState(false);
  // Lazy per-expanded-row fetches — collapsed rows never fetch. Kept in local
  // state so toggling closed→open again doesn't re-fetch.
  const [events, setEvents] = useState<TimelineItem[] | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");
  const [blocked, setBlocked] = useState(!!j.ip_blocked);
  const [blocking, setBlocking] = useState(false);
  const ip = j.last_ip ?? j.first_ip ?? null;
  const toggleBlock = async () => {
    if (blocking) return;
    if (!blocked && !window.confirm(`Block ${ip ?? "this visitor's IP"} from the whole site? Anyone on that address gets "Access denied." Takes effect within a minute.`)) return;
    setBlocking(true);
    try {
      const res = await fetch("/api/admin/track-visitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vid: j.visitor_id, action: blocked ? "unblock" : "block", note: "blocked from Visitors board" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not save the block");
      setBlocked(!!d.blocked);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not save the block");
    } finally {
      setBlocking(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (events !== null) return; // already loaded once
    let cancelled = false;
    setTimelineLoading(true);
    setTimelineError("");
    fetchTimeline(j.visitor_id)
      .then((ev) => { if (!cancelled) setEvents(ev); })
      .catch((err) => { if (!cancelled) setTimelineError(err instanceof Error ? err.message : "Timeline unavailable"); })
      .finally(() => { if (!cancelled) setTimelineLoading(false); });
    return () => { cancelled = true; };
  }, [open, events, j.visitor_id]);

  // 🎯 Conversion Opportunity (owner 2026-09-06): the row payload carries the
  // server-computed guidance ONLY for High / Very High intent rows — Low /
  // Medium rows get neither the button nor the panel (unchanged appearance).
  const opp = j.conversion_opportunity;

  // Retain the reconciled detail summary after collapse; never reduce a
  // lifetime count when detail rows are excluded or unavailable.
  const stepCount = Math.max(j.steps, summaryIntel?.engagement.steps ?? 0);
  const landingPage = summaryIntel ? summaryIntel.engagement.first_path : j.landing_page;
  const radarUsed = summaryIntel ? summaryIntel.conversion_signals.radar_used : j.radar;
  // Non-US visitors get a small country tag (owner 2026-10-06 ad check).
  const geo = visitorCountry(j.country, j.region, j.city);
  const abroad = geo && geo.code !== "US" ? countryLabel(geo) : null;

  return (
    <>
      <tr
        onClick={() => setOpen((o) => !o)}
        className="border-t cursor-pointer transition-colors border-slate-50 hover:bg-blue-50/40"
      >
        <td className="px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-slate-800">{j.label}</span>
            {abroad && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">{abroad}</span>}
            {ip && (
              <button
                type="button"
                disabled={blocking}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleBlock();
                }}
                title={blocked ? "Let this IP back onto the site" : "Block this visitor's IP from the whole site"}
                className={blocked
                  ? "rounded-full border border-rose-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-50"
                  : "rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:border-rose-300 hover:text-rose-700"}
              >
                {blocking ? "…" : blocked ? "⛔ Blocked · undo" : "Block"}
              </button>
            )}
            {opp && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(true);
                  setOppOpen((o) => !o);
                }}
                title="What to do next with this visitor"
                className="rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-100"
              >
                🎯 Next step
              </button>
            )}
          </div>
        </td>
        <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{j.source_label ? <span className="font-medium text-blue-700">{j.source_label}</span> : j.source ? <span className="capitalize">{j.source}</span> : "direct"}{(j.same_device_browsers ?? 1) > 1 && <span className="ml-1 text-xs text-slate-400" title="Same phone or computer seen in two browsers (the ad app's browser, then Safari or Chrome), counted once">· {j.same_device_browsers} browsers</span>}</td>
        <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">{didLabel(j)}</td>
        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
          {j.last_activity ? timeFmt(j.last_activity) : "—"}
        </td>
        <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">
          <span className="text-xs">{open ? "▾" : "▸"} {stepCount}</span>
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50/60">
          <td colSpan={5} className="px-6 py-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span>Landed on <span className="font-mono">{landingPage ?? "—"}</span></span>
                <span>· Radar {radarUsed ? "yes" : "no"} · Signup {j.signup.toLowerCase()} · Activated {j.activated ? "yes" : "no"}</span>
                <span className="font-mono">· IP {j.last_ip ?? j.first_ip ?? "unavailable"}</span>
                <Badges badges={j.badges} />
              </div>
              {oppOpen && opp && j.lead_score && (
                <OpportunityPanel opp={opp} score={j.lead_score.score} level={j.lead_score.level} />
              )}
              <IntelPanel
                visitorId={j.visitor_id}
                onIntelLoaded={setSummaryIntel}
                timeline={events}
                timelineLoading={timelineLoading}
                timelineError={timelineError}
                summarySteps={j.steps}
              />
            </div>
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

  // Likely-automated visitors (lead score flag, owner 2026-10-02) are hidden
  // from People by default.
  const [showAutomated, setShowAutomated] = useState(false);
  const isAutomated = (j: Journey) => !!j.lead_score?.automated;
  const automatedCount = (data?.journeys ?? []).filter(isAutomated).length;
  const people = (data?.journeys ?? []).filter((j) => showAutomated || !isAutomated(j));

  return (
    <div className="admin-console min-h-screen bg-slate-50">
      <AdminHeader scoreboard={<MrrScoreboard />} />

      <main className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        <AdminTabs active="visitors" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-slate-900">Visitors</h1>
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
            {DAYS_OPTIONS.map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${days === d ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Unified funnel */}
        <section>
          <h2 className="text-base font-semibold text-slate-900 mb-2">Funnel <span className="text-xs font-normal text-slate-400">· people only: likely bots are not counted, and one phone seen in two browsers counts once</span></h2>
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
                <div key={s.stage} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs font-medium text-slate-500">{s.label}</p>
                  <p className="mt-0.5 text-2xl font-bold text-slate-900">{s.count}</p>
                  {s.dropOffPct !== null && s.count < data.funnel[i - 1].count && (
                    <p className="mt-0.5 text-[11px] text-red-500">−{s.dropOffPct}% from previous step</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {data?.maxFunnel && data.funnel.length > 0 ? (
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">
              Max <span className="text-xs font-normal text-slate-400">· the homepage AI; asking him counts as trying the product, like a Radar search</span>
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: "Asked Max a question", count: data.maxFunnel.askedMax },
                { label: "Tried the product (Radar or Max)", count: data.maxFunnel.triedProduct },
                { label: "Gave Max an email", count: data.maxFunnel.emailFromMax },
              ].map((m) => (
                <div key={m.label} className="rounded-xl border border-cyan-200 bg-white px-4 py-3">
                  <p className="text-xs font-medium text-slate-500">{m.label}</p>
                  <p className="mt-0.5 text-2xl font-bold text-slate-900">{m.count}</p>
                  {data.funnel[0]?.count ? (
                    <p className="mt-0.5 text-[11px] text-slate-500">{Math.round((m.count / data.funnel[0].count) * 1000) / 10}% of visitors</p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <LearnFunnel days={days} />
        <RecompetesFunnel days={days} />
        <StoryFunnel days={days} />

        {/* Journeys table */}
        <section>
          <h2 className="text-base font-semibold text-slate-900 mb-2">People <span className="text-xs font-normal text-slate-400">· click a row for details</span></h2>
          {automatedCount > 0 && (
            <label className="mb-3 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={showAutomated} onChange={(e) => setShowAutomated(e.target.checked)} />
              <span title="3+ sessions within 2 minutes, 6+ pages within 1 minute, an email link scanner, or a data-center town">Show likely bots ({automatedCount})</span>
            </label>
          )}
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-400">Loading journeys…</div>
          ) : error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
          ) : !data || people.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-400">
              {data && data.journeys.length > 0 ? "Only likely automated visitors in this range." : "No journeys in this range."}
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400">
                      <th className="px-4 py-2 font-medium">Visitor</th>
                      <th className="px-4 py-2 font-medium">Source</th>
                      <th className="px-4 py-2 font-medium">Got to</th>
                      <th className="px-4 py-2 font-medium">Last active</th>
                      <th className="px-4 py-2 font-medium">Steps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((j) => (
                      <JourneyRow key={j.visitor_id} j={j} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
