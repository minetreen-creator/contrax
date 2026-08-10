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
  // Runtime server-only guard, kept INSIDE sql() on purpose. We deliberately
  // avoid the `server-only` npm marker package: Vite aliases that import to a
  // no-op (see vite.config.ts), but the GH Actions bid-sync runner executes
  // this module directly under Bun (src/jobs/runner.ts), where the real
  // `server-only` package resolves and throws at import time — killing the job
  // in 17s. `document` exists only in browsers, so this throws exactly when a
  // browser would try to use the DB, while remaining a no-op in Bun CLI and
  // Vite SSR. It must NOT live at module top level: db.ts is reachable from
  // client code (via ~/lib/auth.ts, which imports sql), and a top-level throw
  // would fire during script evaluation in every browser — before
  // hydrateRoot(...) — killing hydration app-wide.
  if (typeof document !== "undefined") {
    throw new Error(
      "src/db.ts must only be imported from server code. " +
        "This module manages the database connection and should never " +
        "be bundled into client-side JavaScript.",
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — connect a database (via the database card) before running queries.",
    );
  }
  return neon(url);
};
