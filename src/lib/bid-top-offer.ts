/**
 * The top of a locked bid page (owner 2026-11-27, "1,3"): about two in three visitors who land on a
 * single bid leave from it, and the offer in the first screen was one thin line. It is now a short
 * sentence saying what is locked, a full-width button with the price, and what else comes with it.
 * PURE wording, shared with the test.
 */
export function bidTopLockLine(hasContact: boolean): string {
  return hasContact
    ? "The official notice, the bid documents and the contracting officer's contact are for Starter members."
    : "The official notice and the bid documents are for Starter members.";
}
export const BID_TOP_BUTTON_LEAD = "Open this bid:";
export const BID_TOP_ALSO = "You also get every new bid in your trade by email at 6 AM. Cancel anytime.";

/** The paperwork pack on a bid page: the visitor reading one bid is the one who needs the forms. */
export const BID_PAGE_PACK_LEAD = "Bidding this yourself? Get your paperwork ready";
export const BID_PAGE_PACK_DETAIL = "Capability statement, bid cover letter, bid day checklist and three more Word files. One payment, nothing renews.";
