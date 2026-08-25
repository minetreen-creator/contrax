import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` (the react-server marker package) throws at import time on
      // its default export, and Node (Vercel's SSR runtime) has no `react-server`
      // condition — so a bare external `import "server-only"` in a server chunk
      // would crash every DB-backed route at runtime. Alias it to a local empty
      // module: bundled inline as a no-op on the server, and side-effect-free
      // (hence prunable) on the client. See src/server-only.ts.
      "server-only": fileURLToPath(new URL("./src/server-only.ts", import.meta.url)),
    },
  },
  server: {
    port: 3000,
    host: true,
    // The site is reverse-proxied behind <label>.<PUBLIC_SITE_DOMAIN>; the proxy
    // masks the Host to localhost:3000, but accept any host so a dev server never
    // rejects a proxied request with "Blocked request".
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      treeshake: {
        // `~/db` is imported by route files for use inside `createServerFn`
        // handlers, which TanStack Start strips from client bundles — the
        // module-level imports survive as unused references. Rollup normally
        // keeps them anyway because `@neondatabase/serverless` is not marked
        // side-effect-free, dragging pg-protocol/buffer/crypto shims into the
        // client entry chunk. Its modules perform no side effects, so treating
        // them as side-effect-free lets Rollup prune the whole `~/db` chain
        // from client bundles. SSR builds externalize node_modules, so the
        // server keeps its normal runtime import and DB access is unaffected.
        //
        // IMPORTANT: the function form of `moduleSideEffects` REPLACES
        // Rollup's default resolution (including package.json's
        // `sideEffects: false`), so it must ALSO explicitly cover the app's
        // own modules in the chain (`src/db.ts`, `src/lib/session-verify.ts`).
        // Previously only `@neondatabase/serverless` was covered, which left
        // `src/db.ts` marked side-effectful — the static `import { sql }`
        // retained in client route bundles pinned the whole pg-protocol/ws/
        // buffer stack (~114 KB) inside the client entry chunk.
        moduleSideEffects(id) {
          if (
            id.includes("@neondatabase/serverless") ||
            id.endsWith("/src/db.ts") ||
            id.endsWith("/src/lib/session-verify.ts")
          ) {
            return false;
          }
          return true;
        },
      },
      output: {
        manualChunks(id) {
          // Isolate the blog content (`src/lib/blog.ts` + its `?raw` markdown)
          // into its own lazy chunk so it never ships on the landing/entry
          // path. The blog data is imported only by /blog* routes, but Rollup
          // was hoisting it into the shared entry chunk (~51 KB of raw
          // markdown + frontmatter), which loads on every page including the
          // top-of-funnel landing page. Grouping it here gives Rollup a
          // distinct chunk fetched on demand when a blog route loads. SSR is
          // unaffected (SSR bundles app modules separately), so /blog pages
          // still pre-render server-side.
          if (
            id.includes("/src/lib/blog.ts") ||
            id.includes("/content/blog/")
          ) {
            return "blog";
          }
          if (!id.includes("node_modules")) return;

          // Keep the framework dependencies in stable, cacheable chunks while
          // leaving application code (including route definitions) in the entry.
          if (/node_modules\/(?:react|react-dom|scheduler)(?:\/|$)/.test(id)) {
            return "vendor";
          }
          if (/node_modules\/@tanstack\/(?:react-router|router)(?:\/|$)/.test(id)) {
            return "router";
          }
        },
      },
    },
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tanstackStart(),
    viteReact(),
  ],
});
