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
