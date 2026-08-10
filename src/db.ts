// Runtime server-only guard. We deliberately avoid the `server-only` npm
// marker package here: Vite aliases that import to a no-op (see vite.config.ts),
// but the GH Actions bid-sync runner executes this module directly under Bun
// (src/jobs/runner.ts), where the real `server-only` package resolves and
// throws at import time — killing the job in 17s. `document` exists only in
// browsers, so this throws exactly when a client bundle would include this
// module, while remaining a no-op in Bun CLI and Vite SSR.
if (typeof document !== "undefined") {
  throw new Error(
    "src/db.ts must only be imported from server code. " +
    "This module manages the database connection and should never " +
    "be bundled into client-side JavaScript.",
  );
}
import { neon } from "@neondatabase/serverless";

/**
 * Server-only handle to the team's database (Neon serverless Postgres over HTTP).
 * The connection string comes from `DATABASE_URL`, which the owner connects via
 * the database card and which is injected into the sandbox and passed to the live
 * host on publish. Resolved lazily (per call, not at module load) so the site
 * still builds and serves before a database is connected — the error only
 * surfaces if a query actually runs without `DATABASE_URL`.
 *
 * Use it only inside a `createServerFn()` handler or an `src/routes/api/*` route
 * (never client code):
 *
 *   const getPosts = createServerFn().handler(async () => {
 *     const rows = await sql()`select id, title, created_at from posts`;
 *     return rows.map((r) => ({ ...r, created_at: String(r.created_at) }));
 *   });
 */
export const sql = () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — connect a database (via the database card) before running queries.",
    );
  }
  return neon(url);
};
