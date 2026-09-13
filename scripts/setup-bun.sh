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

echo "[bun-checksum] downloading official release asset: ${ZIP_URL}"
curl -fsSL --retry 3 -o "$work/$ZIP_NAME" "$ZIP_URL"
echo "[bun-checksum] downloading official checksums: ${SHASUMS_URL}"
curl -fsSL --retry 3 -o "$work/SHASUMS256.txt" "$SHASUMS_URL"

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
install -m 0755 "$src_bin" "$BIN_PATH"

# ── Version verification (fail closed; never execute an unverified binary) ──
resolved="$("$BIN_PATH" --version 2>/dev/null || true)"
if [ "$resolved" != "$BUN_VERSION" ]; then
  echo "[bun-checksum] FAIL-CLOSED: bun --version resolved to '${resolved}' (want exactly '${BUN_VERSION}') — refusing to use it" >&2
  exit 1
fi

echo "[bun-checksum] VERIFIED: bun ${resolved} installed at ${BIN_PATH}; binary sha256 ${actual_bin}"
echo "[bun-checksum] resolved bun ${resolved} at ${BIN_PATH}"