/**
 * The public-records request Contrax files for a Managed client (owner 2026-11-14, competitor
 * review idea 6: a done-for-you version of asking an agency for the winning proposal). PURE: the
 * letter text for one federal contract, under the Freedom of Information Act, 5 U.S.C. § 552.
 * It asks only for records an agency holds, accepts redactions, and names Contrax as a
 * commercial requester, which is what it is. The owner files it on the agency's own FOIA portal.
 * One a month per client (RECORDS_REQUESTS_PER_MONTH) is what /teams promises.
 */
export const RECORDS_REQUESTS_PER_MONTH = 1;

export interface RecordsRequest {
  agency: string;
  awardId: string;
  holder: string;
  /** Dollars the requester will pay without being asked first. */
  feeLimit?: number;
}

const clean = (v: string, max: number) => v.replace(/\s+/g, " ").trim().slice(0, max);

export function recordsRequestLetter(r: RecordsRequest, today: string): { subject: string; body: string } | null {
  const agency = clean(r.agency, 160);
  const awardId = clean(r.awardId, 60);
  const holder = clean(r.holder, 160);
  if (agency.length < 2 || awardId.length < 4 || holder.length < 2) return null;
  const fee = Math.min(Math.max(Math.round(r.feeLimit ?? 50), 0), 500);
  return {
    subject: `FOIA request: contract ${awardId}`,
    body: [
      today,
      `FOIA Officer\n${agency}`,
      "Dear FOIA Officer:",
      `Under the Freedom of Information Act, 5 U.S.C. § 552, I request copies of the following records for contract ${awardId}, awarded to ${holder}:`,
      [
        "1. The awarded contract and its statement of work or performance work statement.",
        "2. The successful offeror's technical and price proposals, to the extent they are incorporated in the contract or otherwise releasable.",
        "3. All modifications to the contract.",
      ].join("\n"),
      "I understand that parts of these records may be withheld under Exemption 4 or another exemption. Please release every reasonably segregable portion and cite the exemption for anything withheld.",
      "Electronic copies by email are preferred.",
      `This request is made for commercial use by Contrax LLC. I agree to pay fees up to $${fee}. Please tell me before exceeding that amount.`,
      "Thank you for your help.",
      "Nathaniel Minetree\nContrax LLC\ncontrax.companyllc@gmail.com",
    ].join("\n\n"),
  };
}
