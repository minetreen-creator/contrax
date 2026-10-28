/**
 * US state codes (50 states + District of Columbia).
 *
 * Single source of truth for the SAM.gov regional sync pass
 * (src/jobs/runner.ts) and the awards page location filter/dropdown
 * (src/routes/awards.tsx). Keep both in sync with this constant.
 */
export const US_STATES = [
  "DC", "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI",
  "WY",
] as const;

export type USStateCode = (typeof US_STATES)[number];

/**
 * US territories (owner 2026-10-28: "do them all"). Businesses there bid on
 * federal contracts, so they are searchable places with their own pages, like
 * a state. Kept OUT of US_STATES, which still drives state-only work (the US
 * map's shapes, the per-state SAM.gov keyword searches, federal spending data).
 */
export const US_TERRITORIES = ["PR", "GU", "VI", "AS", "MP"] as const;

/** Every searchable US place: the 50 states, DC and the territories. */
export const US_PLACES = [...US_STATES, ...US_TERRITORIES] as const;

export const US_TERRITORY_NAMES: Record<(typeof US_TERRITORIES)[number], string> = {
  PR: "Puerto Rico",
  GU: "Guam",
  VI: "US Virgin Islands",
  AS: "American Samoa",
  MP: "Northern Mariana Islands",
};
