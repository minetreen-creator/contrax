/**
 * "DID I WIN?" TRACKER (owner 2026-10-03).
 *
 * After a saved federal bid's deadline passes, a daily job
 * (src/jobs/check-awards.ts) looks for the matching SAM.gov Award Notice: same
 * solicitation number, notice type "Award Notice". When one is posted, everyone
 * who saved that bid gets one email naming the winner, the award amount and
 * the date. If the winner's UEI matches the member's own business profile, the
 * email says they won.
 *
 * Federal only: state and local sources publish no award notices we can match,
 * so only bids carrying a SAM.gov solicitation number are checked.
 *
 * PURE (no DB, no network); unit-tested in award-check.test.ts.
 */

/** Check a bid this many days after its deadline, then give up (no award posted). */
export const AWARD_CHECK_MAX_DAYS = 180;
/** Re-check a bid without an award at most this often. */
export const AWARD_RECHECK_DAYS = 3;
/** Bids looked up per daily run (SAM.gov is rate-limited; 2 requests per bid). */
export const AWARD_CHECK_BATCH = 40;

export interface AwardResult {
  noticeId: string;
  awardeeName: string;
  awardeeUei: string | null;
  /** Dollars, null when SAM.gov did not publish an amount. */
  amount: number | null;
  /** YYYY-MM-DD, null when not published. */
  awardDate: string | null;
  contractNumber: string | null;
}

/** Solicitation numbers compared without case, spaces or dashes ("W912-C3 26" = "w912c326"). */
export function normalizeSolicitationNumber(raw: string | null | undefined): string {
  return String(raw ?? "").toLowerCase().replace(/[\s\-_.]/g, "");
}

function noticeTypeOf(item: any): string {
  const t = item?.type;
  return String((t && typeof t === "object" ? t.value : t) ?? "");
}

/**
 * From a SAM.gov search result page, the Award Notice for this solicitation
 * number (exact match after normalising), or null. The newest one wins when a
 * solicitation has several (e.g. a corrected award notice).
 */
export function pickAwardNotice(items: readonly any[], solicitationNumber: string): { noticeId: string } | null {
  const want = normalizeSolicitationNumber(solicitationNumber);
  if (!want) return null;
  const matches = items.filter(
    (it) =>
      /award/i.test(noticeTypeOf(it)) &&
      normalizeSolicitationNumber(it?.solicitationNumber) === want &&
      it?._id,
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => String(b?.publishDate ?? b?.modifiedDate ?? "").localeCompare(String(a?.publishDate ?? a?.modifiedDate ?? "")));
  return { noticeId: String(matches[0]._id) };
}

/** The award block of a SAM.gov opportunity detail (data2.award), or null when it names no winner. */
export function parseAwardDetail(detail: any, noticeId: string): AwardResult | null {
  const award = detail?.data2?.award ?? detail?.data?.award ?? detail?.award;
  const name = String(award?.awardee?.name ?? "").trim();
  if (!name) return null;
  const amountNum = Number(String(award?.amount ?? "").replace(/[$,\s]/g, ""));
  const date = String(award?.date ?? "").trim();
  return {
    noticeId,
    awardeeName: name,
    awardeeUei: String(award?.awardee?.ueiSAM ?? "").trim() || null,
    amount: award?.amount != null && String(award.amount).trim() !== "" && Number.isFinite(amountNum) ? amountNum : null,
    awardDate: /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null,
    contractNumber: String(award?.number ?? "").trim() || null,
  };
}

/** True when the award went to this member's own company (UEI match, case-insensitive). */
export function isOwnAward(awardeeUei: string | null | undefined, memberUei: string | null | undefined): boolean {
  const a = String(awardeeUei ?? "").trim().toUpperCase();
  const b = String(memberUei ?? "").trim().toUpperCase();
  return a !== "" && a === b;
}

/** "$1,234,567" or null. */
export function formatAwardAmount(amount: number | null | undefined): string | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

/** Title-case SAM.gov's all-caps company names ("ACME CLEANING, LLC" -> "Acme Cleaning, LLC"). */
export function displayCompanyName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  const keepUpper = new Set(["LLC", "LLP", "LP", "INC", "PC", "PLLC", "USA", "US", "JV", "II", "III", "IV", "DBA"]);
  return name
    .toLowerCase()
    .replace(/[a-z0-9&']+/g, (w) => (keepUpper.has(w.toUpperCase().replace(/'/g, "")) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)));
}

export type AwardOutcome = "won" | "lost" | "submitted" | "saved";

/**
 * Which email to send: won (winner's UEI is theirs); lost (they bid, their UEI
 * is on file and is not the winner's); submitted (they bid but we can't tell,
 * no UEI on file); saved (they only saved it).
 */
export function awardOutcome(o: { ownAward: boolean; memberUeiKnown: boolean; pursuitStatus: string | null | undefined }): AwardOutcome {
  if (o.ownAward) return "won";
  const bid = o.pursuitStatus === "submitted" || o.pursuitStatus === "lost";
  if (!bid) return "saved";
  return o.memberUeiKnown ? "lost" : "submitted";
}

/** The SAM.gov search URL for award notices with this solicitation number. */
export function awardSearchUrl(solicitationNumber: string): string {
  // Plain keyword search; pickAwardNotice then keeps only exact solicitation-number matches.
  const q = encodeURIComponent(solicitationNumber.trim());
  return `https://sam.gov/api/prod/sgs/v1/search/?index=opp&page=0&size=25&sort=-modifiedDate&mode=search&is_active=false&q=${q}`;
}
