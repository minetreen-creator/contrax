/**
 * Auto-Pilot Radar (owner 2026-11-09, "I want all the ideas"): instead of a member searching every
 * day, Contrax reads each new bid that matches their profile and says, for THEIR business:
 *   - fit (0-100),
 *   - whether they are eligible (the set-aside against their certifications, by rule, never by AI),
 *   - what qualifications they are missing,
 *   - pursue, pass or partner, with one plain sentence why.
 * The 6 AM email leads with the strong ones. PURE: rules, prompt, parsing and the email block.
 * The AI call and the cache live in autopilot.server.ts.
 */

export type AutopilotDecision = "pursue" | "partner" | "pass";
export type Eligibility = "yes" | "no";

export interface AutopilotProfile {
  businessName?: string | null;
  industry?: string | null;
  naicsCodes?: string[];
  serviceCategories?: string[];
  locations?: string[];
  certifications?: string[];
  licenses?: string[];
  yearsInBusiness?: number | null;
  employeeCount?: number | null;
  typicalContractValue?: string | null;
  pastPerformance?: string | null;
  capabilityStatement?: string | null;
}

export interface AutopilotBid {
  bid_id: number;
  title: string;
  agency?: string | null;
  location?: string | null;
  due_date?: string | null;
  set_aside?: string | null;
  description?: string | null;
}

export interface AutopilotVerdict {
  bid_id: number;
  fit: number;
  eligible: Eligibility;
  eligibilityReason: string;
  missing: string[];
  decision: AutopilotDecision;
  why: string;
}

/** Most bids scored per member per morning (cost cap). */
export const AUTOPILOT_DAILY_CAP = 12;
/** A "strong" pick: worth leading the email with. */
export const AUTOPILOT_STRONG_FIT = 70;
/** Most picks shown at the top of one email. */
export const AUTOPILOT_EMAIL_MAX = 5;

const CERT_RULES: { re: RegExp; cert: string[]; label: string }[] = [
  { re: /8\s*\(\s*a\s*\)|\b8a\b|8an/, cert: ["8a"], label: "8(a)" },
  { re: /sdvosb|service[- ]disabled/, cert: ["sdvosb"], label: "service-disabled veteran-owned (SDVOSB)" },
  { re: /edwosb|wosb|women[- ]owned/, cert: ["wosb"], label: "women-owned (WOSB)" },
  { re: /hubzone/, cert: ["hubzone"], label: "HUBZone" },
  { re: /\bvosb\b|veteran[- ]owned/, cert: ["vosb", "sdvosb"], label: "veteran-owned (VOSB)" },
];

/**
 * Eligibility by rule: a set-aside that names a certification needs that certification; a
 * small-business, unrestricted or unlisted set-aside is open to a small business. PURE.
 */
export function eligibilityFor(setAside: string | null | undefined, certifications: string[] = []): { eligible: Eligibility; reason: string } {
  const s = String(setAside ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const have = new Set(certifications.map((c) => c.toLowerCase()));
  for (const rule of CERT_RULES) {
    if (rule.re.test(s)) {
      return rule.cert.some((c) => have.has(c))
        ? { eligible: "yes", reason: `Set aside for ${rule.label} businesses, and you have that certification.` }
        : { eligible: "no", reason: `Set aside for ${rule.label} businesses. You'd need that certification, or a partner who has it.` };
    }
  }
  if (!s) return { eligible: "yes", reason: "No set-aside listed, so any qualified business can bid. Confirm in the notice." };
  if (/small business|sba/.test(s)) return { eligible: "yes", reason: "Small-business set-aside." };
  return { eligible: "yes", reason: "Open competition." };
}

const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const list = (a: string[] | undefined, n = 12) => (a ?? []).filter(Boolean).slice(0, n).join(", ") || "not set";

/** The messages for one bid. PURE. */
export function autopilotMessages(profile: AutopilotProfile, bid: AutopilotBid, eligibility: { eligible: Eligibility; reason: string }) {
  const company = [
    `Business: ${clip(profile.businessName, 80) || "a small business"}`,
    `Industry / services: ${clip(profile.industry, 80) || "not set"}; ${list(profile.serviceCategories)}`,
    `NAICS codes: ${list(profile.naicsCodes)}`,
    `Works in: ${list(profile.locations)}`,
    `Certifications: ${list(profile.certifications)}`,
    `Licenses: ${list(profile.licenses)}`,
    `Years in business: ${profile.yearsInBusiness ?? "unknown"}; employees: ${profile.employeeCount ?? "unknown"}; typical contract size: ${clip(profile.typicalContractValue, 40) || "unknown"}`,
    `Past performance: ${clip(profile.pastPerformance, 600) || "none given"}`,
    `Capability statement: ${clip(profile.capabilityStatement, 600) || "none given"}`,
  ].join("\n");
  const notice = [
    `Title: ${clip(bid.title, 200)}`,
    `Buyer: ${clip(bid.agency, 120) || "unknown"}`,
    `Place: ${clip(bid.location, 80) || "unknown"}`,
    `Due: ${clip(bid.due_date, 30) || "unknown"}`,
    `Set-aside: ${clip(bid.set_aside, 80) || "none listed"}`,
    `Eligibility (already decided by rule, do not change): ${eligibility.eligible === "yes" ? "eligible" : "not eligible"}: ${eligibility.reason}`,
    `Description: ${clip(bid.description, 2000) || "none"}`,
  ].join("\n");
  return [
    {
      role: "system",
      content:
        "You advise a small business on one government bid. Judge only from the facts given; never invent requirements, numbers or past work. " +
        'Return JSON: {"fit": 0-100, "decision": "pursue"|"partner"|"pass", "why": one plain sentence under 30 words, "missing": up to 4 short items the business lacks for THIS job (licenses, bonding, past work of this size, location, staffing, equipment, a certification), [] if none}. ' +
        "fit = how well the job matches what the business does, where it works and its size. pursue = good fit and eligible. " +
        "partner = good fit but not eligible or too big alone, so team with a prime or a certified firm. pass = poor fit.",
    },
    { role: "user", content: `THE BUSINESS\n${company}\n\nTHE BID\n${notice}` },
  ];
}

/** Read the model's JSON into a safe verdict; rules win over the model. PURE. */
export function parseAutopilotVerdict(raw: string, bid: AutopilotBid, eligibility: { eligible: Eligibility; reason: string }): AutopilotVerdict | null {
  let j: Record<string, unknown>;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    j = JSON.parse(m ? m[0] : raw);
  } catch {
    return null;
  }
  const fitNum = Math.round(Number(j.fit));
  if (!Number.isFinite(fitNum)) return null;
  const fit = Math.max(0, Math.min(100, fitNum));
  let decision: AutopilotDecision = j.decision === "pursue" || j.decision === "partner" || j.decision === "pass" ? j.decision : fit >= AUTOPILOT_STRONG_FIT ? "pursue" : "pass";
  // A business that is not eligible cannot pursue it alone.
  if (eligibility.eligible === "no" && decision === "pursue") decision = "partner";
  if (fit < 40) decision = "pass";
  const why = clip(j.why, 220);
  const missing = (Array.isArray(j.missing) ? j.missing : []).map((x) => clip(x, 80)).filter(Boolean).slice(0, 4);
  return { bid_id: bid.bid_id, fit, eligible: eligibility.eligible, eligibilityReason: eligibility.reason, missing, decision, why };
}

/** The picks worth leading the email with, best first. PURE. */
export function strongPicks(verdicts: AutopilotVerdict[]): AutopilotVerdict[] {
  return verdicts
    .filter((v) => v.decision !== "pass" && v.fit >= AUTOPILOT_STRONG_FIT)
    .sort((a, b) => (a.decision === b.decision ? b.fit - a.fit : a.decision === "pursue" ? -1 : 1))
    .slice(0, AUTOPILOT_EMAIL_MAX);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const DECISION_LABEL: Record<AutopilotDecision, { text: string; color: string; bg: string }> = {
  pursue: { text: "PURSUE", color: "#065f46", bg: "#d1fae5" },
  partner: { text: "PARTNER", color: "#1e40af", bg: "#dbeafe" },
  pass: { text: "PASS", color: "#475569", bg: "#f1f5f9" },
};

/** The email block: Auto-Pilot's picks for this member, at the top of the 6 AM email. PURE. */
export function autopilotEmailHtml(picks: { verdict: AutopilotVerdict; title: string; agency?: string | null; url: string; due?: string | null }[]): string {
  if (!picks.length) return "";
  const rows = picks
    .map(({ verdict: v, title, agency, url, due }) => {
      const d = DECISION_LABEL[v.decision];
      const dueText = due ? new Date(due).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
      return `
<tr><td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;">
  <span style="display:inline-block;background:${d.bg};color:${d.color};font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;letter-spacing:0.04em;">${d.text}</span>
  <span style="margin-left:6px;color:#0f172a;font-size:12px;font-weight:700;">${v.fit}% fit</span>
  <a href="${esc(url)}" style="display:block;margin-top:6px;color:#2563eb;font-size:15px;font-weight:600;text-decoration:none;">${esc(title)}</a>
  <p style="margin:4px 0 0;color:#6b7280;font-size:12px;">${esc([agency, dueText ? `Due ${dueText}` : null].filter(Boolean).join(" · "))}</p>
  <p style="margin:8px 0 0;color:#111827;font-size:13px;line-height:1.5;">${esc(v.why)}</p>
  <p style="margin:6px 0 0;color:#374151;font-size:12px;line-height:1.5;"><strong>Eligibility:</strong> ${esc(v.eligibilityReason)}</p>
  ${v.missing.length ? `<p style="margin:4px 0 0;color:#374151;font-size:12px;line-height:1.5;"><strong>You may need:</strong> ${esc(v.missing.join("; "))}</p>` : ""}
</td></tr>`;
    })
    .join("\n");
  return `<!-- Auto-Pilot picks (owner 2026-11-09) -->
<tr><td style="padding:8px 32px 16px;">
  <p style="margin:0 0 4px;color:#0f172a;font-size:14px;font-weight:800;">⭐ Auto-Pilot: today's best fits for your business</p>
  <p style="margin:0 0 10px;color:#4b5563;font-size:12px;line-height:1.5;">Contrax read each new bid against your profile. Eligibility comes from the set-aside and your certifications; fit and next steps are an AI read of the notice, so check the details before you bid.</p>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #fde68a;border-radius:8px;overflow:hidden;background:#fffdf5;">${rows}</table>
</td></tr>`;
}
