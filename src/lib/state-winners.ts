/**
 * The paid state winners list (owner 2026-11-19, "make me income"): every federal construction
 * contract awarded for work in one state since October 2024, with the winning company, where it is
 * registered and the amount. $29, one time, delivered as a spreadsheet file the moment Stripe
 * confirms payment. Pure and client-safe: price, wording, the request sent to USAspending.gov and
 * the file itself. The order lives in the Stripe session, so there is no table.
 */
import { STATE_NAMES } from "~/lib/contract-map";
import { FEDERAL_CONSTRUCTION_ROWS } from "~/lib/federal-construction";

export const WINNERS_PRICE = "$29";
export const WINNERS_PRICE_CENTS = 2900;
export const WINNERS_PRODUCT = "state_winners_list";
/** First day covered: the start of federal fiscal year 2025, the year the ranking page counts. */
export const WINNERS_START = "2024-10-01";
export const WINNERS_MIN_AMOUNT = 100_000;
export const WINNERS_PATH = "/winners-list";

/** Exactly what the buyer gets. Every line is a column the file really has. */
export const WINNERS_INCLUDES = [
  "Every new federal construction contract of $100,000 or more for work in your state since October 2024",
  "The winning company and the city and state where it is registered",
  "The contract amount, the agency that awarded it and the start date",
  "The city where the work is done and the government's description of the job",
  "A link to each contract's public federal record",
];
export const WINNERS_FORMAT_NOTE = "A spreadsheet file (CSV) that opens in Excel or Google Sheets. Phone numbers and emails are not included.";

const COVERED = new Set(FEDERAL_CONSTRUCTION_ROWS.map((r) => r[0]));

/** A two-letter code for one of the 50 states or DC, or null. */
export function cleanWinnersState(v: unknown): string | null {
  const code = typeof v === "string" ? v.trim().toUpperCase() : "";
  return COVERED.has(code) && STATE_NAMES[code] ? code : null;
}

export function winnersProductName(state: string): string {
  return `Federal construction winners list: ${STATE_NAMES[state] ?? state}`;
}

/** The USAspending.gov award search for one page of one state's list. */
export function winnersSearchBody(state: string, page: number, endDate: string): Record<string, unknown> {
  return {
    filters: {
      award_type_codes: ["A", "B", "C", "D"],
      time_period: [{ start_date: WINNERS_START, end_date: endDate, date_type: "new_awards_only" }],
      place_of_performance_locations: [{ country: "USA", state }],
      naics_codes: { require: ["23"] },
      award_amounts: [{ lower_bound: WINNERS_MIN_AMOUNT }],
    },
    fields: ["Award ID", "Recipient Name", "Recipient Location", "Award Amount", "Start Date", "Awarding Agency", "Awarding Sub Agency", "Primary Place of Performance", "Description"],
    sort: "Award Amount",
    order: "desc",
    limit: 100,
    page,
    subawards: false,
  };
}

export interface WinnerRow {
  awardId: string;
  company: string;
  companyCity: string;
  companyState: string;
  outOfState: boolean;
  amount: number;
  startDate: string;
  agency: string;
  office: string;
  workCity: string;
  description: string;
  record: string;
}

const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export function winnerRowFromApi(r: Record<string, unknown>, state: string): WinnerRow {
  const loc = (r["Recipient Location"] ?? {}) as Record<string, unknown>;
  const pop = (r["Primary Place of Performance"] ?? {}) as Record<string, unknown>;
  const companyState = str(loc.state_code);
  const internal = str(r.generated_internal_id);
  return {
    awardId: str(r["Award ID"]),
    company: str(r["Recipient Name"]),
    companyCity: str(loc.city_name),
    companyState,
    outOfState: !!companyState && companyState !== state,
    amount: Math.round(Number(r["Award Amount"]) || 0),
    startDate: str(r["Start Date"]),
    agency: str(r["Awarding Agency"]),
    office: str(r["Awarding Sub Agency"]),
    workCity: str(pop.city_name),
    description: str(r["Description"]),
    record: internal ? `https://www.usaspending.gov/award/${encodeURIComponent(internal)}` : "",
  };
}

/** One spreadsheet cell: quoted, and never starting with a character a spreadsheet would run as a formula. */
export function csvCell(v: string | number | boolean): string {
  let s = typeof v === "string" ? v : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export const WINNERS_COLUMNS = [
  "Winning company", "Company city", "Company state", "Registered out of state", "Contract amount (USD)", "Start date",
  "Agency", "Awarding office", "City where the work is done", "Job description", "Award number", "Federal record",
];

export function winnersCsv(rows: WinnerRow[]): string {
  const lines = [WINNERS_COLUMNS.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push([
      r.company, r.companyCity, r.companyState, r.outOfState ? "Yes" : "No", r.amount, r.startDate,
      r.agency, r.office, r.workCity, r.description, r.awardId, r.record,
    ].map(csvCell).join(","));
  }
  // The byte-order mark makes Excel read accented names correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function winnersFileName(state: string, today: string): string {
  return `contrax-federal-construction-winners-${state.toLowerCase()}-${today}.csv`;
}

/** The fields of a Stripe checkout session this product reads. */
export interface WinnersSession {
  mode?: string | null;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: Record<string, string> | null;
}

/** The state a session paid for, or null when it is not a paid session for this product. */
export function paidWinnersState(session: WinnersSession | null | undefined): string | null {
  if (!session || session.metadata?.product !== WINNERS_PRODUCT) return null;
  if (session.mode !== "payment" || session.payment_status !== "paid") return null;
  if (session.amount_total !== WINNERS_PRICE_CENTS || session.currency !== "usd") return null;
  return cleanWinnersState(session.metadata?.winners_state);
}

export const WINNERS_SESSION_RE = /^cs_[A-Za-z0-9_]{10,200}$/;

export function winnersDownloadHref(sessionId: string): string {
  return `/api/state-winners/download?session=${encodeURIComponent(sessionId)}`;
}

export function buyerEmail(state: string, sessionId: string): { subject: string; text: string } {
  const name = STATE_NAMES[state] ?? state;
  return {
    subject: `Your ${name} federal construction winners list`,
    text: [
      `Thank you for your order. Your ${name} list is ready.`,
      "",
      "Download it here (the link keeps working, and each download is rebuilt from the latest federal records):",
      `https://www.contrax.company${WINNERS_PATH}?session=${sessionId}`,
      "",
      "What is in it:",
      ...WINNERS_INCLUDES.map((l) => `- ${l}`),
      "",
      WINNERS_FORMAT_NOTE,
      "",
      "If the file will not open or something looks wrong, reply to this email and I will sort it out.",
      "",
      "Nathaniel",
      "Contrax",
    ].join("\n"),
  };
}

export function ownerNotice(state: string, sessionId: string, email: string | null): { subject: string; text: string } {
  return {
    subject: `Paid: ${STATE_NAMES[state] ?? state} winners list (${WINNERS_PRICE})`,
    text: `A state winners list was paid for.\n\nState: ${STATE_NAMES[state] ?? state}\nBuyer: ${email ?? "(no email on the session)"}\nStripe session: ${sessionId}\n\nThe file is delivered automatically: the buyer was sent to the download page and emailed the link. Nothing to do unless they write in.`,
  };
}
