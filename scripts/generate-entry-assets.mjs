#!/usr/bin/env node
// Generate vercel-entry.assets.json from the current TanStack Start build output.
//
// vercel-entry.ts serves the static SEO pages (/learn + certification articles)
// with a reference to the client entry chunk. That chunk filename is a content
// hash that changes on every build — hardcoding it (as before) 404s as soon as
// the app is rebuilt. This script extracts the REAL filenames from the fresh
// `dist/` output and writes them to vercel-entry.assets.json, which
// vercel-entry.ts imports (bundled in at build time by build-vercel.sh).
//
// Source of truth: the TanStack Start SSR manifest chunk
// (dist/server/assets/_tanstack-start-manifest_*.js) — its `__root__` entry
// lists the client entry chunk + framework preloads. Falls back to globbing
// dist/client/assets (largest index-*.js = entry) if the manifest is ever
// unavailable. Fails loudly if the resolved entry chunk does not exist.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const clientAssets = join(root, "dist", "client", "assets");
const serverAssets = join(root, "dist", "server", "assets");

const glob = (dir, prefix, suffix) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
    .sort();
};

let entryChunk = null;
let preloads = [];

// 1) Authoritative source: TanStack Start SSR manifest (__root__ preloads/scripts).
const manifestFiles = glob(serverAssets, "_tanstack-start-manifest_", ".js");
if (manifestFiles.length > 0) {
  const text = readFileSync(join(serverAssets, manifestFiles[0]), "utf8");
  const m = text.match(
    /__root__:\s*\{[^}]*?preloads:\s*\[([^\]]*)\],\s*scripts:\s*\[([^\]]*)\]/,
  );
  if (m) {
    const preloadUrls = [...m[1].matchAll(/"\/assets\/([^"]+\.js)"/g)].map((x) => x[1]);
    const scriptUrls = [...m[2].matchAll(/"\/assets\/([^"]+\.js)"/g)].map((x) => x[1]);
    if (preloadUrls.length > 0 && scriptUrls.length > 0) {
      entryChunk = scriptUrls[0]; // scripts[0].src is the client entry module
      preloads = preloadUrls;
    }
  }
}

// 2) Fallback: glob dist/client/assets (largest index-*.js is the entry).
if (!entryChunk) {
  const indexChunks = glob(clientAssets, "index-", ".js")
    .map((f) => ({ f, size: statSync(join(clientAssets, f)).size }))
    .sort((a, b) => b.size - a.size);
  if (indexChunks.length === 0) {
    throw new Error(
      `[generate-entry-assets] no client entry chunk found (dist missing? run 'bun run build' first)`,
    );
  }
  entryChunk = indexChunks[0].f;
  const vendor = glob(clientAssets, "vendor-", ".js").sort().pop();
  const router = glob(clientAssets, "router-", ".js").sort().pop();
  preloads = [entryChunk, ...(vendor ? [vendor] : []), ...(router ? [router] : [])];
}

const appCss = glob(clientAssets, "app-", ".css").sort().pop();
if (!appCss) {
  throw new Error(`[generate-entry-assets] no app-*.css found in ${clientAssets}`);
}
if (!existsSync(join(clientAssets, entryChunk))) {
  throw new Error(
    `[generate-entry-assets] entry chunk "${entryChunk}" does not exist in ${clientAssets} — refusing to write a dangling reference`,
  );
}

const out = { entryChunk, appCss, preloads };
writeFileSync(
  join(root, "vercel-entry.assets.json"),
  JSON.stringify(out, null, 2) + "\n",
);
console.log(
  `[entry-assets] wrote vercel-entry.assets.json: entry=${entryChunk} css=${appCss} preloads=${preloads.join(",")}`,
);
