/**
 * Local stand-in for the `server-only` marker package.
 *
 * The real `server-only` package throws at import time on its default export.
 * Vite aliases `import "server-only"` (used by `src/db.ts`) to this empty
 * module so the marker is a no-op:
 *
 *   - Client bundles: an empty module with no side effects, so Rollup can
 *     prune the whole `~/db` import chain (see `treeshake.moduleSideEffects`
 *     in vite.config.ts) instead of bundling `@neondatabase/serverless`.
 *   - Server bundles: bundled inline as a no-op, avoiding an external
 *     `import "server-only"` — which would resolve to the package's throwing
 *     `index.js` on Node (Vercel's SSR runtime has no `react-server`
 *     condition) and crash every DB-backed route.
 *
 * If the toolchain ever gains native `server-only` enforcement (build error on
 * client import), this alias can be deleted and the real package semantics
 * take over.
 */
export {};
