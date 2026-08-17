/**
 * Server-only session lookup for `src/lib/auth.ts`.
 *
 * Split out of auth.ts so the client bundle never statically imports the
 * database chain (`~/db` → `@neondatabase/serverless` → buffer polyfill, `ws`,
 * `pg-protocol` — ~110 KB minified). auth.ts dynamic-imports this module only
 * inside its `typeof window === "undefined"` (SSR) branch, so Rollup emits the
 * DB stack as a separate async chunk that browsers never fetch. `sql()` also
 * throws client-side by design (see src/db.ts), so this module must only ever
 * be imported from server-executed code paths.
 */
import { sql } from "~/db";

export interface SessionUserRow {
  id: number;
  email: string;
  created_at: string;
  is_admin: boolean;
}

export async function lookupSessionUser(
  token: string,
): Promise<SessionUserRow | null> {
  const rows = await sql()`
    SELECT u.id, u.email, u.created_at, COALESCE(u.is_admin, FALSE) AS is_admin
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ${token} AND s.expires_at > NOW()
    LIMIT 1
  `;
  return (rows[0] as SessionUserRow | undefined) ?? null;
}
