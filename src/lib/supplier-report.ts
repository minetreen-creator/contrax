/**
 * The supplier report (owner 2026-11-18: "lets make the website change"). A month of traffic showed
 * small contractors search and do not pay; the businesses that sell to contractors (material
 * suppliers, equipment rental, staffing, bonding and insurance, licensing) spend money to reach
 * them. For those firms the same data is a list of who to call: which public jobs are opening in
 * their state, which federal jobs were just awarded and to whom, and which federal contracts end
 * soon. /suppliers shows a live sample and takes a request for a free report; each request is
 * emailed to the owner. Nothing here is charged online yet.
 *
 * Data honesty: winners are known for FEDERAL awards only. State, county and school award
 * winners are not collected, so the page says so and never promises them.
 */
import { STATE_NAMES } from "./contract-map";

/** The Agency plan's price (owner 2026-11-12: "$199 it is"). The paid step after the free report. */
export const SUPPLIER_PRICE = "$199";
/**
 * What suppliers are told the paid plan is called (owner 2026-11-18, review: "Agency plan" reads as
 * a plan for government or marketing agencies). It is the existing Agency plan, and the checkout
 * and receipt still say Agency, so the page says so once.
 */
export const SUPPLIER_PLAN_NAME = "Territory plan";
export const SUPPLIER_PLAN_BILLED_AS = "Billed as the Contrax Agency plan.";
/** The one-line pitch. It names only what the report holds: jobs opening, and federal winners. */
export const SUPPLIER_SUBHEAD =
  "Suppliers, equipment rental, staffing and bonding agents: a weekly list of the public jobs opening in your territory, and the contractors who just won federal work there.";
export const SUPPLIER_SAMPLE_STATE = "SC";
/** States shown in the live sample (owner 2026-11-18: "lets add NC too", then "might as well add VA, FL and GA"). The first is the form's default. */
export const SUPPLIER_SAMPLE_STATES: readonly string[] = ["SC", "NC", "VA", "GA", "FL"];
/** The homepage lists every state's counts but real rows for only this many, so it stays short; /suppliers shows them all. */
export const SUPPLIER_HOME_ROW_STATES = 2;
/** Federal awards below this are left out of the sample: a $25,030 job is real but tells a supplier little. */
export const SUPPLIER_AWARD_MIN = 100_000;

export const SUPPLIER_TYPES: readonly { id: string; label: string }[] = [
  { id: "materials", label: "Building materials or supply" },
  { id: "equipment", label: "Equipment rental or sales" },
  { id: "staffing", label: "Staffing or labor" },
  { id: "bonding", label: "Bonding or insurance" },
  { id: "licensing", label: "Licensing, training or consulting" },
  { id: "other", label: "Something else" },
];

export const SUPPLIER_INCLUDES: readonly string[] = [
  "New public construction jobs in your state, sorted by trade",
  "Jobs closing in the next 7 days",
  "Federal jobs just awarded in your state, with the winning company and the amount",
  "Federal contracts in your state that end soon, with the company that holds them",
];

export const SUPPLIER_NOT_YET = "Winners of state, county and school jobs are not in the report yet. Federal winners are.";

/** Titles that read as construction or building-trade work (Postgres ~* and JS). */
export const SUPPLIER_TITLE_PATTERN =
  "roof|paving|resurfac|sidewalk|renovation|construction|building|hvac|chiller|boiler|electrical|generator|plumbing|painting|demolition|concrete|fenc|bridge|water line|sewer";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface SupplierRequest {
  email: string;
  company: string;
  type: string;
  state: string;
}

/** A clean request, or the message to show. PURE. */
export function cleanSupplierRequest(body: unknown): { ok: true; request: SupplierRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const email = str(b.email, 200).toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: "Enter the email address the report should go to." };
  const state = str(b.state, 2).toUpperCase();
  if (!STATE_NAMES[state]) return { ok: false, error: "Pick the state you sell in." };
  const type = SUPPLIER_TYPES.some((t) => t.id === b.type) ? String(b.type) : "other";
  return { ok: true, request: { email, company: str(b.company, 120), type, state } };
}

/** The email the owner gets for one request. PURE. */
export function supplierNotice(r: SupplierRequest): { subject: string; text: string } {
  const type = SUPPLIER_TYPES.find((t) => t.id === r.type)?.label ?? r.type;
  const state = STATE_NAMES[r.state] ?? r.state;
  return {
    subject: `Supplier report request: ${r.company || r.email}, ${state}`,
    text: [
      "Someone asked for the free supplier report on /suppliers.",
      "",
      `Company: ${r.company || "(not given)"}`,
      `Business: ${type}`,
      `State: ${state}`,
      `Email: ${r.email}`,
      "",
      `Reply to this email to answer them. The page told them the report is free this once and ${SUPPLIER_PRICE} a month after that.`,
    ].join("\n"),
  };
}

export interface SupplierSample {
  state: string;
  stateName: string;
  open: number;
  newThisWeek: number;
  closingSoon: number;
  newJobs: { id: number; title: string; agency: string; due: string }[];
  awards: { company: string; where: string; amount: number; date: string; what: string }[];
  ending: { company: string; amount: number; end: string; agency: string }[];
}

/** "$7.9 million", "$890,535". PURE. */
export function supplierMoney(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)} billion`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)} million`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** "Dec 18". PURE. */
export function supplierDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
