import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
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
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          // Keep framework dependencies in stable, cacheable chunks. Heavy
          // browser/server-only dependencies must never inflate marketing entry.
          if (/node_modules\/(?:react|react-dom|scheduler)(?:\/|$)/.test(id)) return "vendor";
          if (/node_modules\/@tanstack\/(?:react-router|router)(?:\/|$)/.test(id)) return "router";
          if (/node_modules\/(?:jspdf|stripe|resend)(?:\/|$)/.test(id)) return "app-vendor";
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
