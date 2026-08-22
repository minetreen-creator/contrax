// ── Shared review filter-context persistence ────────────────────────────────
//
// ONE mechanism backing both the onboarding "We found N" match review and the
// dashboard matched-bid review. Owner requirements this serves:
//   1. Filters STAY PUT until the user deliberately changes them — never reset
//      on navigation, never "back to the beginning".
//   2. Sticky, mobile-first filter bar shows/changes them without restarting.
//   3. Review continuity: Back to Results / Change / Next-Previous Opportunity
//      iterate the CURRENT result set with context intact.
//
// MECHANISM (documented choice):
//   * URL search params = single source of truth for the ACTIVE view
//     (sort, set-aside-only, feed tab, focused bid). They survive every
//     navigation and are shareable/copy-pasteable.
//   * localStorage ("contrax.reviewFilters") = the per-browser store so a
//     fresh session / reload keeps the last deliberately-chosen filter context
//     instead of wiping it. URL params win over local when both present.
//   * Business-profile filters (geo states, NAICS codes, set-aside/cert) are
//     persisted in the user's profile row (DB) — they naturally survive every
//     session. This module mirrors the ones a user touches mid-review so the
//     sticky bar has a single read path for all of them.
//
// SSR-safe: nothing here touches `window` at import time — all browser access
// is guarded inside functions.

export const REVIEW_LS_KEY = "contrax.reviewFilters";

export type SortKey = "due_date" | "newest" | "value";
export type FeedTab = "live" | "archived";

export interface ReviewFilterState {
  /** Geo states (2-letter). Empty = nationwide. */
  states: string[];
  /** Set-aside / certification value. Empty string = no set-aside filter. */
  setAside: string;
  /** NAICS codes. Empty = any trade. */
  naics: string[];
  sort: SortKey;
  setAsideOnly: boolean;
  feedTab: FeedTab;
}

export const DEFAULT_REVIEW_FILTERS: ReviewFilterState = {
  states: [],
  setAside: "",
  naics: [],
  sort: "due_date",
  setAsideOnly: false,
  feedTab: "live",
};

export const SORTS: { value: SortKey; label: string }[] = [
  { value: "due_date", label: "Due date (closest)" },
  { value: "newest", label: "Newest" },
  { value: "value", label: "Highest value" },
];

// ── localStorage persistence ─────────────────────────────────────────────────

/** Read the persisted (non-URL) filter context. SSR-safe (null in SSR). */
export function readReviewFilters(): Partial<ReviewFilterState> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(REVIEW_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReviewFilterState>;
    if (typeof parsed !== "object" || parsed === null) return null;
    return sanitize(parsed);
  } catch {
    return null;
  }
}

/** Persist a filter context so a fresh session / reload keeps it. SSR-safe. */
export function writeReviewFilters(patch: Partial<ReviewFilterState>): void {
  if (typeof window === "undefined") return;
  try {
    const current = readReviewFilters() ?? {};
    window.localStorage.setItem(
      REVIEW_LS_KEY,
      JSON.stringify({ ...current, ...sanitize(patch) }),
    );
  } catch {
    /* storage unavailable — URL params still carry the active view */
  }
}

/** Persist the full explicit state (used when a real context is established). */
export function storeReviewFilters(f: ReviewFilterState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REVIEW_LS_KEY, JSON.stringify(sanitize(f)));
  } catch {
    /* ignore */
  }
}

export function clearReviewFilters(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(REVIEW_LS_KEY);
  } catch {
    /* ignore */
  }
}

// Sanitize / coerce arbitrary partial input into a safe filter slice.
function sanitize(p: Partial<ReviewFilterState>): Partial<ReviewFilterState> {
  const out: Partial<ReviewFilterState> = {};
  if (Array.isArray(p.states)) {
    out.states = p.states.filter((s): s is string => typeof s === "string" && /^[A-Z]{2}$/.test(s));
  }
  if (typeof p.setAside === "string") out.setAside = p.setAside;
  if (Array.isArray(p.naics)) {
    out.naics = p.naics
      .filter((n): n is string => typeof n === "string" && /^\d{6}$/.test(n.trim()))
      .map((n) => n.trim());
  }
  if (p.sort === "due_date" || p.sort === "newest" || p.sort === "value") out.sort = p.sort;
  if (typeof p.setAsideOnly === "boolean") out.setAsideOnly = p.setAsideOnly;
  if (p.feedTab === "live" || p.feedTab === "archived") out.feedTab = p.feedTab;
  return out;
}

// ── URL search-param encoding ────────────────────────────────────────────────

/** Serialize a filter context into flat URL search params (only non-defaults). */
export function filtersToParams(f: ReviewFilterState): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.states.length) p.states = f.states.join(",");
  if (f.setAside) p.set_aside = f.setAside;
  if (f.naics.length) p.naics = f.naics.join(",");
  if (f.sort !== "due_date") p.sort = f.sort;
  if (f.setAsideOnly) p.setasideonly = "1";
  if (f.feedTab === "archived") p.feed = "archived";
  return p;
}

/**
 * Parse flat search params into a filter slice. Accepts either a URLSearchParams
 * or a plain search object (the shape TanStack `location.search` gives us).
 */
export function parseReviewParams(
  search: URLSearchParams | Record<string, unknown>,
): Partial<ReviewFilterState> {
  const get = (k: string): string => {
    if (search instanceof URLSearchParams) return search.get(k) ?? "";
    const v = search[k];
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return String(v[0] ?? "");
    return "";
  };
  const out: Partial<ReviewFilterState> = {};
  const states = get("states")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Z]{2}$/.test(s));
  if (states.length) out.states = states;
  const setAside = get("set_aside").trim();
  if (setAside) out.setAside = setAside;
  const naics = get("naics")
    .split(",")
    .map((n) => n.trim())
    .filter((n) => /^\d{6}$/.test(n));
  if (naics.length) out.naics = naics;
  const sort = get("sort").trim();
  if (sort === "due_date" || sort === "newest" || sort === "value") out.sort = sort;
  if (get("setasideonly") === "1") out.setAsideOnly = true;
  const feed = get("feed").trim();
  if (feed === "live" || feed === "archived") out.feedTab = feed;
  return out;
}

/** Merge precedence: URL params override localStorage; defaults fill the rest. */
export function mergeFilterState(
  url: Partial<ReviewFilterState>,
  local: Partial<ReviewFilterState> | null,
): ReviewFilterState {
  return {
    ...DEFAULT_REVIEW_FILTERS,
    ...(local ?? {}),
    ...url,
  };
}
