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
 * visitors-table exclusion predicate (OWNER 2026-09-02 — funnel-integrity).
 *
 * The `visitors` SUMMARY cache shares NO `user_agent` column with the detail
 * tables (see db/migrations/021_visitors.sql), so the shared BOT_EXCLUSION_SQL
 * fragment cannot be inlined verbatim against it. This mirrors the SAME arms
 * BOT_EXCLUSION_SQL applies to ip/referrer (test/QA IPs 34.214.71.218 +
 * 73.40.36.204 always; crawler + social-preview IP prefixes; AWS/Meta link-
 * preview IPs only when the referrer is a Facebook host), with the
 * user_agent-only arms intentionally omitted since the column does not exist.
 * Additionally drops self-evident QA probe/manual-exit visitor_ids (`qa-*`),
 * which have no stored IP (sendBeacon path) and would otherwise leak onto the
 * board.
 *
 * Inlined via sql().unsafe() into a `WHERE ... AND ( ... )` clause. Keep this
 * in sync with src/lib/bot-exclusion.ts when IP/referrer arms change.
 */
export const visitorsBotExclusionSQL = () => `
  (
    -- Our own test / scraper IPs (exclude always).
    first_ip IN ('34.214.71.218','73.40.36.204')
    OR last_ip IN ('34.214.71.218','73.40.36.204')
    -- Search-engine crawler IP prefixes: Googlebot + common Bing ranges.
    OR first_ip LIKE '66.249.%' OR last_ip LIKE '66.249.%'
    OR first_ip LIKE '40.77.%' OR last_ip LIKE '40.77.%'
    OR first_ip LIKE '157.55.%' OR last_ip LIKE '157.55.%'
    OR first_ip LIKE '207.46.%' OR last_ip LIKE '207.46.%'
    -- Social link-preview / crawler IP prefixes (Facebook/Meta, etc.).
    OR first_ip LIKE '66.220.%' OR last_ip LIKE '66.220.%'
    OR first_ip LIKE '31.13.%' OR last_ip LIKE '31.13.%'
    OR first_ip LIKE '173.252.%' OR last_ip LIKE '173.252.%'
    OR first_ip LIKE '104.189.%' OR last_ip LIKE '104.189.%'
    OR first_ip LIKE '69.171.%' OR last_ip LIKE '69.171.%'
    OR first_ip LIKE '157.240.%' OR last_ip LIKE '157.240.%'
    -- Meta/AWS link-preview fetchers — BUT only when the referrer is a Facebook
    -- host, so we don't over-exclude real humans on AWS residential IPs.
    OR (
      ( first_ip LIKE '52.%' OR first_ip LIKE '54.%' OR first_ip LIKE '35.%' OR first_ip LIKE '44.%' OR first_ip LIKE '34.%' )
      AND LOWER(COALESCE(last_action,'')) LIKE '%facebook%'
    )
    -- Self-evident QA probe / manual-exit visitor ids (no stored IP on beacon).
    OR visitor_id LIKE 'qa-probe-%' OR visitor_id LIKE 'qa-manual-exit-%'
  )
`;

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
