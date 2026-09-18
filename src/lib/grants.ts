/**
 * Contrax Grants — V1 shared logic (owner order 2026-09-16).
 *
 * PURE MODULE: no DB, no network, no node builtins, no env reads at import time.
 * Everything here is unit-tested in src/lib/grants.test.ts. The server-only
 * network half lives in src/lib/grants.server.ts; the page + API route import
 * from both.
 *
 * DATA SOURCE (owner-mandated): the official Grants.gov search web service
 *   POST https://api.grants.gov/v1/api/search2          (search)
 *   POST https://api.grants.gov/v1/api/fetchOpportunity (per-opportunity detail)
 * Verified live from the sandbox 2026-09-16 (HTTP 200, no API key required —
 * Simpler.Grants.gov's /v1/opportunities/search returns 401 Unauthorized
 * without a key, so the legacy-but-official Grants.gov service is the source we
 * use; GRANTS_GOV_API_KEY is still honored server-side when set, see
 * grants.server.ts). Grants are NEVER written to bids/solicitations or any
 * contract table — live search only.
 *
 * HONESTY CONTRACT (owner-mandated, non-negotiable): every displayed field comes
 * from the source response verbatim-or-nothing. A missing funding amount, set of
 * eligible applicants, date, or description renders as "Not specified" — never
 * an invented or inferred value. Results are called "potential matches" (never
 * "you qualify"): eligibility is shown exactly as Grants.gov lists it.
 *
 * ISOLATION CONTRACT: nothing in this module — and none of the six grants_*
 * analytics events (src/lib/grants-analytics.ts) — is ever part of the Radar
 * conversion funnel, the unified funnel, or the Radar-leads funnel.
 *
 * FRESHNESS CONTRACT (owner order 2026-09-18 — see
 * shared/grants-freshness-fix-2026-09-18.md). There is NO grants record
 * storage: every search is a live call to Grants.gov, so "freshness" is decided
 * per request from the source's own current fields:
 *   1. `oppStatus` (search2) is the ONLY authority for status. A forecast is
 *      NEVER promoted to open on an estimated date — forecasts carry no
 *      closing date at all upstream (verified live: 590/590 forecasted rows in
 *      the whole corpus had an empty `closeDate`), so the only thing an
 *      estimate can do is age.
 *   2. Open = source-confirmed `posted` AND a published `closeDate` that has not
 *      passed. `posted` + missing deadline and `posted` + past deadline are
 *      NEVER open (conservative by construction — a record we cannot confirm is
 *      never silently shown as open).
 *   3. Forecasts are their own filter (`forecasted`) and are labelled
 *      "Forecast — not yet open for applications"; an estimated date supplied by
 *      the source is labelled "Estimated", never rendered as a Closing date.
 *   4. Closed/archived stay searchable under `closed` and are excluded from the
 *      open results and the open count.
 *   5. `fetchOpportunity` (detail) is used for enrichment only — funding,
 *      eligibility, description, the source's last-updated stamp and a
 *      forecast's estimated date. Classification NEVER depends on it, so the
 *      page stays correct when the detail service is unavailable (it was down
 *      for earlier work on 2026-09-18 and recovered; probed live 17:39 UTC).
 */

/** Displayed source label on every result card (owner-mandated). */
export const GRANTS_SOURCE_LABEL = "Grants.gov";

/** Official Grants.gov search + detail web services (verified live 2026-09-16). */
export const GRANTS_UPSTREAM_SEARCH_URL = "https://api.grants.gov/v1/api/search2";
export const GRANTS_UPSTREAM_DETAIL_URL = "https://api.grants.gov/v1/api/fetchOpportunity";

/**
 * Official public opportunity page. Grants.gov's current detail route is
 * /search-results-detail/<numeric opportunityId> (verified 200 for the real
 * opportunity ids returned by search2). The numeric `id` — NOT the opportunity
 * number string — is what this route expects.
 */
export const GRANTS_OFFICIAL_URL_BASE = "https://www.grants.gov/search-results-detail/";

/** Shown wherever the source supplied no value (owner-mandated wording). */
export const NOT_SPECIFIED = "Not specified";

/** Notice required on the page (owner-mandated): grants target organizations. */
export const GRANTS_ORG_NOTICE =
  "Grants.gov opportunities are generally for organizations and entities — not personal financial assistance.";

/** Anonymous preview: at most this many result cards per visitor. */
export const PREVIEW_LIMIT = 3;
/** Results per page for authenticated visitors (and the upstream page size). */
export const PAGE_SIZE = 10;
/** Pagination cap — "Load more" stops after this page (5 × 10 = 50 max). */
export const MAX_PAGE = 5;
/** Keyword length cap (validated server-side, mirrored by input maxLength). */
export const MAX_KEYWORD_LENGTH = 120;
/** Hard cap on the upstream-supplied description we render (plain text). */
export const MAX_DESCRIPTION_LENGTH = 400;

export type GrantsStatus = "open" | "forecast" | "closed";

/** Status filter → the upstream `oppStatuses` pipe-separated value. */
export const GRANTS_STATUSES: readonly GrantsStatus[] = ["open", "forecast", "closed"] as const;

/**
 * Status filter → upstream `oppStatuses` (owner fix 2026-09-18).
 *
 * Open = `posted` ONLY. It used to be "posted|forecasted" (the Grants.gov search
 * UI's own default) — that is what put MP-CPI-25-001/003 (FY2025 forecasts whose
 * estimated response dates, Jun 23 / Jul 1 2025, had long passed) into the Open
 * results. Forecasts are not open for applications, so they get their own filter
 * instead of hiding inside Open.
 * Forecast = `forecasted` only. Closed = `closed` only; `archived` is
 * deliberately NOT included — it is a ~73k-row historical bucket that would
 * swamp the page (probed live 2026-09-16) and it is not "closed" as the source
 * defines it.
 */
export const OPP_STATUSES_BY_FILTER: Record<GrantsStatus, string> = {
  open: "posted",
  forecast: "forecasted",
  closed: "closed",
};

/**
 * The status we actually DERIVE for a hit, from source fields only:
 *   open        – source says posted AND a published deadline has not passed
 *   expired     – source says posted AND its deadline has passed
 *   forecast    – source says forecasted (an estimated date is never enough)
 *   closed      – source says closed
 *   unconfirmed – source status missing/unrecognised, or posted with no usable
 *                 deadline ⇒ conservative: never treated as open
 */
export type GrantDerivedStatus = "open" | "expired" | "forecast" | "closed" | "unconfirmed";

/** Human labels for the derived status (shown on every card). */
export const GRANT_DERIVED_LABELS: Record<GrantDerivedStatus, string> = {
  open: "Open — accepting applications",
  expired: "Deadline passed",
  forecast: "Forecast — not yet open for applications",
  closed: "Closed",
  unconfirmed: "Status not confirmed by source",
};

/** When the source did not publish a "last updated" value for a card. */
export const SOURCE_LAST_UPDATED_NOT_PUBLISHED = "Not published";
/** When we did not retrieve that card's detail at all (never called "Not published"). */
export const SOURCE_LAST_UPDATED_NOT_CHECKED = "Not checked";

/**
 * Hard upstream cap on rows per search2 request (verified live 2026-09-18:
 * `rows: 5000`/`20000` both returned exactly 1000 hits, and `rows: 1000` on
 * keyword "a" returned 789 = its hitCount). The open-count scan asks for this
 * many rows and is therefore EXACT whenever the status-filtered result set is
 * ≤ this number — which was the case for the entire live `posted` corpus
 * (951 rows) on 2026-09-18. Above it the count is an honest lower bound ("N+").
 */
export const COUNT_SCAN_ROWS = 1000;

export interface GrantsOption {
  value: string;
  label: string;
}

/**
 * Applicant type → Grants.gov eligibility code (the source's own enumerations as
 * returned in the search2 `eligibilities` facet, verified live 2026-09-16).
 * CLOSED LIST: the `applicantType` query param must be one of these values.
 */
export const APPLICANT_TYPES: readonly GrantsOption[] = [
  { value: "00", label: "State governments" },
  { value: "01", label: "County governments" },
  { value: "02", label: "City or township governments" },
  { value: "04", label: "Special district governments" },
  { value: "05", label: "Independent school districts" },
  { value: "06", label: "Public and State controlled institutions of higher education" },
  { value: "07", label: "Native American tribal governments (Federally recognized)" },
  { value: "08", label: "Public housing authorities/Indian housing authorities" },
  {
    value: "11",
    label: "Native American tribal organizations (other than Federally recognized tribal governments)",
  },
  {
    value: "12",
    label: "Nonprofits having a 501(c)(3) status with the IRS, other than institutions of higher education",
  },
  {
    value: "13",
    label: "Nonprofits that do not have a 501(c)(3) status with the IRS, other than institutions of higher education",
  },
  { value: "20", label: "Private institutions of higher education" },
  { value: "21", label: "Individuals" },
  { value: "22", label: "For profit organizations other than small businesses" },
  { value: "23", label: "Small businesses" },
  {
    value: "25",
    label:
      'Others (see text field entitled "Additional Information on Eligibility" for clarification)',
  },
  {
    value: "99",
    label:
      'Unrestricted (i.e., open to any type of entity above), subject to any clarification in text field entitled "Additional Information on Eligibility"',
  },
] as const;

/**
 * Funding category → Grants.gov funding-activity code (source facet as returned
 * live 2026-09-16). CLOSED LIST for the `fundingCategory` query param.
 */
export const FUNDING_CATEGORIES: readonly GrantsOption[] = [
  { value: "AG", label: "Agriculture" },
  { value: "AR", label: "Arts" },
  { value: "BC", label: "Business and Commerce" },
  { value: "CD", label: "Community Development" },
  { value: "CP", label: "Consumer Protection" },
  { value: "DPR", label: "Disaster Prevention and Relief" },
  { value: "ED", label: "Education" },
  { value: "ELT", label: "Employment, Labor and Training" },
  { value: "EN", label: "Energy" },
  { value: "ENV", label: "Environment" },
  { value: "FN", label: "Food and Nutrition" },
  { value: "HL", label: "Health" },
  { value: "HU", label: "Humanities" },
  { value: "IIJ", label: "Infrastructure Investment and Jobs Act (IIJA)" },
  { value: "IS", label: "Information and Statistics" },
  { value: "ISS", label: "Income Security and Social Services" },
  { value: "LJL", label: "Law, Justice and Legal Services" },
  { value: "NR", label: "Natural Resources" },
  {
    value: "O",
    label:
      'Other (see text field entitled "Explanation of Other Category of Funding Activity" for clarification)',
  },
  { value: "ST", label: "Science and Technology and other Research and Development" },
  { value: "T", label: "Transportation" },
] as const;

/**
 * Agency → Grants.gov top-level agency code (source facet as returned live
 * 2026-09-16). CLOSED LIST for the `agency` query param.
 *
 * NOTE: the labels are Grants.gov's OWN facet labels, copied verbatim (including
 * the source's quirk that `USDOT` is labelled "Department of the Treasury" while
 * `DOT` is Transportation). We do not "fix" source labels — an invented label
 * would be exactly the kind of fabrication this feature forbids.
 */
export const AGENCIES: readonly GrantsOption[] = [
  { value: "AC", label: "AmeriCorps" },
  { value: "USDA", label: "Department of Agriculture" },
  { value: "DOC", label: "Department of Commerce" },
  { value: "DOD", label: "Department of Defense" },
  { value: "ED", label: "Department of Education" },
  { value: "DOE", label: "Department of Energy" },
  { value: "PAMS", label: "Department of Energy - Office of Science" },
  { value: "HHS", label: "Department of Health and Human Services" },
  { value: "DHS", label: "Department of Homeland Security" },
  { value: "HUD", label: "Department of Housing and Urban Development" },
  { value: "USDOJ", label: "Department of Justice" },
  { value: "DOL", label: "Department of Labor" },
  { value: "DOS", label: "Department of State" },
  { value: "DOI", label: "Department of the Interior" },
  { value: "USDOT", label: "Department of the Treasury" },
  { value: "DOT", label: "Department of Transportation" },
  { value: "VA", label: "Department of Veterans Affairs" },
  { value: "EPA", label: "Environmental Protection Agency" },
  { value: "IMLS", label: "Institute of Museum and Library Services" },
  { value: "LOC", label: "Library of Congress" },
  { value: "MC", label: "Microhealth LLC" },
  { value: "MCC", label: "Millennium Challenge Corporation" },
  { value: "NASA", label: "National Aeronautics and Space Administration" },
  { value: "NEA", label: "National Endowment for the Arts" },
  { value: "NEH", label: "National Endowment for the Humanities" },
  { value: "NSF", label: "U.S. National Science Foundation" },
] as const;

const APPLICANT_TYPE_CODES: readonly string[] = APPLICANT_TYPES.map((o) => o.value);
const FUNDING_CATEGORY_CODES: readonly string[] = FUNDING_CATEGORIES.map((o) => o.value);
const AGENCY_CODES: readonly string[] = AGENCIES.map((o) => o.value);

export interface GrantsSearchParams {
  keyword: string;
  applicantType: string | null;
  fundingCategory: string | null;
  agency: string | null;
  status: GrantsStatus;
  page: number;
}

export type ParseGrantsParamsResult =
  | { ok: true; params: GrantsSearchParams }
  | { ok: false; error: string };

/**
 * Strips control characters (incl. newlines) and caps length. The keyword is
 * sent to Grants.gov inside a JSON body — never concatenated into a URL — so
 * this is hygiene, not escaping; the request body is JSON.stringify'd in
 * grants.server.ts.
 */
export function sanitizeKeyword(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Validates + bounds EVERY query parameter. Unknown params are ignored; a
 * present-but-invalid enum/param is a hard 400 (never silently coerced).
 */
export function parseGrantsSearchParams(search: URLSearchParams): ParseGrantsParamsResult {
  const rawKeyword = search.get("keyword");
  if (rawKeyword !== null && rawKeyword.length > MAX_KEYWORD_LENGTH) {
    return { ok: false, error: `keyword must be at most ${MAX_KEYWORD_LENGTH} characters` };
  }
  const keyword = sanitizeKeyword(rawKeyword);
  if (keyword.length > MAX_KEYWORD_LENGTH) {
    return { ok: false, error: `keyword must be at most ${MAX_KEYWORD_LENGTH} characters` };
  }

  const applicantType = readEnum(search, "applicantType", APPLICANT_TYPE_CODES);
  if (applicantType === false) return { ok: false, error: "invalid applicantType" };

  const fundingCategory = readEnum(search, "fundingCategory", FUNDING_CATEGORY_CODES);
  if (fundingCategory === false) return { ok: false, error: "invalid fundingCategory" };

  const agency = readEnum(search, "agency", AGENCY_CODES);
  if (agency === false) return { ok: false, error: "invalid agency" };

  const rawStatus = search.get("status");
  let status: GrantsStatus = "open"; // Open by default (owner spec).
  if (rawStatus !== null && rawStatus !== "") {
    if (!GRANTS_STATUSES.includes(rawStatus as GrantsStatus)) {
      return { ok: false, error: "invalid status" };
    }
    status = rawStatus as GrantsStatus;
  }

  const rawPage = search.get("page");
  let page = 1;
  if (rawPage !== null && rawPage !== "") {
    if (!/^\d{1,3}$/.test(rawPage)) return { ok: false, error: "invalid page" };
    page = Number(rawPage);
    if (page < 1 || page > MAX_PAGE) {
      return { ok: false, error: `page must be between 1 and ${MAX_PAGE}` };
    }
  }

  return { ok: true, params: { keyword, applicantType, fundingCategory, agency, status, page } };
}

/** null → not provided; false → provided but invalid; string → valid value. */
function readEnum(
  search: URLSearchParams,
  key: string,
  allowed: readonly string[],
): string | null | false {
  const raw = search.get(key);
  if (raw === null || raw === "") return null;
  return allowed.includes(raw) ? raw : false;
}

/** Upstream `startRecordNum` for a 1-based page number. */
export function startRecordForPage(page: number): number {
  return (Math.max(1, page) - 1) * PAGE_SIZE;
}

/** The JSON body sent to Grants.gov's search2 service (single source of truth). */
export function buildUpstreamSearchBody(
  params: GrantsSearchParams,
  /**
   * Optional overrides for the paging window. Used by the bounded open-count
   * scan (`rows: COUNT_SCAN_ROWS`, `startRecordNum: 0`); the visitor search path
   * always uses the defaults below, so its body is byte-identical to before.
   */
  overrides: { rows?: number; startRecordNum?: number } = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    keyword: params.keyword,
    oppStatuses: OPP_STATUSES_BY_FILTER[params.status],
    rows: overrides.rows ?? PAGE_SIZE,
    startRecordNum: overrides.startRecordNum ?? startRecordForPage(params.page),
  };
  // Only send the filters the visitor actually chose — an empty string is a real
  // upstream filter value meaning "no restriction", so it must be omitted.
  if (params.applicantType) body.eligibilities = params.applicantType;
  if (params.fundingCategory) body.fundingCategories = params.fundingCategory;
  if (params.agency) body.agencies = params.agency;
  return body;
}

// ── Freshness: source dates + derived status ─────────────────────────────────

/**
 * Grants.gov's search2 date format — `MM/DD/YYYY`, empty string when absent
 * (verified live 2026-09-18: `"10/31/2026"` for posted rows, `""` for every
 * forecast). Returns the UTC midnight epoch of the calendar day, or null when
 * the source did not supply a usable date. No other format is accepted: guessing
 * a date is exactly the fabrication this feature forbids.
 */
export function parseSourceDay(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(ms)) return null;
  return ms;
}

/**
 * Start (UTC midnight) of "today" in US Eastern Time — the day boundary the
 * whole Grants.gov product line uses (the source's own dates and deadlines are
 * Eastern: "Applications must be submitted electronically no later than 6:00 pm
 * Eastern Time", observed live in a forecast detail).
 *
 * The deadline DAY IS INCLUSIVE: a `posted` opportunity whose `closeDate` equals
 * the current ET date is still open — the deadline has not passed yet. Only a
 * closeDate strictly BEFORE today (ET) is expired.
 *
 * Documented and tested rather than assumed: at 2026-09-19T02:00:00Z it is still
 * 2026-09-18 in ET (22:00 the previous evening), so a 09/18/2026 deadline is
 * still open. A UTC-day rule would have wrongly expired it.
 */
export function easternDayStart(now: Date | number): number {
  const d = typeof now === "number" ? new Date(now) : now;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return NaN;
  try {
    // en-CA renders YYYY-MM-DD, which is unambiguous to parse back.
    const et = d.toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(et);
    if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } catch {
    /* Intl/timeZone unavailable — fall through to the UTC day */
  }
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * The freshness decision for one hit, from source fields only.
 *
 * `rawOppStatus` is the source's CURRENT status (search2 `oppStatus`) and is the
 * only authority for it: an amendment is reflected there directly (verified live
 * 2026-09-18 — id 363657 carries the amended `closeDate: 10/15/2026`, with the
 * pre-amendment value preserved by the source as `originalDueDate: 10/05/2026`
 * and the amendment stamped by `synopsis.lastUpdatedDate` "Sep 09, 2026"; the
 * amendment COMMENT field was empty in that capture, so nothing but the source's
 * own dates is claimed). We therefore need no "superseding" logic of our own, and
 * we must never infer a status change from an estimated date.
 *
 * Conservative by construction: anything we cannot confirm as posted-and-not-yet-
 * due is NOT open (missing status, missing/unparseable deadline, past deadline).
 */
export function classifyGrantStatus(
  rawOppStatus: unknown,
  closeDate: unknown,
  now: Date | number = new Date(),
): GrantDerivedStatus {
  const status = typeof rawOppStatus === "string" ? rawOppStatus.trim().toLowerCase() : "";
  if (status === "forecasted") return "forecast";
  if (status === "closed") return "closed";
  if (status !== "posted") return "unconfirmed";
  const deadline = parseSourceDay(closeDate);
  if (deadline === null) return "unconfirmed"; // requirement: posted + no deadline is never Open
  return deadline >= easternDayStart(now) ? "open" : "expired";
}

/** Does a derived status belong in the tab the visitor asked for? */
export function derivedStatusMatchesFilter(
  derived: GrantDerivedStatus,
  status: GrantsStatus,
): boolean {
  if (status === "open") return derived === "open";
  if (status === "forecast") return derived === "forecast";
  return derived === "closed";
}

/**
 * Keeps only the rows whose DERIVED status matches the active filter, so a card
 * can never be displayed under a status the source does not confirm for it.
 */
export function filterResultsForStatus<T extends { derivedStatus: GrantDerivedStatus }>(
  results: readonly T[],
  status: GrantsStatus,
): T[] {
  return results.filter((r) => derivedStatusMatchesFilter(r.derivedStatus, status));
}

/** Per-status tally of a scanned hit window (the open-count scan). */
export interface GrantsStatusTally {
  open: number;
  expired: number;
  forecast: number;
  closed: number;
  unconfirmed: number;
  /** `posted` rows whose deadline is past — reported so it is never hidden. */
  expiredPosted: number;
  /** `posted` rows with no published deadline — excluded from the open count. */
  missingDeadline: number;
}

/**
 * Tallies a scanned window by derived status. Used by the bounded open-count
 * scan: the Open tab's upstream request is `posted` only, so an `open` here is
 * exactly "source-confirmed posted with a deadline that has not passed".
 */
export function tallyGrantStatuses(
  hits: readonly GrantsUpstreamHit[],
  now: Date | number = new Date(),
): GrantsStatusTally {
  const tally: GrantsStatusTally = {
    open: 0,
    expired: 0,
    forecast: 0,
    closed: 0,
    unconfirmed: 0,
    expiredPosted: 0,
    missingDeadline: 0,
  };
  for (const hit of hits) {
    const derived = classifyGrantStatus(hit?.oppStatus, hit?.closeDate, now);
    tally[derived] += 1;
    const raw = typeof hit?.oppStatus === "string" ? hit.oppStatus.trim().toLowerCase() : "";
    if (raw === "posted") {
      if (derived === "expired") tally.expiredPosted += 1;
      if (derived === "unconfirmed") tally.missingDeadline += 1;
    }
  }
  return tally;
}

/**
 * Normalises a long source timestamp ("Sep 09, 2026 11:09:00 AM EDT") to
 * "Sep 09, 2026". Returns null when the source supplied nothing we can read as a
 * date — the card then says "Not published" rather than showing a guess.
 */
export function formatSourceDayText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(raw.trim());
  return m ? m[1] : null;
}

const MONTH_INDEX: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

/**
 * The epoch day of a long source date ("Jun 23, 2025 12:00:00 AM EDT" — the
 * format fetchOpportunity uses, including for a forecast's
 * `estApplicationResponseDate`). Null when it cannot be read as a date.
 */
export function parseSourceLongDay(raw: unknown): number | null {
  const text = formatSourceDayText(raw);
  if (!text) return null;
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(text);
  if (!m) return null;
  const month = MONTH_INDEX[m[1]];
  if (month === undefined) return null;
  return Date.UTC(Number(m[3]), month, Number(m[2]));
}

/**
 * The honest count label for the active filter. `exact === false` appends "+"
 * and is used only when the bounded scan could not cover the whole result set —
 * a lower bound is shown as a lower bound, never as a total.
 */
export function describeGrantCount(
  status: GrantsStatus,
  count: number,
  exact: boolean,
): string {
  const n = `${count.toLocaleString("en-US")}${exact ? "" : "+"}`;
  const noun = count === 1 ? "opportunity" : "opportunities";
  if (status === "open") return `${n} posted ${noun} accepting applications`;
  if (status === "forecast") return `${n} forecasted ${noun} — not yet open for applications`;
  return `${n} closed ${noun}`;
}

/**
 * The single date row a card shows, chosen so an estimated date can never be
 * presented as a closing date. Pure + tested; the page renders exactly this.
 */
export function grantDeadlineDisplay(result: {
  derivedStatus: GrantDerivedStatus;
  closingDate: string | null;
  estimatedDeadline: string | null;
}): { label: string; value: string } | null {
  if (result.derivedStatus === "forecast") {
    if (!result.estimatedDeadline) return null; // never invent one for a forecast
    return {
      label: "Estimated application deadline",
      value: `${result.estimatedDeadline} (source estimate — not a posted closing date)`,
    };
  }
  if (result.derivedStatus === "expired") {
    return { label: "Deadline passed", value: result.closingDate ?? NOT_SPECIFIED };
  }
  if (result.derivedStatus === "open" || result.derivedStatus === "closed") {
    return { label: "Closing date", value: result.closingDate ?? NOT_SPECIFIED };
  }
  return result.closingDate
    ? { label: "Source closing date", value: result.closingDate }
    : { label: "Closing date", value: NOT_SPECIFIED };
}


// ── Response mapping ─────────────────────────────────────────────────────────

/** One entry of the upstream search2 `oppHits` array (all fields untrusted). */
export interface GrantsUpstreamHit {
  id?: unknown;
  number?: unknown;
  title?: unknown;
  agency?: unknown;
  agencyCode?: unknown;
  openDate?: unknown;
  closeDate?: unknown;
  oppStatus?: unknown;
  docType?: unknown;
}

/** The subset of fetchOpportunity's detail we render (untrusted). */
export interface GrantsUpstreamDetail {
  awardFloor?: unknown;
  awardCeiling?: unknown;
  estimatedFunding?: unknown;
  postingDate?: unknown;
  responseDate?: unknown;
  applicantTypes?: unknown;
  synopsisDesc?: unknown;
  /**
   * ESTIMATED application deadline. Forecasts have no synopsis; their detail
   * carries `forecast.estApplicationResponseDate` (normalised to this field by
   * grants.server.ts). It is an estimate, never a closing date, and it is shown
   * only with an explicit "Estimated" label.
   */
  estimatedDeadline?: unknown;
  /** The source's own "last updated" stamp (`synopsis.lastUpdatedDate`). */
  lastUpdated?: unknown;
}

export interface GrantResult {
  /** Upstream numeric opportunity id — used to build the official URL. */
  id: string;
  opportunityNumber: string;
  title: string;
  agency: string;
  agencyCode: string;
  /** Raw source status, verbatim (`posted` / `forecasted` / `closed`). */
  status: string;
  /**
   * The status we actually act on, derived from source fields only by
   * classifyGrantStatus(). A card is never shown under a status the source does
   * not confirm — this is what keeps past-dated forecasts out of Open.
   */
  derivedStatus: GrantDerivedStatus;
  postedDate: string | null;
  closingDate: string | null;
  /**
   * Source-supplied ESTIMATED application deadline (forecast detail only).
   * Never rendered as a closing date — see grantDeadlineDisplay().
   */
  estimatedDeadline: string | null;
  /** True only when the source supplied an estimate that is already in the past. */
  estimatedDeadlinePassed: boolean;
  /**
   * The source's own "last updated" date ("Sep 09, 2026"), or null. Paired with
   * `sourceLastUpdatedKnown`: null + known ⇒ the source published none (render
   * "Not published"); null + unknown ⇒ we did not retrieve the detail (render
   * "Not checked"). The two must never be conflated.
   */
  sourceLastUpdated: string | null;
  sourceLastUpdatedKnown: boolean;
  /** Source-supplied funding, already formatted; null → "Not specified". */
  estimatedFunding: string | null;
  /** Source-supplied eligible applicant types (id + description), may be empty. */
  eligibleApplicants: string[];
  /** Tag-stripped, entity-decoded source description; null when not supplied. */
  description: string | null;
  /** Official Grants.gov opportunity page (or null when the id is unusable). */
  officialUrl: string | null;
  source: typeof GRANTS_SOURCE_LABEL;
}

/** Minimal HTML entity table — the ones Grants.gov titles/synopses actually use. */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  bull: "•",
};

/**
 * Source text → plain text. Tags are stripped BEFORE entity decoding and any
 * tag-like sequence surviving decoding is stripped again, so source markup can
 * never reach the DOM as markup (the UI renders these strings as text; there is
 * no dangerouslySetInnerHTML anywhere in the grants surface).
 *
 * This is needed for TITLES and AGENCY names too, not just descriptions:
 * Grants.gov returns e.g. "…(Research &amp; Engineering)" in oppHits.title
 * (observed live 2026-09-16), which would otherwise render literally as
 * "&amp;" — the source's own entity, displayed wrong.
 */
export function decodeSourceText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  text = text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[String(name).toLowerCase()] ?? m)
    .replace(/<[^>]*>/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

/** decodeSourceText + a hard length cap (used for the rendered description). */
export function toPlainText(raw: unknown, maxLength = MAX_DESCRIPTION_LENGTH): string {
  const text = decodeSourceText(raw);
  if (text.length > maxLength) {
    return text.slice(0, maxLength).replace(/\s+\S*$/, "") + "…";
  }
  return text;
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Non-empty trimmed string, or null. */
function asText(raw: unknown): string | null {
  if (typeof raw === "string") {
    const t = raw.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
}

/**
 * Funding is rendered ONLY from source numbers. Grants.gov uses "none"/""/0 for
 * "no amount published" — all three map to null → the UI prints "Not specified".
 * Nothing is ever estimated, averaged, or inferred.
 */
export function formatFundingValue(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return formatUsd(raw);
  }
  const text = String(raw).trim();
  if (!text || /^(none|n\/?a|null|-+)$/i.test(text)) return null;
  const digits = text.replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return null;
  return formatUsd(n);
}

/** $7,800,000 — grouped thousands, whole dollars (source values are whole USD). */
export function formatUsd(amount: number): string {
  const whole = Math.round(amount);
  return "$" + whole.toLocaleString("en-US");
}

/**
 * Source funding → the single string the card shows, or null for
 * "Not specified". Priority: a published total estimate, else a published
 * ceiling/floor range. Every branch is a number the source supplied.
 */
export function fundingDisplay(detail: GrantsUpstreamDetail | null): string | null {
  if (!detail) return null;
  const estimate = formatFundingValue(detail.estimatedFunding);
  if (estimate) return `Est. ${estimate}`;
  const ceiling = formatFundingValue(detail.awardCeiling);
  const floor = formatFundingValue(detail.awardFloor);
  if (ceiling && floor && floor !== ceiling) return `${floor} – ${ceiling}`;
  if (ceiling) return `Up to ${ceiling}`;
  if (floor) return `From ${floor}`;
  return null;
}

/** Eligible applicant types exactly as the source lists them ([] when absent). */
export function eligibleApplicants(detail: GrantsUpstreamDetail | null): string[] {
  if (!detail || !Array.isArray(detail.applicantTypes)) return [];
  const out: string[] = [];
  for (const item of detail.applicantTypes as unknown[]) {
    const description =
      typeof item === "object" && item !== null
        ? asText((item as { description?: unknown }).description)
        : asText(item);
    if (description && !out.includes(description)) out.push(description);
  }
  return out;
}

/** Official opportunity page for an opportunity id, or null when unusable. */
export function officialOpportunityUrl(rawId: unknown): string | null {
  const id = asText(rawId);
  if (!id || !/^\d+$/.test(id)) return null;
  return `${GRANTS_OFFICIAL_URL_BASE}${id}`;
}

/**
 * Maps one upstream hit (+ its optional detail) to a card. `officialUrl` is null
 * when the source gave no usable numeric id — the card then renders the
 * opportunity number without a dead/incorrect link (we never guess a URL).
 *
 * `now` drives the derived status (day boundary, ET). It is injectable so the
 * classification is unit-tested against fixed clocks instead of "whenever the
 * suite ran"; production callers use the default.
 */
export function mapGrantResult(
  hit: GrantsUpstreamHit,
  detail: GrantsUpstreamDetail | null,
  now: Date | number = new Date(),
): GrantResult {
  const id = asText(hit.id) ?? "";
  const rawStatus = asText(hit.oppStatus) ?? "";
  const closingDate = asText(hit.closeDate);
  const estimatedDeadline = formatSourceDayText(detail?.estimatedDeadline);
  const estimatedMs = parseSourceLongDay(detail?.estimatedDeadline);
  return {
    id,
    opportunityNumber: decodeSourceText(asText(hit.number) ?? "") || NOT_SPECIFIED,
    title: decodeSourceText(asText(hit.title) ?? "") || NOT_SPECIFIED,
    agency: decodeSourceText(asText(hit.agency) ?? "") || NOT_SPECIFIED,
    agencyCode: asText(hit.agencyCode) ?? "",
    status: rawStatus,
    derivedStatus: classifyGrantStatus(rawStatus, closingDate, now),
    postedDate: asText(hit.openDate),
    closingDate,
    estimatedDeadline,
    // An estimate that is already past is reported as such — never used to change
    // the status (a forecast stays a forecast until the SOURCE posts it).
    estimatedDeadlinePassed:
      estimatedMs !== null && estimatedMs < easternDayStart(now),
    sourceLastUpdated: formatSourceDayText(detail?.lastUpdated),
    // Only true when we actually retrieved this opportunity's detail: that is the
    // difference between "the source published no last-updated value" and "we did
    // not look", and the card words them differently.
    sourceLastUpdatedKnown: detail !== null,
    estimatedFunding: fundingDisplay(detail),
    eligibleApplicants: eligibleApplicants(detail),
    description: detail ? (toPlainText(detail.synopsisDesc) || null) : null,
    officialUrl: officialOpportunityUrl(hit.id),
    source: GRANTS_SOURCE_LABEL,
  };
}

/**
 * Anonymous preview cap (owner spec): at most PREVIEW_LIMIT cards. This is the
 * shared trim used by BOTH enforcement points — the server (authoritative) and
 * the page (defence in depth) — so they can never disagree.
 */
export function applyPreviewCap<T>(results: readonly T[], authenticated: boolean): T[] {
  return authenticated ? [...results] : results.slice(0, PREVIEW_LIMIT);
}

/**
 * The $19 upgrade prompt flag. Default OFF (owner spec: the gate stays disabled
 * until Stripe checkout + entitlement are separately verified). Enabled only by
 * an explicit GRANTS_UPGRADE_PROMPT_ENABLED=true|1 — read server-side in the
 * API route and echoed to the page, so nothing is baked in at build time.
 */
export const GRANTS_UPGRADE_FLAG_ENV = "GRANTS_UPGRADE_PROMPT_ENABLED";

export function isUpgradePromptEnabled(env: Record<string, string | undefined>): boolean {
  const raw = env[GRANTS_UPGRADE_FLAG_ENV];
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1";
}

/** Displayed price of the grants plan (owner-mandated copy). */
export const GRANTS_PRICE_LABEL = "$19/month";
/**
 * May the "your subscription is set up" toast be shown? (QA 09-17 honesty fix.)
 *
 * `?checkout=success` is part of a URL: ANYONE can type it, so on its own it is
 * not evidence of anything and must never be turned into a claim about a
 * subscription. The toast is therefore shown only when the server-written
 * subscription state (`GET /api/grants/subscription`) actually grants access.
 * The parameter is still stripped from the URL either way — a non-subscriber
 * just gets no claim made about them (access is NEVER granted from this param;
 * Stripe webhooks are the only writer).
 *
 * Pure so it is unit-tested rather than living only in the page component.
 */
export function grantsCheckoutToastVisible(input: {
  /** The raw `?checkout=` value that was on the URL (null when absent). */
  checkoutParam: string | null;
  /** Server-reported subscription state, never a client guess. */
  subscribed: boolean;
}): boolean {
  return input.checkoutParam === "success" && input.subscribed === true;
}
