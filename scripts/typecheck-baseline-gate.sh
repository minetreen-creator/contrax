#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Baseline-delta gate for the PROD-CONFIG typecheck (owner-approved, PR #375;
# line-number-free fingerprints added for backlog 33fa250b, 2026-09-17).
#
# Semantics — UNCHANGED from the inline CI step this script replaces:
#   * .github/typecheck-baseline.txt is a committed record of origin/main's
#     PRE-EXISTING prod-config type errors (noUnusedLocals /
#     noUnusedParameters stay true in tsconfig.prod.json).
#   * This gate prints the CURRENT error count and an explicit unified diff of
#     the current error set vs the baseline, and FAILS on BOTH directions:
#       - added lines   = NEW errors introduced by the branch;
#       - removed lines = a baseline mismatch, which must surface as a visible
#                         diff requiring a DELIBERATE baseline-file update.
#   * It is never a silent pass and never described as "typecheck-clean" —
#     pre-existing errors still exist and the baseline records them.
#   * The pass line prints the ACTUAL current + baseline fingerprint counts
#     (no hardcoded number to go stale).
#
# What changed (backlog 33fa250b): BOTH sides are normalized through
# scripts/typecheck-fingerprint.sh before the sort -u + diff -u, so each
# compared line is a fingerprint of `file: error TS<code>: <message>` with the
# `(line,col)` position stripped. A harmless line-number shift above a
# pre-existing error therefore produces ZERO delta (it used to produce a false
# delta and a mandatory manual baseline edit — #392, #393, #394), while a new
# error and a fixed/removed error each still fail the gate.
#
# MUST run AFTER the vite build (routeTree.gen.ts has to exist first, or tsc
# emits fake TS2307 cascades). This script runs `bun run typecheck` itself, so
# calling it from the CI step keeps the existing step ORDER untouched.
#
# Usage:
#   scripts/typecheck-baseline-gate.sh                     # CI: runs `bun run typecheck`
#   scripts/typecheck-baseline-gate.sh --current FILE      # local/tests: use FILE as tsc output
#   scripts/typecheck-baseline-gate.sh --current FILE --baseline FILE
# Exit: 0 = 0 delta; 1 = delta detected (gate FAIL); 2 = bad usage.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NORMALIZER="$SCRIPT_DIR/typecheck-fingerprint.sh"

BASELINE="$REPO_ROOT/.github/typecheck-baseline.txt"
CURRENT_FILE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --baseline)
      BASELINE="${2:?--baseline needs a file path}"
      shift 2
      ;;
    --current)
      CURRENT_FILE="${2:?--current needs a file path}"
      shift 2
      ;;
    -h | --help)
      sed -n '2,40p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "unknown argument: $1 (see --help)" >&2
      exit 2
      ;;
  esac
done

[ -r "$BASELINE" ] || {
  echo "::error::typecheck baseline file not readable: $BASELINE"
  exit 2
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── 1. current error lines (raw) ─────────────────────────────────────────────
if [ -z "$CURRENT_FILE" ]; then
  cd "$REPO_ROOT"
  echo "--- running: bun run typecheck (prod config, post-build) ---"
  bun run typecheck >"$WORK/current-raw.txt" 2>&1 || true
  CURRENT_FILE="$WORK/current-raw.txt"
else
  [ -r "$CURRENT_FILE" ] || {
    echo "::error::--current file not readable: $CURRENT_FILE"
    exit 2
  }
fi

# ── 2. fingerprint both sides, then the existing sort -u ─────────────────────
grep -E 'error TS[0-9]+' "$CURRENT_FILE" | bash "$NORMALIZER" | sort -u >"$WORK/current-lines.txt" || true
bash "$NORMALIZER" <"$BASELINE" | sort -u >"$WORK/baseline-lines.txt"

COUNT=$(wc -l <"$WORK/current-lines.txt")
BASELINE_COUNT=$(wc -l <"$WORK/baseline-lines.txt")

echo "--- current prod-config typecheck fingerprints (line-number-free): ${COUNT} ---"
echo "--- committed baseline fingerprints ($BASELINE): ${BASELINE_COUNT} ---"
echo "--- unified diff of fingerprints vs the baseline ('-' = baseline-only line = fixed/removed error; '+' = current-only line = new error) ---"

# ── 3. the existing diff -u + FAIL-on-any-delta behaviour ────────────────────
set +e
diff -u "$WORK/baseline-lines.txt" "$WORK/current-lines.txt"
DIFF_RC=$?
set -e

if [ "$DIFF_RC" -ne 0 ]; then
  echo "::error::Typecheck fingerprint delta vs the committed ${BASELINE_COUNT}-fingerprint baseline detected — see the unified diff above (added lines = new errors; removed lines = baseline mismatch requiring a deliberate baseline-file update). Failing."
  exit 1
fi

echo "pre-existing baseline + line-number-free fingerprint delta gate — PASS (current fingerprints: ${COUNT}; baseline fingerprints: ${BASELINE_COUNT}; delta vs committed baseline: 0)"
