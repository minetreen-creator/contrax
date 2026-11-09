/**
 * Sub Finder (owner 2026-11-09, "Pre-Bid Partner Ping"; name chosen "Sub Finder"): a prime working
 * a bid or megaproject finds certified subs and sends a Trade Package. NO COLD OUTREACH (owner rule):
 *  - Contrax emails a quote request only to members who chose "List my business for primes", and
 *    every such email has a one-click way to stop;
 *  - for anyone else, the prime shares the Trade Package link themselves (their own text or email);
 *    Contrax never holds or messages those people.
 * Certifications are self-reported by members and are labelled that way. PURE.
 */
import { CERTIFICATIONS } from "~/lib/certifications";
import { profileTradeSlug } from "~/lib/roadmap";

export const SUB_FINDER_NAME = "Sub Finder";
export const TRADE_PACKAGE_NAME = "Trade Package";
/** Quote requests one prime may send per package (protects listed members from floods). */
export const MAX_QUOTE_REQUESTS_PER_PACKAGE = 10;
/** Responses one package accepts per day (spam guard). */
export const MAX_RESPONSES_PER_PACKAGE_PER_DAY = 25;

export const SUB_FINDER_CERTS: { value: string; label: string }[] = CERTIFICATIONS.map((c) => ({ value: c.value, label: c.shortLabel ?? c.label }));

export interface ListedSub {
  profileId: number;
  businessName: string;
  trade: string | null;
  states: string[];
  certifications: string[];
  yearsInBusiness: number | null;
  services: string[];
}

/** Listed members that fit the trade, state and certification asked for, best first. PURE. */
export function matchListedSubs(subs: ListedSub[], q: { trade: string | null; state: string | null; cert: string | null }): ListedSub[] {
  return subs
    .filter((s) => !q.trade || s.trade === q.trade)
    .filter((s) => !q.state || s.states.length === 0 || s.states.includes(q.state))
    .filter((s) => !q.cert || s.certifications.includes(q.cert))
    .sort((a, b) => Number(b.states.includes(q.state ?? "")) - Number(a.states.includes(q.state ?? "")) || (b.yearsInBusiness ?? 0) - (a.yearsInBusiness ?? 0) || a.businessName.localeCompare(b.businessName));
}

/** A member profile row as a ListedSub. PURE. */
export function toListedSub(row: { id: number; business_name: string | null; industry: string | null; service_categories: string[]; naics_codes: string[]; states: string[]; certifications: string[]; years_in_business: number | null }): ListedSub {
  return {
    profileId: row.id,
    businessName: (row.business_name ?? "").trim() || "A Contrax member",
    trade: profileTradeSlug({ industry: row.industry, services: row.service_categories, naics: row.naics_codes }),
    states: row.states,
    certifications: row.certifications.map((c) => c.toLowerCase()),
    yearsInBusiness: row.years_in_business,
    services: row.service_categories.slice(0, 4),
  };
}

export interface PackageInput {
  trade: string;
  state: string;
  location: string;
  scope: string;
  quotesDue: string | null;
  company: string;
  contactName: string;
}

const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** A prime's package form, cleaned; an error message when something required is missing. PURE. */
export function cleanPackageInput(raw: Record<string, unknown>, today: string): { ok: true; input: PackageInput } | { ok: false; error: string } {
  const input: PackageInput = {
    trade: clip(raw.trade, 40),
    state: clip(raw.state, 2).toUpperCase(),
    location: clip(raw.location, 120),
    scope: String(raw.scope ?? "").trim().slice(0, 2000),
    quotesDue: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.quotesDue ?? "")) ? String(raw.quotesDue) : null,
    company: clip(raw.company, 120),
    contactName: clip(raw.contactName, 80),
  };
  if (!input.trade) return { ok: false, error: "Pick the trade you need." };
  if (input.scope.length < 20) return { ok: false, error: "Describe the scope in a sentence or two (what, where, how big)." };
  if (!input.company) return { ok: false, error: "Add your company name so subs know who is asking." };
  if (input.quotesDue && input.quotesDue < today) return { ok: false, error: "The quote due date is in the past." };
  return { ok: true, input };
}

export interface ResponseInput {
  company: string;
  contactName: string;
  email: string;
  phone: string;
  certifications: string[];
  message: string;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

/** A sub's quote response, cleaned; the honeypot field must be empty. PURE. */
export function cleanResponseInput(raw: Record<string, unknown>): { ok: true; input: ResponseInput } | { ok: false; error: string; spam?: boolean } {
  if (String(raw.website ?? "").trim()) return { ok: false, error: "Thanks!", spam: true };
  const certs = (Array.isArray(raw.certifications) ? raw.certifications : []).map((c) => String(c).toLowerCase()).filter((c) => SUB_FINDER_CERTS.some((x) => x.value === c));
  const input: ResponseInput = {
    company: clip(raw.company, 120),
    contactName: clip(raw.contactName, 80),
    email: clip(raw.email, 200).toLowerCase(),
    phone: clip(raw.phone, 30),
    certifications: [...new Set(certs)],
    message: String(raw.message ?? "").trim().slice(0, 1500),
  };
  if (!input.company) return { ok: false, error: "Add your company name." };
  if (!EMAIL_RE.test(input.email)) return { ok: false, error: "Add an email the prime can reply to." };
  return { ok: true, input };
}

/** Short, unguessable package id from random bytes. PURE (bytes in). */
export function packageSlug(bytes: Uint8Array): string {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  return [...bytes].slice(0, 10).map((b) => abc[b % abc.length]).join("");
}

export const certNames = (values: string[]) => values.map((v) => SUB_FINDER_CERTS.find((c) => c.value === v)?.label ?? v);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The email to the prime when a sub responds (transactional, to the prime who made the package). PURE. */
export function responseEmail(p: { title: string; trade: string; url: string }, r: ResponseInput): { subject: string; html: string; text: string } {
  const certs = r.certifications.length ? certNames(r.certifications).join(", ") : "none listed";
  const lines = [
    `${r.company} responded to your ${TRADE_PACKAGE_NAME} for ${p.trade}: ${p.title}.`,
    "",
    `Contact: ${r.contactName || "(not given)"} · ${r.email}${r.phone ? ` · ${r.phone}` : ""}`,
    `Certifications (self-reported): ${certs}`,
    r.message ? `Message: ${r.message}` : "",
    "",
    `Reply to this email to answer them directly. See every response: ${p.url}`,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "");
  return {
    subject: `New quote response from ${r.company}: ${p.trade}`,
    text: lines.join("\n"),
    html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">${lines.map((l) => (l ? `<p style="margin:0 0 8px">${esc(l)}</p>` : "")).join("")}</div>`,
  };
}

/** The quote request to a listed member (they opted in), with the one-click way to stop. PURE. */
export function quoteRequestEmail(p: { title: string; trade: string; company: string; location: string; quotesDue: string | null; url: string }, unlistUrl: string): { subject: string; html: string; text: string } {
  const due = p.quotesDue ? new Date(`${p.quotesDue}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;
  const lines = [
    `${p.company} is asking for your quote on ${p.trade} work: ${p.title}${p.location ? ` (${p.location})` : ""}.`,
    due ? `Quotes are due ${due}.` : "",
    `See the scope and send your quote: ${p.url}`,
    "",
    `You're getting this because you listed your business for primes on Contrax. Stop these requests: ${unlistUrl}`,
  ].filter(Boolean);
  return {
    subject: `Quote request from ${p.company}: ${p.trade}`,
    text: lines.join("\n\n"),
    html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">${lines
      .map((l, i) => `<p style="margin:0 0 10px${i === lines.length - 1 ? ";font-size:12px;color:#64748b" : ""}">${esc(l)}</p>`)
      .join("")}</div>`,
  };
}

/** Text the prime can paste into their own text or email to a sub they know. PURE. */
export function shareText(p: { company: string; trade: string; title: string; url: string }): string {
  return `${p.company} is collecting ${p.trade} quotes for ${p.title}. Scope and quote form: ${p.url}`;
}
