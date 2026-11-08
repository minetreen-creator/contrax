#!/usr/bin/env bash
# ── Checksum-verified Bun 1.4.2 bootstrap (owner supply-chain gate, PR #375) ──
#
# Replaces the former `curl -fsSL https://bun.sh/install | bash` pattern in the
# Vercel installCommand (vercel.json) and in build-vercel.sh. NEVER executes an
# unverified binary — it fails closed on every check:
#
#   1. Downloads bun-linux-x64.zip AND SHASUMS256.txt over HTTPS from the
#      OFFICIAL oven-sh/bun GitHub release (bun-v1.4.2).
#   2. Fails closed unless sha256(bun-linux-x64.zip) matches BOTH
#        (a) the official SHASUMS256.txt entry for bun-linux-x64.zip, and
#        (b) the PINNED digest hardcoded below (computed from the official
#            asset on 2026-09-13; owner-required second pin).
#      A missing checksum line, a curl failure, or any digest mismatch aborts.
#   3. Extracts and installs to "$HOME/.bun/bin/bun", then fails closed unless
#      `bun --version` resolves EXACTLY to "1.4.2".
#   4. Reuse path: an existing "$HOME/.bun/bin/bun" is reused only when it is
#      already 1.4.2 AND its sha256 matches the pinned BINARY digest (computed
#      from the same official asset) — reuse is still a verified, fail-closed
#      decision, never a blind skip. This keeps the Vercel build step fast while
#      printing the [bun-checksum] verification lines in BOTH install and build
#      log sections.
#
#   5. Fallback (owner 2026-11-08, option 2): when a GitHub download FAILS (not
#      when a GitHub file fails verification), the same binary comes from the
#      official npm package @oven/bun-linux-x64@1.4.2, verified against the
#      registry's published integrity AND a pinned integrity, then against the
#      pinned BUN_BIN_SHA256 and the exact version. GitHub release downloads
#      answered 504 for hours that day and every Vercel build failed.
#
# Prints only the resolved version + executable path (+ public sha256 digests)
# — never any secret.
set -euo pipefail

BUN_VERSION="1.4.2"
RELEASE_TAG="bun-v1.4.2"
ZIP_NAME="bun-linux-x64.zip"
ZIP_URL="https://github.com/oven-sh/bun/releases/download/${RELEASE_TAG}/${ZIP_NAME}"
SHASUMS_URL="https://github.com/oven-sh/bun/releases/download/${RELEASE_TAG}/SHASUMS256.txt"

# PINNED sha256(bun-linux-x64.zip) — computed from the official GitHub release
# asset bun-v1.4.2/bun-linux-x64.zip on 2026-09-13. Matches the official
# SHASUMS256.txt entry for that asset (both are verified at runtime anyway).
BUN_ZIP_SHA256="36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913"
# PINNED sha256 of the extracted `bun` binary from that same asset (also
# computed 2026-09-13) — used to verify reuse and the post-extraction binary.
BUN_BIN_SHA256="a83d263767d839e4d2649ca8e35d07159c7afc99afdc96d731ced29e056dda0c"

# ── Fallback source: the official npm package (owner 2026-11-08, option 2) ──
# GitHub's release downloads answered 504 for hours and every build failed.
# Bun publishes the same binary as @oven/bun-linux-x64 on the npm registry; its
# bin/bun is byte-identical to the GitHub asset (sha256 == BUN_BIN_SHA256,
# checked 2026-11-08). Used ONLY when a GitHub download fails, never when a
# GitHub file fails verification. The tarball must match BOTH the registry's
# published integrity AND the pinned one below, then the binary must match the
# pinned BUN_BIN_SHA256 and report exactly 1.4.2. Every check fails closed.
NPM_META_URL="https://registry.npmjs.org/@oven/bun-linux-x64/${BUN_VERSION}"
NPM_TGZ_URL="https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-${BUN_VERSION}.tgz"
NPM_TGZ_INTEGRITY="sha512-9/E/UXOTpSo3YsV5g+FhtTd/qTpiWoKuxS12cqtuYA1ssu9fRAoPQnipFgGyck3tWO63iUdxBiygq+kELFawng=="

BIN_DIR="$HOME/.bun/bin"
BIN_PATH="$BIN_DIR/bun"
mkdir -p "$BIN_DIR"

# ── Reuse path (fast, still fail-closed) ─────────────────────────────────────
if [ -x "$BIN_PATH" ]; then
  current_version="$("$BIN_PATH" --version 2>/dev/null || true)"
  if [ "$current_version" = "$BUN_VERSION" ]; then
    actual_bin="$(sha256sum "$BIN_PATH" | awk '{print $1}')"
    if [ "$actual_bin" = "$BUN_BIN_SHA256" ]; then
      echo "[bun-checksum] reuse: ${BIN_PATH} is bun ${current_version} and its sha256 matches the pinned binary digest (${actual_bin}) — VERIFIED, reusing"
      echo "[bun-checksum] resolved bun ${current_version} at ${BIN_PATH}"
      exit 0
    fi
    echo "[bun-checksum] existing ${BIN_PATH} is bun ${current_version} but sha256 ${actual_bin} != pinned ${BUN_BIN_SHA256} — reinstalling from verified source" >&2
  else
    echo "[bun-checksum] existing ${BIN_PATH} reports version '${current_version}' (want exactly '${BUN_VERSION}') — reinstalling from verified source" >&2
  fi
fi

# ── Download + verify (fresh install) ────────────────────────────────────────
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

CURL_RETRY=(--retry 3 --retry-delay 5 --retry-all-errors --connect-timeout 20 --max-time 120)

# Installs the verified binary at "$work/bin". Returns 2 only when a download
# failed (the caller may then use the npm fallback); exits 1 on any failed check.
install_from_github() {
  echo "[bun-checksum] downloading official release asset: ${ZIP_URL}"
  # Patient retries (owner 2026-11-08): GitHub answered 504 for SHASUMS256.txt for
  # several minutes and every Vercel build failed on the old 3 quick retries
  # (~7 s). Now 3 retries 5 s apart on any error, then the npm fallback; the checks below
  # are unchanged and still fail closed.
  curl -fsSL "${CURL_RETRY[@]}" -o "$work/$ZIP_NAME" "$ZIP_URL" || return 2
  echo "[bun-checksum] downloading official checksums: ${SHASUMS_URL}"
  curl -fsSL "${CURL_RETRY[@]}" -o "$work/SHASUMS256.txt" "$SHASUMS_URL" || return 2

  official_zip="$(awk '$2 == "bun-linux-x64.zip" {print $1}' "$work/SHASUMS256.txt")"
  if [ -z "$official_zip" ]; then
    echo "[bun-checksum] FAIL-CLOSED: official SHASUMS256.txt has no 'bun-linux-x64.zip' line — refusing to install an unverified binary" >&2
    exit 1
  fi

  actual_zip="$(sha256sum "$work/$ZIP_NAME" | awk '{print $1}')"
  echo "[bun-checksum] sha256(${ZIP_NAME})       = ${actual_zip}"
  echo "[bun-checksum] official SHASUMS256.txt   = ${official_zip}"
  echo "[bun-checksum] pinned digest (hardcoded) = ${BUN_ZIP_SHA256}"

  if [ "$actual_zip" != "$official_zip" ]; then
    echo "[bun-checksum] FAIL-CLOSED: zip digest != official SHASUMS256.txt entry — refusing to install an unverified binary" >&2
    exit 1
  fi
  if [ "$actual_zip" != "$BUN_ZIP_SHA256" ]; then
    echo "[bun-checksum] FAIL-CLOSED: zip digest != pinned digest — refusing to install an unverified binary" >&2
    exit 1
  fi
  echo "[bun-checksum] zip digest VERIFIED against official SHASUMS256.txt AND the pinned digest — extracting"

  mkdir -p "$work/out"
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "$work/$ZIP_NAME" -d "$work/out"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$work/$ZIP_NAME" "$work/out"
  else
    echo "[bun-checksum] FAIL-CLOSED: neither 'unzip' nor 'python3' is available to extract the verified archive" >&2
    exit 1
  fi

  src_bin="$work/out/bun-linux-x64/bun"
  if [ ! -f "$src_bin" ]; then
    echo "[bun-checksum] FAIL-CLOSED: verified archive does not contain bun-linux-x64/bun — refusing to install" >&2
    exit 1
  fi

  actual_bin="$(sha256sum "$src_bin" | awk '{print $1}')"
  if [ "$actual_bin" != "$BUN_BIN_SHA256" ]; then
    echo "[bun-checksum] FAIL-CLOSED: extracted binary sha256 ${actual_bin} != pinned binary digest ${BUN_BIN_SHA256} — refusing to install" >&2
    exit 1
  fi
  cp "$src_bin" "$work/bin"
}

sha512_b64() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import base64, hashlib, sys; print(base64.b64encode(hashlib.sha512(open(sys.argv[1], 'rb').read()).digest()).decode())" "$1"
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha512 -binary "$1" | base64 | tr -d '\n'
  else
    echo "[bun-checksum] FAIL-CLOSED: neither python3 nor openssl is available to verify the npm tarball" >&2
    exit 1
  fi
}

install_from_npm() {
  echo "[bun-checksum] GitHub download failed — using the official npm package: ${NPM_TGZ_URL}"
  curl -fsSL "${CURL_RETRY[@]}" -o "$work/meta.json" "$NPM_META_URL"
  curl -fsSL "${CURL_RETRY[@]}" -o "$work/bun.tgz" "$NPM_TGZ_URL"
  local registry_integrity actual_integrity
  registry_integrity="$(grep -o '"integrity":"sha512-[^"]*"' "$work/meta.json" | head -1 | sed 's/"integrity":"//; s/"$//')"
  actual_integrity="sha512-$(sha512_b64 "$work/bun.tgz")"
  echo "[bun-checksum] npm tarball integrity      = ${actual_integrity}"
  echo "[bun-checksum] npm registry integrity     = ${registry_integrity}"
  echo "[bun-checksum] pinned integrity (hardcoded) = ${NPM_TGZ_INTEGRITY}"
  if [ -z "$registry_integrity" ] || [ "$actual_integrity" != "$registry_integrity" ]; then
    echo "[bun-checksum] FAIL-CLOSED: npm tarball != the registry's published integrity — refusing to install" >&2
    exit 1
  fi
  if [ "$actual_integrity" != "$NPM_TGZ_INTEGRITY" ]; then
    echo "[bun-checksum] FAIL-CLOSED: npm tarball != pinned integrity — refusing to install" >&2
    exit 1
  fi
  mkdir -p "$work/npm"
  tar -xzf "$work/bun.tgz" -C "$work/npm"
  src_bin="$work/npm/package/bin/bun"
  if [ ! -f "$src_bin" ]; then
    echo "[bun-checksum] FAIL-CLOSED: verified npm tarball does not contain package/bin/bun — refusing to install" >&2
    exit 1
  fi
  actual_bin="$(sha256sum "$src_bin" | awk '{print $1}')"
  if [ "$actual_bin" != "$BUN_BIN_SHA256" ]; then
    echo "[bun-checksum] FAIL-CLOSED: npm binary sha256 ${actual_bin} != pinned binary digest ${BUN_BIN_SHA256} — refusing to install" >&2
    exit 1
  fi
  echo "[bun-checksum] npm binary VERIFIED against the registry integrity, the pinned integrity AND the pinned binary digest"
  cp "$src_bin" "$work/bin"
}

gh_status=0
install_from_github || gh_status=$?
if [ "$gh_status" -eq 2 ]; then
  install_from_npm
elif [ "$gh_status" -ne 0 ]; then
  exit "$gh_status"
fi
src_bin="$work/bin"
actual_bin="$(sha256sum "$src_bin" | awk '{print $1}')"
if [ "$actual_bin" != "$BUN_BIN_SHA256" ]; then
  echo "[bun-checksum] FAIL-CLOSED: binary sha256 ${actual_bin} != pinned binary digest ${BUN_BIN_SHA256} — refusing to install" >&2
  exit 1
fi
install -m 0755 "$src_bin" "$BIN_PATH"

# ── Version verification (fail closed; never execute an unverified binary) ──
resolved="$("$BIN_PATH" --version 2>/dev/null || true)"
if [ "$resolved" != "$BUN_VERSION" ]; then
  echo "[bun-checksum] FAIL-CLOSED: bun --version resolved to '${resolved}' (want exactly '${BUN_VERSION}') — refusing to use it" >&2
  exit 1
fi

echo "[bun-checksum] VERIFIED: bun ${resolved} installed at ${BIN_PATH}; binary sha256 ${actual_bin}"
echo "[bun-checksum] resolved bun ${resolved} at ${BIN_PATH}"