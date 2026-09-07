/**
 * RADAR-LEADS MATCH-ALERT ACQUISITION FUNNEL (owner 2026-09-06, ratified rev
 * 180; admin read surface 2026-09-07).
 *
 * The anonymous-lead match-alert channel:
 *
 *   anonymous Radar visitor completes a scan → voluntarily leaves an email
 *   ("Send My Matches →") → confirmation email proves the address →
 *   periodic sender emails ONLY real NEW matches → the lead clicks a bid's
 *   "View opportunity →" CTA (PII-safe redirect) → signup → Radar used → paid.
 *
 * This module is to the radar-leads channel what autopsy-funnel.ts is to the
 * Award Autopsy acquisition funnel: the single place that owns the owner-exact
 * 7 stages and their event mapping, reusing the existing funnel_events
 * plumbing (NO parallel system).
 *
 *   Stage 1 «capture»        — radar_lead_captured  (fired client-side on the
 *                              /radar Capture form submit — existing event).
 *   Stage 2 «confirmed»      — email_confirmed      (fired server-side when
 *                              /api/radar/lead-confirm flips a pending lead to
 *                              confirmed — NEW event, this delegation).
 *   Stage 3 «alert sent»     — radar_alert_sent     (fired by the periodic
 *                              sender after a successful email — existing).
 *   Stage 4 «click»          — opportunity_clicked  (fired by the PII-safe
 *                              click redirect — NEW event, this delegation).
 *   Stage 5 «signup»         — REUSED signup_success, attributed ONLY to
 *                              radar-funnel visitors (same rule as the autopsy
 *                              funnel's stage 6: an organic signup with no
 *                              radar-leads involvement never counts here).
 *   Stage 6 «radar used»     — REUSED radar_scan_complete, attributed to
 *                              radar-funnel visitors (completeness marker).
 *   Stage 7 «paid»           — derived from users.subscription_status = 'active'
 *                              on accounts whose visitor is radar-funnel-involved.
 *
 * Stages 1–4 are counted per-event (DISTINCT visitor_id each); stages 5–7 use
 * the funnel-involved visitor set (autopsy-funnel pattern) so reused events
 * never double-count organic traffic.
 */
import { sql } from "~/db";

/** Owner-exact 7 stages, in order (labels are owner-exact too). */
export const RADAR_LEADS_FUNNEL_STAGES = [
  { stage: "capture", label: "Capture" },
  { stage: "confirmed", label: "Confirmed" },
  { stage: "alert_sent", label: "Alert sent" },
  { stage: "click", label: "Click" },
  { stage: "signup", label: "Signup" },
  { stage: "radar_used", label: "Radar used" },
  { stage: "paid", label: "Paid" },
] as const;

/** The radar-leads channel's OWN events (stages 1–4). */
export const RADAR_LEADS_EVENTS = [
  "radar_lead_captured", // 1 — Capture form submitted on /radar
  "email_confirmed", // 2 — confirmation link opened (lead-confirm)
  "radar_alert_sent", // 3 — periodic match-alert email accepted by Resend
  "opportunity_clicked", // 4 — "View opportunity →" CTA clicked (redirect)
] as const;

/** Reused existing events — no duplicates (mirrors the autopsy funnel). */
export const RADAR_LEADS_SIGNUP_EVENT = "signup_success";
export const RADAR_LEADS_RADAR_COMPLETE_EVENT = "radar_scan_complete";

/** Masked-lead table reveals profile keys ONLY — never the raw email except
 *  as a masked display string, and never the unsubscribe_token. */
export interface RadarLeadRow {
  id: number;
  maskedEmail: string;
  trade: string | null;
  cert: string | null;
  sizePref: string | null;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  lastAlertedAt: string | null;
  clickCount: number;
  lastClickedAt: string | null;
  createdAt: string;
}

export interface RadarLeadsFunnelStage {
  stage: string;
  label: string;
  count: number;
  dropOffPct: number | null;
}

export interface RadarLeadsFunnelResult {
  rangeDays: number;
  from: string;
  to: string;
  totalLeads: number;
  funnel: RadarLeadsFunnelStage[];
  leads: RadarLeadRow[];
}

/** Mask an email — first char + domain only (never the full address on any
 *  admin surface; matches visitor-intel's masking discipline). */
export function maskLeadEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  if (!e || !e.includes("@")) return null;
  const [local, domain] = e.split("@");
  if (!local || !domain) return null;
  return `${local.slice(0, 1)}•••@${domain}`;
}

function pct(n: number, d: number): number | null {
  if (d <= 0) return null;
  const p = Math.round((1 - n / d) * 100);
  return p > 0 ? p : 0;
}

export function emptyRadarLeadsFunnel(days: number): RadarLeadsFunnelResult {
  return {
    rangeDays: days,
    from: "",
    to: "",
    totalLeads: 0,
    funnel: RADAR_LEADS_FUNNEL_STAGES.map((s) => ({
      stage: s.stage,
      label: s.label,
      count: 0,
      dropOffPct: null,
    })),
    leads: [],
  };
}