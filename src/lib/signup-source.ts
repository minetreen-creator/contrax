/**
 * Signup source marker — ONE normaliser for the `?source=` signup-param family.
 *
 * WHY THIS MODULE EXISTS (owner-directed tracking fix, 2026-09-28). The signup URL already
 * carried a `source=` param for a handful of doors (`source=radar`, `source=autopsy`,
 * `source=closing_soon`, `source=incumbent`, the two radar-results variants), but the value
 * was only ever used to pick an ACQUISITION BUCKET for telemetry — it was never recorded on
 * the account the signup created. The owner's ask was a new member of that family for the
 * Nonprofit Free door ("Apply for Nonprofit Free") recorded ON THE USER ROW, so the team can
 * see which accounts were created from the nonprofit-apply path.
 *
 * The allowlist lives HERE, not inline in two places, because the value crosses a trust
 * boundary: the CLIENT (`/signup` search params) only forwards it and the SERVER
 * (`/api/signup`) is the authority that decides whether it is a real family member. Both
 * call `normalizeSignupSource`, so the two can never drift.
 *
 * WHAT THE MARKER IS NOT. It is attribution ONLY. It is not an entitlement, not a plan, not
 * an approval: no billing, checkout, trial, gate or nonprofit-application path reads
 * `users.signup_source`. The Nonprofit Free entitlement continues to come only from
 * `nonprofit_applications.status`, written by the existing review flow.
 *
 * SCOPE: this is DIFFERENT from the acquisition-path BUCKET (src/lib/signup-telemetry.ts).
 * Buckets are a NARROW funnel vocabulary (7 fixed values) used for reporting; adding a new
 * source there would have invented a bucket and silently changed funnel semantics, so the
 * nonprofit source deliberately maps to NO new bucket — `resolveAcquisitionPath` keeps
 * resolving it from the referrer exactly as it does today (same-site `/grants` → "home").
 *
 * PURE MODULE: no DB, no server-only imports — importable by `bun test`, by the client
 * bundle (the two nonprofit pages) and by the server route alike.
 */
/**
 * The Nonprofit Free door's family member — added by this change.
 *
 * The name is snake_case to match the SIX existing members of the family (`radar`,
 * `radar_results_unlock`, `radar_results_cta`, `autopsy`, `closing_soon`, `incumbent`); the
 * URL parameter therefore reads `?source=nonprofit_apply`.
 */
export const SIGNUP_SOURCE_NONPROFIT_APPLY = "nonprofit_apply";
/**
 * The allowlisted `?source=` signup values — the six pre-existing family members plus the
 * nonprofit-apply member this change adds. Kept in the SAME order/values as
 * `SOURCE_TO_BUCKET` in src/lib/signup-telemetry.ts for the first six (that map is unchanged
 * by this change, so the acquisition buckets and every funnel number stay identical).
 */
export const SIGNUP_SOURCE_VALUES = [
  "radar",
  "radar_results_unlock",
  "radar_results_cta",
  "autopsy",
  "closing_soon",
  "incumbent",
  SIGNUP_SOURCE_NONPROFIT_APPLY,
] as const;
export type SignupSource = (typeof SIGNUP_SOURCE_VALUES)[number];
/**
 * Normalise a `?source=` signup value to a family member, or `null` when it is not one.
 *
 * The ONLY acceptance rule in the codebase: an unknown/absent/hostile value (a script
 * posting `signup_source: "agency"`, a hand-typed `?source=hax`, a 4-char probe) returns
 * `null` and is stored as NULL — never echoed back into the database.
 */
export function normalizeSignupSource(value: unknown): SignupSource | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return (SIGNUP_SOURCE_VALUES as readonly string[]).includes(candidate)
    ? (candidate as SignupSource)
    : null;
}
/** True when the marker is the Nonprofit Free apply door (the admin surface's distinct label). */
export function isNonprofitApplySource(value: unknown): boolean {
  return normalizeSignupSource(value) === SIGNUP_SOURCE_NONPROFIT_APPLY;
}
/** The one place the admin surface's human label for the nonprofit marker is spelled. */
export const SIGNUP_SOURCE_NONPROFIT_APPLY_LABEL = "Nonprofit apply";
