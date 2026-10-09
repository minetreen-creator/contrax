/**
 * BID TABULATIONS — the JOIN (owner rule ①: provable link only).
 *
 * A tabulation may attach to an open bid ONLY through a key the publisher itself
 * printed on BOTH sides. There is no title/agency/NAICS/location fallback and this
 * module has no scoring, no similarity and no threshold: every candidate match is an
 * exact equality on a publisher-issued identifier, and the concrete value that
 * matched is stored so the claim can be audited later (`match_value`).
 *
 * THE TWO PROVABLE ALDOT KEYS (research §3.2, generalized only as far as the
 * publisher's own numbering allows):
 *
 *   ① 'reference_number' — ALDOT's Contract ID. The tabulation prints
 *      `Contract ID: 20260130067` = the letting date (2026-01-30) followed by the
 *      call order (067). `al-aldot.ts` already stores the open bid as
 *      `external_id = aldot-<YYYYMMDD letting>-<call>` — the SAME two facts, in the
 *      same order, in the same numbering space. Deriving `20260130` + `067` back out
 *      of that id and comparing it to the printed Contract ID is an exact equality on
 *      the publisher's own identifier (the permitted in-publisher normalisation —
 *      the call is zero-padded to 3 digits, exactly as ALDOT prints it).
 *
 *   ② 'project_number' — the printed Project(s). The tabulation prints the project
 *      number(s) the contract was let under; the open bid stores that string in
 *      `solicitation_number`. A re-let of the SAME project number later gets a NEW
 *      Contract ID (so ① cannot see it) but the SAME project number — that is the
 *      "last time this project was let" case, and it is still an exact string match on
 *      a publisher-issued identifier, not a similarity.
 *
 * WHAT IS DELIBERATELY ABSENT: `predecessor_named` is a legal match_kind in the
 * database CHECK (a future source whose new solicitation literally names its
 * predecessor), but NOTHING in this codebase may ever produce it by guessing.
 *
 * TWO FAIL-CLOSED GUARDS:
 *   - The past letting must be PROVABLY EARLIER than the open bid's own opening. If
 *     either date is missing, nothing attaches (no prices are ever shown on a match
 *     we cannot date).
 *   - A tabulation whose `scanned` flag is set attaches to nothing: it has no
 *     machine-readable prices, so attaching it could only invite a wrong reading.
 */
import type { AldotTabBidder } from "./aldot-tabs";

/** The only three kinds the database CHECK accepts. */
export type MatchKind = "reference_number" | "project_number" | "predecessor_named";

export const MATCH_KINDS: readonly MatchKind[] = [
  "reference_number",
  "project_number",
  "predecessor_named",
];

export interface OpenBidKey {
  id: number;
  source: string | null;
  externalId: string | null;
  solicitationNumber: string | null;
  /** The bid's own opening / due instant (ISO), or null when unknown. */
  dueDate: string | null;
}

export interface TabulationKey {
  id: number;
  source: string;
  referenceNumber: string | null;
  projectNumber: string | null;
  /** The publisher's stated letting date (ISO date), or null. */
  bidOpenedOn: string | null;
  scanned?: boolean | null;
}

export interface TabulationLink {
  bid_id: number;
  tabulation_id: number;
  match_kind: MatchKind;
  match_value: string;
}

/**
 * `aldot-20260130-067` → `20260130067` (the printed Contract ID shape), or null when
 * the id is not one ALDOT's own writer could have produced. The mapping is written
 * out here once, and `al-aldot.ts`'s identity contract is the other half of it:
 * `external_id = aldot-<YYYYMMDD letting>-<call number>`.
 */
export function contractIdFromAldotExternalId(externalId: string | null | undefined): string | null {
  if (!externalId) return null;
  const m = String(externalId)
    .trim()
    .match(/^aldot-(\d{8})-(\d{1,4})$/);
  if (!m) return null;
  const call = Number(m[2]);
  if (!Number.isFinite(call) || call < 1) return null;
  return `${m[1]}${String(call).padStart(3, "0")}`;
}

/**
 * The project-number tokens of a printed Project(s) cell. ALDOT prints one or more
 * project numbers, comma- or whitespace-separated (e.g. "ATRP2-37-2024-109" or
 * "BR-0077(522), BR-0078(530)"). Tokens are upper-cased and whitespace-collapsed;
 * NOTHING else is normalised — no punctuation stripping, no fuzzy comparison.
 */
export function projectNumberTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  return String(value)
    .split(/[,;]/)
    .map((part) => part.replace(/\s+/g, " ").trim().toUpperCase())
    .filter((part) => part.length > 0);
}

/** True when the past letting is provably earlier than the open bid's opening. */
export function isProvablyEarlier(
  tabulationOpenedOn: string | null,
  bidDueDate: string | null,
): boolean {
  if (!tabulationOpenedOn || !bidDueDate) return false;
  const past = Date.parse(tabulationOpenedOn);
  const open = Date.parse(bidDueDate);
  if (!Number.isFinite(past) || !Number.isFinite(open)) return false;
  return past < open;
}

/**
 * The single provable link between one open bid and one tabulation, or null.
 * Order of preference: the publisher's contract reference, then the project number.
 */
export function matchTabulationToBid(
  bid: OpenBidKey,
  tabulation: TabulationKey,
): TabulationLink | null {
  if (tabulation.scanned) return null;
  if (!bid.source || bid.source !== tabulation.source) return null;
  if (!isProvablyEarlier(tabulation.bidOpenedOn, bid.dueDate)) return null;

  const contractId = contractIdFromAldotExternalId(bid.externalId);
  if (contractId && tabulation.referenceNumber && contractId === tabulation.referenceNumber.trim()) {
    return {
      bid_id: bid.id,
      tabulation_id: tabulation.id,
      match_kind: "reference_number",
      match_value: tabulation.referenceNumber.trim(),
    };
  }

  const bidProjects = new Set(projectNumberTokens(bid.solicitationNumber));
  if (bidProjects.size > 0) {
    for (const token of projectNumberTokens(tabulation.projectNumber)) {
      if (bidProjects.has(token)) {
        return {
          bid_id: bid.id,
          tabulation_id: tabulation.id,
          match_kind: "project_number",
          match_value: token,
        };
      }
    }
  }
  return null;
}

/** Every provable link between the given open bids and tabulations. */
export function linkTabulations(
  bids: OpenBidKey[],
  tabulations: TabulationKey[],
): TabulationLink[] {
  const out: TabulationLink[] = [];
  for (const bid of bids) {
    for (const tabulation of tabulations) {
      const link = matchTabulationToBid(bid, tabulation);
      if (link) out.push(link);
    }
  }
  return out;
}

/**
 * min / max over the STORED bidder amounts only — the schema's low_amount /
 * high_amount. NULL when no amount is stored. This is a property of what we stored,
 * never a claim about the letting.
 */
export function amountRange(bidders: Pick<AldotTabBidder, "bid_amount">[]): {
  low: string | null;
  high: string | null;
} {
  const amounts = bidders
    .map((b) => (b.bid_amount == null ? null : Number(b.bid_amount)))
    .filter((n): n is number => n !== null && Number.isFinite(n));
  if (amounts.length === 0) return { low: null, high: null };
  return {
    low: Math.min(...amounts).toFixed(2),
    high: Math.max(...amounts).toFixed(2),
  };
}
