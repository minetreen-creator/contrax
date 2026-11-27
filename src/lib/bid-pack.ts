/**
 * The Public Bid Paperwork Pack (owner 2026-11-27, "3"): six fill-in Word files for a small
 * contractor bidding on public work. $19, one time, downloaded the moment Stripe confirms payment.
 * It gives visitors who will not subscribe something to buy, and it is not a bid list: no bid,
 * buyer or contact is in it (owner: no freebies). The order lives in the Stripe session, so there
 * is no table. Pure and client-safe: price, wording and the checks.
 */
export const BID_PACK_PRICE = "$19";
export const BID_PACK_PRICE_CENTS = 1900;
export const BID_PACK_PRODUCT = "bid_paperwork_pack";
export const BID_PACK_NAME = "Public Bid Paperwork Pack";
export const BID_PACK_PATH = "/bid-pack";
export const BID_PACK_FILE_NAME = "contrax-public-bid-paperwork-pack.zip";

/** Exactly what the buyer gets: one line per file in the ZIP, in order. */
export const BID_PACK_FILES: readonly { name: string; what: string }[] = [
  { name: "Capability statement", what: "The one page a buyer or a prime contractor asks for. Fill it in once and reuse it on every bid." },
  { name: "Bid cover letter", what: "A letter that acknowledges the addenda, states how long your bid is good for and lists what is enclosed." },
  { name: "Bid or no-bid checklist", what: "Ten minutes to decide whether a solicitation is worth your evening, before you spend it." },
  { name: "Bid day checklist", what: "Every signature, form, bond and deadline, from a week out to the day after the opening." },
  { name: "Quote request form", what: "What to send a subcontractor or supplier so their price comes back complete and on time." },
  { name: "Start here", what: "One page on which file to use when, and the three rules that outrank any template." },
];
export const BID_PACK_FORMAT_NOTE = "Six Word files in one ZIP download. They open in Word, Google Docs and Pages. Replace the grey text with your own.";
export const BID_PACK_HONEST_NOTE = "These are general templates, not legal advice, and they do not include any bids. When a buyer supplies its own form, use theirs.";

export const BID_PACK_SESSION_RE = /^cs_[A-Za-z0-9_]{10,200}$/;

/** The fields of a Stripe checkout session this product reads. */
export interface BidPackSession {
  mode?: string | null;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: Record<string, string> | null;
}

/** True only for a paid session for this product at this price. */
export function paidBidPack(session: BidPackSession | null | undefined): boolean {
  if (!session || session.metadata?.product !== BID_PACK_PRODUCT) return false;
  if (session.mode !== "payment" || session.payment_status !== "paid") return false;
  return session.amount_total === BID_PACK_PRICE_CENTS && session.currency === "usd";
}

export function bidPackDownloadHref(sessionId: string): string {
  return `/api/bid-pack/download?session=${encodeURIComponent(sessionId)}`;
}

export function bidPackBuyerEmail(sessionId: string): { subject: string; text: string } {
  return {
    subject: `Your ${BID_PACK_NAME}`,
    text: [
      `Thank you for your order. Your ${BID_PACK_NAME} is ready.`,
      "",
      "Download it here (the link keeps working):",
      `www.contrax.company${BID_PACK_PATH}?session=${sessionId}`,
      "",
      "What is in it:",
      ...BID_PACK_FILES.map((f) => `- ${f.name}: ${f.what}`),
      "",
      BID_PACK_FORMAT_NOTE,
      "",
      "Start with the capability statement. If a file will not open or something looks wrong, reply to this email and I will sort it out.",
      "",
      "Nathaniel",
      "Contrax",
    ].join("\n"),
  };
}

export function bidPackOwnerNotice(sessionId: string, email: string | null): { subject: string; text: string } {
  return {
    subject: `Paid: ${BID_PACK_NAME} (${BID_PACK_PRICE})`,
    text: `A ${BID_PACK_NAME} was paid for.\n\nBuyer: ${email ?? "(no email on the session)"}\nStripe session: ${sessionId}\n\nThe file is delivered automatically: the buyer was sent to the download page and emailed the link. Nothing for you to do.`,
  };
}
