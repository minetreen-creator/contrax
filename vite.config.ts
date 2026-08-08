import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` (the react-server marker package) throws at import time on
      // its default export. Node (Vercel's SSR runtime) has no `react-server`
      // condition, so a bare `import "server-only"` in a server chunk would
      // crash every DB-backed route. Alias it to the package's empty module —
      // the same file React tooling resolves via the `react-server` condition —
      // so the marker is a no-op on both client and server.
      "server-only": "server-only/empty.js",
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
        moduleSideEffects(id) {
          if (id.includes("@neondatabase/serverless")) return false;
          return true;
        },
      },
      output: {
        manualChunks(id) {
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
