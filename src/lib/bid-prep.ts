/**
 * Bid Prep (owner 2026-11-17, choosing "we prepare this bid for you" at about $199): the one-time
 * service sold on a bid page. Small contractors get stuck on the paperwork, not on finding the bid,
 * so the offer sits on the bid they are reading. Pure and client-safe: the price, what is promised,
 * the order shape and the notices. The order lives in the Stripe session's metadata.
 */
export const BID_PREP_PRICE = "$199";
export const BID_PREP_PRICE_CENTS = 19900;
export const BID_PREP_PRODUCT = "bid_prep";
/** Promised on the page and in the confirmation. */
export const BID_PREP_DELIVERY = "2 business days";
/** A bid closer than this is not offered: there would be no time to prepare it and for the buyer to review, price and submit. */
export const BID_PREP_MIN_DAYS = 7;
/** The clock starts with the buyer's answers (owner 2026-11-17): a late intake must not become a missed deadline blamed on us. */
export const BID_PREP_GUARANTEE = `The ${BID_PREP_DELIVERY} start when you send your company details. Send them within one day of paying, and if we do not deliver before the deadline you get a full refund.`;

/** Exactly what the buyer gets. Nothing here is promised that cannot be done from the solicitation and the buyer's answers. */
export const BID_PREP_INCLUDES = [
  "We read the whole solicitation and every attachment for you",
  "A checklist of every form, certificate and attachment the agency requires, in the order to submit them",
  "The required forms filled in with your company details, ready for you to review and sign",
  "A cover letter and your company qualifications, written up in the format the agency asks for",
  "The price sheet laid out the way the solicitation wants it, ready for your numbers",
  "Everything assembled into one packet in the order the agency wants",
  "Step-by-step submission instructions: where it goes, how, and by when",
];
/** What stays with the buyer, said plainly so nobody takes bid preparation for pricing or engineering. */
export const BID_PREP_YOU_PROVIDE = [
  "Your prices for labor and materials. We do not price the job, do engineering or write technical proposals",
  "Any bond, insurance certificate or license the agency asks for. We tell you exactly which ones",
  "Your signature, and sending the bid in",
];
export const BID_PREP_NO_PROMISE = "We cannot promise you will win.";
export const BID_PREP_YOUR_PART = `${BID_PREP_YOU_PROVIDE.join(". ")}. ${BID_PREP_NO_PROMISE}`;

/**
 * State, county, city and school bids only (owner 2026-11-17: "keeping it strictly for simpler state,
 * county, and municipal IFBs/RFQs"). A federal solicitation can run to 150 pages with technical
 * volumes, which is not administrative preparation and is not what $199 buys. Federal sources are
 * the SAM.gov feeds, all named sam_*.
 */
export function bidPrepSource(source: unknown): boolean {
  const s = String(source ?? "").toLowerCase();
  return s !== "" && !s.startsWith("sam");
}

/** Offered only on an open bid with at least BID_PREP_MIN_DAYS left. */
export function bidPrepOffered(dueDate: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate).getTime();
  if (!Number.isFinite(due)) return false;
  return due - now.getTime() >= BID_PREP_MIN_DAYS * 86_400_000;
}

export interface BidPrepOrder {
  email: string;
  company: string;
  bidId: number;
  bidTitle: string;
  agency: string;
  /** ISO date the bid is due. */
  due: string;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** What the buyer typed: a work email, a company name and the bid's id. Null when unusable. */
export function cleanPrepRequest(input: unknown): { email: string; company: string; bidId: number } | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const email = text(o.email, 254).toLowerCase();
  const company = text(o.company, 150);
  const bidId = Number(o.bidId);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (company.length < 2 || !Number.isInteger(bidId) || bidId <= 0) return null;
  return { email, company, bidId };
}

export function prepMetadata(o: BidPrepOrder): Record<string, string> {
  return {
    product: BID_PREP_PRODUCT,
    prep_email: o.email,
    prep_company: o.company,
    prep_bid_id: String(o.bidId),
    prep_bid_title: o.bidTitle.slice(0, 300),
    prep_agency: o.agency.slice(0, 200),
    prep_due: o.due,
  };
}

export function prepFromMetadata(m: Record<string, string> | null | undefined): BidPrepOrder | null {
  if (m?.product !== BID_PREP_PRODUCT) return null;
  const base = cleanPrepRequest({ email: m.prep_email, company: m.prep_company, bidId: Number(m.prep_bid_id) });
  if (!base) return null;
  return { ...base, bidTitle: text(m.prep_bid_title, 300) || `Bid ${base.bidId}`, agency: text(m.prep_agency, 200), due: text(m.prep_due, 40) };
}

const longDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" }) : "the date on the notice";
};

const bidUrl = (id: number) => `https://www.contrax.company/bid/${id}`;

/** The Mission Control push. `paid` false means the form was sent but not yet paid. */
export function prepAlert(o: BidPrepOrder, sessionId: string, paid: boolean): { title: string; body: string; tag: string; url: string } {
  const what = `${o.company}: ${o.bidTitle}`;
  return paid
    ? { title: `💵 ${BID_PREP_PRICE} bid prep paid`, body: `${what}. Bid due ${longDay(o.due)}. Send to ${o.email}.`.slice(0, 220), tag: `prep-${sessionId}`.slice(0, 64), url: "/admin/live" }
    : { title: "🧾 Bid prep checkout started", body: `${what} (${o.email}). Not paid yet.`.slice(0, 220), tag: `prep-start-${sessionId}`.slice(0, 64), url: "/admin/live" };
}

/** What the owner gets the moment an order is paid: everything needed to start. */
export function prepOwnerNotice(o: BidPrepOrder, sessionId: string): { subject: string; text: string } {
  return {
    subject: `PAID ${BID_PREP_PRICE} bid prep: ${o.company}, due ${longDay(o.due)}`,
    text: [
      `${o.company} (${o.email}) paid ${BID_PREP_PRICE} for a bid package.`,
      `Bid: ${o.bidTitle}${o.agency ? `\nAgency: ${o.agency}` : ""}\nDue: ${longDay(o.due)}\nPage: ${bidUrl(o.bidId)}`,
      `Promised: ${BID_PREP_GUARANTEE}`,
      "The buyer is shown a short form right after paying and is emailed the same questions. Their answers arrive as a second email, or as a reply.",
      PREP_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join("\n"),
      `Stripe session: ${sessionId}`,
    ].join("\n\n"),
  };
}

/** The few things only the buyer knows. Nothing sensitive is asked for by email: tax ID and bank fields are left for them to fill in. */
export const PREP_QUESTIONS = [
  "Your legal business name, address and phone number",
  "How many years you have been in business, and how many people work for you",
  "Two or three jobs like this one you have done: the customer, the year and the rough value",
  "Any licenses or certifications you hold (for example small business, minority-owned, veteran-owned)",
  "The name and title of the person who will sign the bid",
];

/** The intake form's page for one paid order: the Stripe session id is the only key. */
export const intakeUrl = (sessionId: string) => `https://www.contrax.company/order-received?kind=bidprep&session=${encodeURIComponent(sessionId)}`;

/**
 * The intake form shown right after payment (owner 2026-11-17: collect the company basics at once,
 * "so you aren't chasing them over email while the clock ticks down"). UEI and CAGE are public SAM
 * identifiers and optional; tax ID, bank and card numbers are never asked for.
 */
export interface BidPrepIntake {
  legalName: string;
  address: string;
  phone: string;
  uei: string;
  cage: string;
  years: string;
  employees: string;
  licenses: string;
  pastJobs: string;
  signer: string;
}
export const INTAKE_FIELDS: readonly { name: keyof BidPrepIntake; label: string; hint?: string; required: boolean; long?: boolean; max: number }[] = [
  { name: "legalName", label: "Legal business name", required: true, max: 150 },
  { name: "address", label: "Business address", required: true, max: 250 },
  { name: "phone", label: "Phone number", required: true, max: 40 },
  { name: "signer", label: "Name and title of the person signing the bid", required: true, max: 150 },
  { name: "years", label: "Years in business", required: true, max: 40 },
  { name: "employees", label: "Number of employees", required: true, max: 40 },
  { name: "uei", label: "SAM.gov UEI", hint: "Optional. Federal bids need it; leave blank if you do not have one yet.", required: false, max: 20 },
  { name: "cage", label: "CAGE code", hint: "Optional.", required: false, max: 10 },
  { name: "licenses", label: "Licenses and certifications", hint: "Contractor license numbers, small business, minority-owned, woman-owned or veteran-owned certifications.", required: false, long: true, max: 1000 },
  { name: "pastJobs", label: "Two or three jobs like this one", hint: "For each: the customer, the year, the rough value and one line on what you did.", required: true, long: true, max: 3000 },
];

const block = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max) : "");

/** A usable intake, or null when a required answer is missing. */
export function cleanIntake(input: unknown): BidPrepIntake | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const out = {} as BidPrepIntake;
  for (const f of INTAKE_FIELDS) {
    const v = block(o[f.name], f.max);
    if (f.required && v.length < 1) return null;
    out[f.name] = v;
  }
  return out;
}

/** The buyer's answers, sent to the owner under the same order. */
export function intakeNotice(o: BidPrepOrder, a: BidPrepIntake, sessionId: string): { subject: string; text: string } {
  return {
    subject: `Bid prep answers: ${o.company}, due ${longDay(o.due)}`,
    text: [
      `${o.company} (${o.email}) sent their company details for:\n${o.bidTitle}\nDue: ${longDay(o.due)}\nPage: ${bidUrl(o.bidId)}`,
      INTAKE_FIELDS.map((f) => `${f.label}:\n${a[f.name] || "(left blank)"}`).join("\n\n"),
      `The ${BID_PREP_DELIVERY} to deliver start now.`,
      `Stripe session: ${sessionId}`,
    ].join("\n\n"),
  };
}

/** What the buyer hears the moment they pay: what is coming, when, and the questions to answer. */
export function prepBuyerConfirmation(o: BidPrepOrder, sessionId?: string): { subject: string; text: string } {
  return {
    subject: `We are preparing your bid: ${o.bidTitle}`.slice(0, 200),
    text: [
      `Thank you. We have your order to prepare a bid package for:\n${o.bidTitle}${o.agency ? `\n${o.agency}` : ""}\nDue ${longDay(o.due)}\n${bidUrl(o.bidId)}`,
      BID_PREP_GUARANTEE,
      sessionId
        ? `To fill in the forms we need a few things only you know. If you have not sent them yet, the short form is here:\n${intakeUrl(sessionId)}\n\nOr reply to this email with:`
        : "To fill in the forms we need a few things only you know. Please reply to this email with:",
      PREP_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join("\n"),
      "Do not send tax ID, bank or card numbers by email. We leave those fields for you to fill in.",
      "What we do:",
      BID_PREP_INCLUDES.map((l) => `- ${l}`).join("\n"),
      "What you provide:",
      BID_PREP_YOU_PROVIDE.map((l) => `- ${l}`).join("\n"),
      BID_PREP_NO_PROMISE,
      "Nathaniel Minetree\nContrax",
    ].join("\n\n"),
  };
}
