import { ADMIN_EMAILS } from "~/lib/admin";

/**
 * QA/test-account exclusion predicates for the admin dashboard.
 *
 * Owner rule (2026-08-28): QA test accounts and their activity must NEVER count
 * or appear on the admin dashboard (recent users, signups, activity, or the
 * recent funnel-events list). QA accounts are identified by email domain
 * `@test.contrax` (QA creates accounts like `qa-*.@test.contrax`). Verified
 * 2026-08-28 that NO legitimate user uses that domain.
 *
 * Inlined via sql().unsafe() into a `WHERE ... AND ( ... )` clause — the same
 * hoisting pattern as BOT_EXCLUSION_SQL in src/lib/bot-exclusion.ts. Pass an
 * optional table alias (e.g. "u.") when the users table is aliased in a query
 * (see src/routes/api/admin/user-activity.ts self/explicit joins).
 *
 * NOTE: this is an admin-SURFACING fix only. It must never be used for DELETE /
 * cleanup logic. See src/routes/api/admin/ for all current consumers.
 */
export const QA_TEST_EMAIL_DOMAIN = "%@test.contrax";

/** users-table predicate: email is not a QA/test account. */
export const qaUserExclusionSQL = (alias = "") =>
  `LOWER(COALESCE(${alias}email, '')) NOT LIKE '${QA_TEST_EMAIL_DOMAIN}'`;

/** funnel_events-table predicate: linked user_email is not a QA/test account. */
export const qaFunnelExclusionSQL = (alias = "") =>
  `LOWER(COALESCE(${alias}user_email, '')) NOT LIKE '${QA_TEST_EMAIL_DOMAIN}'`;

/**
 * Admin-email predicate for the funnel/analytics event tables: excludes rows
 * whose linked user_email is an admin staff account. Owner rule (2026-08-31):
 * admin browsing must not appear on the Visitor Journeys board — admins are
 * internal, not prospects. Derives from the ADMIN_EMAILS allowlist so it stays
 * in sync when a new admin is added. Predicate shape matches qaFunnelExclusionSQL
 * (inlined via sql().unsafe() into a WHERE ... AND ( ... ) clause). Admin-email
 * exclusion is a SURFACING-only fix — never use it for DELETE/cleanup logic.
 */
export const adminFunnelExclusionSQL = (alias = "") => {
  if (ADMIN_EMAILS.size === 0) return "TRUE";
  const conds = [...ADMIN_EMAILS].map(
    (e) => `LOWER(COALESCE(${alias}user_email, '')) <> '${e.toLowerCase()}'`,
  );
  return `(${conds.join(" AND ")})`;
};

/**
 * External-user predicate used by the admin signups/activity surfaces:
 * not an admin, not the demo account, and not a QA/test account.
 */
export const qaExternalUserSQL = (alias = "") =>
  `is_admin = false AND plan_tier <> 'demo' AND ${qaUserExclusionSQL(alias)}`;
