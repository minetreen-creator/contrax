#!/usr/bin/env bash
# Produce a Vercel Build Output API bundle (.vercel/output) for this site, then
# deploy it with:  bunx vercel deploy --prebuilt
#
# Why Build Output API instead of Vercel's Vite/framework detection:
#  - TanStack Start emits a host-agnostic fetch handler (dist/server/server.js)
#    that dynamic-imports its own ./assets chunks and externalizes node deps.
#    Letting Vercel trace/detect that is fragile.
#  - Bundling it into one self-contained file (deps + dynamic chunks inlined) in a
#    single render.func removes all tracing/detection risk. vercel-entry.ts adapts
#    the Node (req,res) launcher to the web fetch handler.
set -euo pipefail
cd "$(dirname "$0")"
umask 002
# ── Runtime environment variables ─────────────────────────────────────────────
# All secrets are read at REQUEST TIME via `process.env.X` inside the serverless
# function — they are NOT inlined at build time, so this script does not need to
# pass them through. Set them in the Vercel project (Settings → Environment
# Variables, both Preview and Production):
#
#   DATABASE_URL          — Neon Postgres connection string
#   GOOGLE_CLIENT_ID      — Google OAuth client ID ("Continue with Google")
#   GOOGLE_CLIENT_SECRET  — Google OAuth client secret (callback code exchange)
#   SYNC_TOKEN            — cron token for /api/sync-bids, /api/sync-far
#   STRIPE_SECRET_KEY     — Stripe API key (checkout)
#   STRIPE_WEBHOOK_SECRET — Stripe webhook signing secret
#   OPENAI_API_KEY        — AI features
#   RESEND_API_KEY        — email (Resend)
#
# `bunx vercel deploy --prebuilt` inherits the project env, so nothing more is
# needed here.

echo "[1/3] vite build (light — safe under the sandbox memory cap)"
# The workspace starts as sources only (deps live with the image's pre-built
# placeholder copy); no-op once node_modules is current.
bun install
bun run build

echo "[2/3] assemble .vercel/output (Build Output API v3)"
rm -rf .vercel/output
mkdir -p .vercel/output/functions/render.func
cp -R dist/client .vercel/output/static
rm -f .vercel/output/static/index.html   # SSR owns "/", not a static shell

echo "[3/3] bundle SSR handler + deps into the render function"
bun build vercel-entry.ts --target node \
  --external '#tanstack-router-entry' --external '#tanstack-start-entry' \
  --external 'tanstack-start-manifest:v' \
  --outfile .vercel/output/functions/render.func/index.mjs

cat > .vercel/output/functions/render.func/.vc-config.json <<'JSON'
{ "runtime": "nodejs22.x", "handler": "index.mjs", "launcherType": "Nodejs", "supportsResponseStreaming": true }
JSON
cat > .vercel/output/config.json <<'JSON'
{ "version": 3, "routes": [ { "handle": "filesystem" }, { "src": "/(.*)", "dest": "/render" } ] }
JSON

echo "done -> .vercel/output ready for: bunx vercel deploy --prebuilt"
