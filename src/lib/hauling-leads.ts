/**
 * Hauling leads (trucking queue item #4, owner-endorsed definition R, placement A —
 * 2026-10-16). PURE helpers, shared by the sync job, the /subcontracts section, the
 * API route and the tests. No database, no network, no clock in this file.
 *
 * WHAT THIS IS. "Recent awards that may involve hauling": contract awards the federal
 * government has already published whose SCOPE WORDING plausibly involves hauling or
 * trucking work, and whose winner is not itself a freight carrier / vehicle dealer.
 * It is an INFERENCE from a published record — never a confirmed hauling need, never a
 * solicitation. The proposal (shared/trucking-4-hauling-leads-proposal-2026-10-16,
 * sections 4-5) defines the filter ladder as "R":
 *
 *   keyword arm (10 hauling terms, USAspending)
 *     + amount >= $25,000                                   (K1)
 *     + base obligation date inside the window (new award)  (K2)
 *     + award NAICS is NOT a freight/courier/postal NAICS   (K3)
 *     + DESCRIPTION matches the hauling-scope regex         (K4)
 *     + winner NAME does not read as a hauling/waste firm   (K5)
 *     + award NAICS is in the service family that plausibly
 *       subcontracts hauling: 5621 5622 5629 1153 2371 2373
 *       2389 2362 5617 5619 5612 2381 2382 5416 4881        (R)
 *
 * Measured on the 12-month pull (lexicon-raw.json, 2026-10-16): 1,775 keyword rows ->
 * 99 award rows at R (K5 = 172, K4 = 182). Reproduced exactly by `haulsScopePipeline`
 * over the committed fixture slice (src/lib/fixtures/hauling-leads/).
 */
export type HaulingScopeKind = "waste/refuse" | "debris/emergency" | "road/aggregate" | "other/hauling";
/** The winner's own NAME reads as a hauling/waste/excavation business, or it does not. */
export type HaulingPrimeKind = "work prime" | "carrier/waste firm";

export interface HaulingLead {
  /** The key we store on: USAspending's stable award key (generated_internal_id). */
  award_key: string;
  /** The award's own id (PIID) as the source publishes it. */
  award_id: string;
  /** Base obligation date — the date the award was made (stable across modifications). */
  award_date: string | null;
  /** Place-of-performance state/territory code, when the record states one. */
  pop_state: string | null;
  /** Place-of-performance city name, when the record states one. */
  pop_city: string | null;
  /** The winning prime contractor's name, verbatim from the record. */
  prime_name: string;
  prime_uei: string | null;
  amount: number;
  naics_code: string | null;
  naics_description: string | null;
  agency: string | null;
  /** The public USAspending.gov award page for this award. */
  usa_spending_url: string;
  /** The description text that triggered the hauling match (the evidence shown). */
  description_snippet: string;
  /** True for every stored row: the description passed the hauling-scope test. */
  hauling_scope: boolean;
  scope_kind: HaulingScopeKind;
  prime_kind: HaulingPrimeKind;
}

/** The exact 10-term lexicon the proposal measured with (section 1c). */
export const HAULING_KEYWORDS = [
  "hauling",
  "trucking",
  "truckload",
  "drayage",
  "flatbed",
  "refuse collection",
  "debris removal",
  "dump truck",
  "snow hauling",
  "freight trucking",
] as const;

/** Smallest award worth listing as a lead (proposal K1). */
export const HAULING_LEAD_MIN_AMOUNT = 25_000;

/**
 * The rolling re-scan window. 30 days, NOT 10: published award records arrive with a
 * lag, so a 10-day window loses most of the flow (measured 2026-10-16: 30 d = 73
 * matching awards, 10 d = 6, 7 d = 0). Every run re-reads the same 30 days and the
 * insert is idempotent, so the delay costs nothing but a repeated API call.
 */
export const HAULING_LEAD_WINDOW_DAYS = 30;

/** Page cap for one run (100 rows per page). The whole 30-day arm is far smaller. */
export const HAULING_LEAD_MAX_PAGES = 6;

/** Rows the /subcontracts section shows at most (newest first). */
export const HAULING_LEAD_DISPLAY_LIMIT = 12;

/** Fields requested from USAspending spending_by_award (display names — see src/lib/fpds.ts). */
export const HAULING_LEAD_FIELDS = [
  "Award ID",
  "Recipient Name",
  "Recipient UEI",
  "Award Amount",
  "Base Obligation Date",
  "Awarding Agency",
  "Description",
  "Place of Performance State Code",
  "Place of Performance City Name",
  "NAICS",
  "generated_internal_id",
] as const;

/**
 * K4 — the hauling-scope test over the DESCRIPTION (verbatim from the proposal's
 * measured ladder; the same regex produced the 182-row K4 arm).
 */
export const HAULING_SCOPE_RE =
  /\bhaul(?:ing|ed|s)?\b|debris removal|refuse collection|waste collection|solid waste|drayage|truckload|dump truck|snow (?:removal|hauling)|freight|recycl|logistics|transport(?:ation)? of|trucking services/i;

/**
 * K5 — the winner's NAME must not itself read as a hauling/waste firm (the winner
 * would then be a competitor, not a buyer of hauling). Verbatim from the proposal.
 */
export const HAULING_WINNER_NAME_RE =
  /\b(truck|haul|freight|transport|logistic|drayage|cartage|disposal|waste|recycl|towing)\b/i;

/**
 * K3 — freight/courier/postal NAICS: the winner IS the carrier, so the award is a
 * carrier-rate programme rather than a hauling lead.
 */
export const HAULING_CARRIER_NAICS_RE = /^(4841|4842|4921|4922|4911|4884|4885)/;

/**
 * R — the service NAICS family that plausibly subcontracts hauling (proposal section 4).
 * It removes vehicle/equipment PURCHASE rows (3331/3361/3362/3363/5324: "DUMP TRUCK",
 * "FLATBED WRECKER", "ARTICULATING DUMP TRUCKS").
 */
export const HAULING_SERVICE_NAICS_RE =
  /^(5621|5622|5629|1153|2371|2373|2389|2362|5617|5619|5612|2382|2381|5416|4881)/;

/**
 * `prime_kind = "carrier/waste firm"`: the winner's own recorded NAME reads as a
 * hauling / waste / excavation business, so the award is more likely a competitor's
 * win than a company that needs hired trucks. It is a NAME test only — the section
 * says so — and it is broader than HAULING_WINNER_NAME_RE on purpose: K5 only
 * excludes the bare words ("TRUCK", "WASTE"), while a name like "SOUTHERN OREGON
 * SANITATION LLC" or "SCOTTS HAULING & EXCAVATING INC" still reads as a fleet
 * operator once the suffixed forms count.
 */
export const HAULING_FLEET_NAME_RE =
  /\b(truck(?:s|ing|er|ers)?|haul(?:s|ing|er|ers)?|freight|transport(?:s|ation|er|ers)?|logistic(?:s)?|drayage|cartage|disposal|waste|recycl(?:e|s|ing|er|ers)?|towing|sanitation|salvage|junk|scrap|excavat(?:e|es|ing|ion|or|ors)?|earthwork(?:s)?|demolition)\b/i;

/** Precomputed scope families, in the precedence the classifier applies them. */
const SCOPE_FAMILIES: readonly [Exclude<HaulingScopeKind, "other/hauling">, RegExp][] = [
  [
    "waste/refuse",
    /refuse|waste|recycl|sanitation|disposal|dumpster|roll-?off|biosolid|sludge|wwtp|wastewater|scrap|tire/i,
  ],
  [
    "debris/emergency",
    /debris|emergenc|emrgenc|hazard|storm|hurricane|flood|tree|vegetation|chipping|spoil|snow|ice|mastication|mulch/i,
  ],
  [
    "road/aggregate",
    /aggregate|asphalt|gravel|road|roadway|haul road|base course|earth|excavat|dirt|fill|surfacing|stone|rock|quarry|ditch|grading|pave|paving/i,
  ],
];

/** The award's scope wording names no family: "hauling"/"trucking" and nothing else. */
export const HAULING_SCOPE_KINDS: readonly HaulingScopeKind[] = [
  "waste/refuse",
  "debris/emergency",
  "road/aggregate",
  "other/hauling",
];

export const HAULING_PRIME_KINDS: readonly HaulingPrimeKind[] = ["work prime", "carrier/waste firm"];

const text = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};

/** Collapses whitespace so a description renders on one line, capped for storage. */
export function normalizeDescription(v: unknown, max = 500): string {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return s.slice(0, max);
}

/** NAICS may arrive as an object with a `code`, or as a bare code. */
export function naicsCode(v: unknown): string | null {
  if (v && typeof v === "object" && "code" in (v as Record<string, unknown>)) {
    return text((v as { code?: unknown }).code);
  }
  return text(v);
}

/** K4 — does the DESCRIPTION carry hauling-scope wording? */
export function descriptionHasHaulingScope(description: unknown): boolean {
  return HAULING_SCOPE_RE.test(String(description ?? ""));
}

/** K5 — does the winner's NAME read as a hauling/waste firm (so the row is dropped)? */
export function winnerNameIsHaulingFirm(name: unknown): boolean {
  return HAULING_WINNER_NAME_RE.test(String(name ?? ""));
}

/** K3 — is the award NAICS a freight/courier/postal one? */
export function isCarrierNaics(code: string | null | undefined): boolean {
  return HAULING_CARRIER_NAICS_RE.test(String(code ?? ""));
}

/** R — is the award NAICS in the service family that plausibly subcontracts hauling? */
export function isServiceNaics(code: string | null | undefined): boolean {
  return HAULING_SERVICE_NAICS_RE.test(String(code ?? ""));
}

/** Precomputed scope family, by documented precedence; "other/hauling" when none is named. */
export function classifyScopeKind(description: unknown): HaulingScopeKind {
  const d = String(description ?? "");
  for (const [kind, re] of SCOPE_FAMILIES) {
    if (re.test(d)) return kind;
  }
  return "other/hauling";
}

/** Precomputed winner kind, from the winner's NAME only. */
export function classifyPrimeKind(name: unknown): HaulingPrimeKind {
  return HAULING_FLEET_NAME_RE.test(String(name ?? "")) ? "carrier/waste firm" : "work prime";
}

/** The public USAspending.gov award page for a stored award key. */
export function awardPageUrl(awardKey: string): string {
  return `https://www.usaspending.gov/award/${encodeURIComponent(awardKey)}`;
}

/**
 * One USAspending spending_by_award row -> a hauling lead, or null when the row fails
 * the ladder (K3/K4/K5/R and the amount floor). `windowStart` (YYYY-MM-DD) enforces K2
 * ("the award was MADE inside the window"); the server-side filter asks for new awards,
 * and this is the local truth that does not depend on it.
 */
export function toHaulingLead(
  row: Record<string, unknown>,
  opts: { windowStart: string; minAmount?: number },
): HaulingLead | null {
  const minAmount = opts.minAmount ?? HAULING_LEAD_MIN_AMOUNT;
  const awardKey = text(row["generated_internal_id"]);
  const awardId = text(row["Award ID"]);
  const primeName = text(row["Recipient Name"]);
  if (!awardKey || !awardId || !primeName) return null;

  const amount = Number(row["Award Amount"]);
  if (!Number.isFinite(amount) || amount < minAmount) return null;

  const awardDate = text(row["Base Obligation Date"])?.slice(0, 10) ?? null;
  if (!awardDate || !/^\d{4}-\d{2}-\d{2}$/.test(awardDate)) return null;
  // K2 — a newly MADE award, not a modification of an older one.
  if (awardDate < opts.windowStart) return null;

  const code = naicsCode(row["NAICS"]);
  // K3 — the winner is not the carrier itself.
  if (isCarrierNaics(code)) return null;
  // R — the award NAICS plausibly subcontracts hauling (drops equipment/vehicle buys).
  if (!isServiceNaics(code)) return null;
  // K4 — the description carries hauling-scope wording.
  const description = row["Description"];
  if (!descriptionHasHaulingScope(description)) return null;
  // K5 — the winner's name does not read as a hauling/waste firm.
  if (winnerNameIsHaulingFirm(primeName)) return null;

  const popState = text(row["Place of Performance State Code"])?.toUpperCase() ?? null;
  const popCity = text(row["Place of Performance City Name"]);

  return {
    award_key: awardKey,
    award_id: awardId,
    award_date: awardDate,
    pop_state: popState && /^[A-Z]{2}$/.test(popState) ? popState : null,
    pop_city: popCity,
    prime_name: primeName,
    prime_uei: text(row["Recipient UEI"]),
    // Stored as whole dollars (the column is BIGINT, like award_leads): USAspending
    // publishes cents ("639047.35") and the cents carry no meaning for a lead list.
    amount: Math.round(amount),
    naics_code: code ? code.slice(0, 6) : null,
    naics_description: null,
    agency: text(row["Awarding Agency"]),
    usa_spending_url: awardPageUrl(awardKey),
    description_snippet: normalizeDescription(description),
    hauling_scope: true,
    scope_kind: classifyScopeKind(description),
    prime_kind: classifyPrimeKind(primeName),
  };
}

export interface HaulingPipelineResult {
  /** Rows offered to the ladder. */
  offered: number;
  /** Rows that survive every stage (the stored set). */
  kept: HaulingLead[];
  /** Rows dropped, per stage, in the order the ladder applies them. */
  dropped: {
    missing_identity: number;
    below_min_amount: number;
    bad_or_missing_date: number;
    outside_window: number;
    carrier_naics: number;
    non_service_naics: number;
    no_scope_wording: number;
    winner_name_is_hauling_firm: number;
  };
}

/**
 * The whole ladder over a set of USAspending rows, WITH per-stage accounting, so a
 * fixture can pin each rung rather than only the final count.
 */
export function haulsScopePipeline(
  rows: readonly Record<string, unknown>[],
  opts: { windowStart: string; minAmount?: number },
): HaulingPipelineResult {
  const minAmount = opts.minAmount ?? HAULING_LEAD_MIN_AMOUNT;
  const dropped: HaulingPipelineResult["dropped"] = {
    missing_identity: 0,
    below_min_amount: 0,
    bad_or_missing_date: 0,
    outside_window: 0,
    carrier_naics: 0,
    non_service_naics: 0,
    no_scope_wording: 0,
    winner_name_is_hauling_firm: 0,
  };
  const kept: HaulingLead[] = [];
  for (const row of rows) {
    const awardKey = text(row["generated_internal_id"]);
    const awardId = text(row["Award ID"]);
    const primeName = text(row["Recipient Name"]);
    if (!awardKey || !awardId || !primeName) {
      dropped.missing_identity++;
      continue;
    }
    const amount = Number(row["Award Amount"]);
    if (!Number.isFinite(amount) || amount < minAmount) {
      dropped.below_min_amount++;
      continue;
    }
    const awardDate = text(row["Base Obligation Date"])?.slice(0, 10) ?? null;
    if (!awardDate || !/^\d{4}-\d{2}-\d{2}$/.test(awardDate)) {
      dropped.bad_or_missing_date++;
      continue;
    }
    if (awardDate < opts.windowStart) {
      dropped.outside_window++;
      continue;
    }
    const code = naicsCode(row["NAICS"]);
    if (isCarrierNaics(code)) {
      dropped.carrier_naics++;
      continue;
    }
    if (!isServiceNaics(code)) {
      dropped.non_service_naics++;
      continue;
    }
    if (!descriptionHasHaulingScope(row["Description"])) {
      dropped.no_scope_wording++;
      continue;
    }
    if (winnerNameIsHaulingFirm(primeName)) {
      dropped.winner_name_is_hauling_firm++;
      continue;
    }
    const lead = toHaulingLead(row, { windowStart: opts.windowStart, minAmount });
    if (lead) kept.push(lead);
  }
  return { offered: rows.length, kept, dropped };
}

/** ISO date `days` before `now` (the window start for a rolling re-scan). */
export function windowStartFor(now: Date, days = HAULING_LEAD_WINDOW_DAYS): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** The body of the USAspending request this job sends (kept here so a test can pin it). */
export function buildHaulingSearchBody(opts: {
  startDate: string;
  endDate: string;
  page?: number;
}): Record<string, unknown> {
  return {
    filters: {
      award_type_codes: ["A", "B", "C", "D"],
      time_period: [{ start_date: opts.startDate, end_date: opts.endDate, date_type: "new_awards_only" }],
      keywords: HAULING_KEYWORDS,
      award_amounts: [{ lower_bound: HAULING_LEAD_MIN_AMOUNT }],
    },
    fields: HAULING_LEAD_FIELDS,
    limit: 100,
    page: opts.page ?? 1,
    subawards: false,
  };
}
