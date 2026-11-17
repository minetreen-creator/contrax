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
export const BID_PREP_GUARANTEE = "If we cannot deliver your package before the deadline, you get a full refund.";

/** Exactly what the buyer gets. Nothing here is promised that cannot be done from the solicitation and the buyer's answers. */
export const BID_PREP_INCLUDES = [
  "We read the whole solicitation and every attachment for you",
  "A checklist of every form, certificate and attachment the agency requires, in the order to submit them",
  "The required forms filled in with your company details, ready for you to review and sign",
  "A draft of the written parts: cover letter, your qualifications and your approach to the work, in the format the agency asks for",
  "A price sheet laid out the way the solicitation wants it, ready for your numbers",
  "Step-by-step submission instructions: where it goes, how, and by when",
];
/** What stays with the buyer, said plainly so nobody expects more than is sold. */
export const BID_PREP_YOUR_PART = "You set your price, sign and submit. We list anything only you can get, such as bonds, insurance certificates and licenses. We cannot promise you will win.";

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
      `Promised: delivered within ${BID_PREP_DELIVERY} and before the deadline. ${BID_PREP_GUARANTEE}`,
      "The buyer has been emailed the questions below. Their answers come as a reply to that email.",
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

/** What the buyer hears the moment they pay: what is coming, when, and the questions to answer. */
export function prepBuyerConfirmation(o: BidPrepOrder): { subject: string; text: string } {
  return {
    subject: `We are preparing your bid: ${o.bidTitle}`.slice(0, 200),
    text: [
      `Thank you. We have your order to prepare a bid package for:\n${o.bidTitle}${o.agency ? `\n${o.agency}` : ""}\nDue ${longDay(o.due)}\n${bidUrl(o.bidId)}`,
      `Your package will reach this address within ${BID_PREP_DELIVERY} of your reply to the questions below. ${BID_PREP_GUARANTEE}`,
      "To fill in the forms we need a few things only you know. Please reply to this email with:",
      PREP_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join("\n"),
      "Do not send tax ID, bank or card numbers by email. We leave those fields for you to fill in.",
      "What you will get:",
      BID_PREP_INCLUDES.map((l) => `- ${l}`).join("\n"),
      BID_PREP_YOUR_PART,
      "Nathaniel Minetree\nContrax",
    ].join("\n\n"),
  };
}
