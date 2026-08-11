/**
 * Admin authorization for Contrax.
 *
 * A user is treated as an admin when ANY of these hold:
 *   1. Their email is in the ADMIN_EMAILS allowlist below, OR
 *   2. Their users.is_admin column is TRUE in the database.
 *
 * The email allowlist is the primary mechanism — it works on every database,
 * including ones created before the is_admin column existed. The is_admin
 * column is an optional upgrade path for granting admin without code changes
 * (see the idempotent migration in db/setup.ts and src/db/schema.sql).
 */

export const ADMIN_EMAILS: ReadonlySet<string> = new Set([
  // Founder / owner. Add additional admin emails here as needed.
  "hello@contrax.company",
  "minetreen@gmail.com",
]);

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.has(email.trim().toLowerCase());
}
