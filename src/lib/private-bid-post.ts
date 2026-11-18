/**
 * "Post your project" (owner 2026-11-18: yes to a posting form for /private-bids). A business
 * fills in what it needs done; the request is stored and emailed to the owner. NOTHING is
 * published from here: a listing goes on /private-bids only after the owner approves it and it
 * is added to PRIVATE_BID_REQUESTS (see ./private-bids). Listing is free.
 */
import { STATE_NAMES } from "./contract-map";

export const POST_PROJECT_PATH = "/private-bids/post";
export const POST_PROJECT_HEADING = "Post your project and get bids from contractors";
export const POST_PROJECT_INTRO =
  "Tell us what you need done at your business. We review every request before it goes up, then list it free where contractors look for work. Contractors answer you directly.";
export const POST_PROJECT_STEPS = [
  "You fill in the form. It takes about two minutes.",
  "We read it and email you if anything is unclear. Nothing is public until we have checked it.",
  "Your request goes on the Private bid requests page with the contact email you gave. Bids and questions come straight to you.",
] as const;
export const POST_PROJECT_FINE_PRINT =
  "Free to list. Contrax does not take a fee, choose the contractor or handle the bids. The business name, the job details and the contact email you give here are shown publicly once the request is listed.";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface ProjectPost {
  business: string;
  name: string;
  email: string;
  work: string;
  city: string;
  state: string;
  /** ISO date bids are due, or "" when the business gave none. */
  deadline: string;
  details: string;
}

/** A clean post, or the message to show. `today` is an ISO date. PURE. */
export function cleanProjectPost(body: unknown, today: string): { ok: true; post: ProjectPost } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const text = (v: unknown, max: number) =>
    typeof v === "string" ? v.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "";
  // A filled-in hidden field means an automated form filler, not a person.
  if (line(b.website, 200)) return { ok: false, error: "Something went wrong. Please try again." };
  const business = line(b.business, 120);
  if (business.length < 2) return { ok: false, error: "Enter the name of your business." };
  const email = line(b.email, 200).toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: "Enter the email address contractors should send bids to." };
  const work = line(b.work, 140);
  if (work.length < 5) return { ok: false, error: "Say in a few words what work you need done." };
  const state = line(b.state, 2).toUpperCase();
  if (!STATE_NAMES[state]) return { ok: false, error: "Pick the state the work is in." };
  const details = text(b.details, 2000);
  if (details.length < 20) return { ok: false, error: "Add a sentence or two about the job so contractors can price it." };
  const deadline = line(b.deadline, 10);
  if (deadline && (!DAY.test(deadline) || Number.isNaN(Date.parse(deadline)))) return { ok: false, error: "Enter the bid deadline as a date, or leave it empty." };
  if (deadline && deadline < today) return { ok: false, error: "The bid deadline has already passed. Pick a later date or leave it empty." };
  return { ok: true, post: { business, name: line(b.name, 80), email, work, city: line(b.city, 80), state, deadline, details } };
}

/** The email the owner gets for one post. PURE. */
export function projectPostNotice(p: ProjectPost): { subject: string; text: string } {
  const where = [p.city, STATE_NAMES[p.state] ?? p.state].filter(Boolean).join(", ");
  return {
    subject: `Project posted for review: ${p.business}, ${where}`,
    text: [
      `A business filled in the form at ${POST_PROJECT_PATH}. It is NOT public yet.`,
      "",
      `Business: ${p.business}`,
      `Contact name: ${p.name || "(not given)"}`,
      `Email for bids: ${p.email}`,
      `Work needed: ${p.work}`,
      `Where: ${where}`,
      `Bids due: ${p.deadline || "(no deadline given)"}`,
      "",
      "Details:",
      p.details,
      "",
      "To list it, tell Claude to add it to the Private bid requests page. Reply to this email to ask the business a question.",
    ].join("\n"),
  };
}
