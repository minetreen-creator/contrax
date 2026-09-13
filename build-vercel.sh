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
#   SYNC_TOKEN            — cron token for /api/sync-far (and legacy /api/sync-bids callers)
#   STRIPE_SECRET_KEY     — Stripe API key (checkout)
#   STRIPE_WEBHOOK_SECRET — Stripe webhook signing secret
#   OPENAI_API_KEY        — AI features
#   RESEND_API_KEY        — email (Resend)
#
# `bunx vercel deploy --prebuilt` inherits the project env, so nothing more is
# needed here.

# ── Pin Bun 1.4.2 (owner gate: the Vercel build log must report the intended
#    Bun version). The Vercel builder image ships its own Bun (1.3.14) and
#    ignores packageManager, so we install the pinned version into ~/.bun and
#    put it first on PATH — every `bun` invocation below then runs 1.4.2.
#    Idempotent: reuses ~/.bun/bin/bun when it already is 1.4.2 (the
#    vercel.json installCommand installs it just before this script runs), and
#    skips the download entirely when a 1.4.2 bun is already on PATH (e.g. CI's
#    setup-bun). Never re-downloads, never upgrades to a different version.
export BUN_VERSION="1.4.2"
if [ -x "$HOME/.bun/bin/bun" ] && [ "$("$HOME/.bun/bin/bun" --version 2>/dev/null || true)" = "$BUN_VERSION" ]; then
  export PATH="$HOME/.bun/bin:$PATH"
elif ! command -v bun >/dev/null 2>&1 || [ "$(bun --version 2>/dev/null || true)" != "$BUN_VERSION" ]; then
  echo "[bun-pin] installing bun ${BUN_VERSION} into \$HOME/.bun ..."
  curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
  export PATH="$HOME/.bun/bin:$PATH"
fi
echo "[bun-pin] bun $(bun --version) ($(command -v bun))"

echo "[1/5] vite build (light — safe under the sandbox memory cap)"
# The workspace starts as sources only (deps live with the image's pre-built
# placeholder copy); no-op once node_modules is current.
bun install

echo "[2/5] generate sitemap.xml from far_clauses (clause library SEO; FAILS OPEN — keeps last-known sitemap if the DB is unreachable)"
# Must run BEFORE `bun run build` so Vite copies the fresh public/sitemap.xml
# into dist/client. The script exits 0 even when the DB is unreachable (see its
# header comment); the `|| echo` guard is belt-and-braces under `set -euo
# pipefail` so a broken script can never break the deploy.
bun scripts/generate-sitemap.mjs || echo "[generate-sitemap] failed — keeping existing public/sitemap.xml"
bun run build

echo "[3/5] generate client entry-assets for vercel-entry.ts (no hardcoded chunk hashes)"
# Reads the fresh dist/ output (TanStack Start SSR manifest + dist/client/assets)
# and writes vercel-entry.assets.json, which vercel-entry.ts imports so the
# static SEO pages reference the CURRENT entry chunk — not a stale hash.
bun scripts/generate-entry-assets.mjs

echo "[4/5] assemble .vercel/output (Build Output API v3)"
rm -rf .vercel/output
mkdir -p .vercel/output/functions/render.func
cp -R dist/client .vercel/output/static
rm -f .vercel/output/static/index.html   # SSR owns "/", not a static shell

echo "[5/5] bundle SSR handler + deps into the render function"
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
