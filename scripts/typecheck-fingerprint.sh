#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Canonical LINE-NUMBER-FREE typecheck FINGERPRINT normalizer (backlog 33fa250b,
# owner-suggested 2026-09-13).
#
# Reads raw tsc output on stdin (one error per line) and writes each line with
# its `(line,col)` — or `:line:col` — position REMOVED, so the line becomes a
# stable fingerprint:
#
#       path/to/file.ext: error TS<code>: <message>
#
#   in : src/routes/radar.tsx(975,25): error TS2339: Property 'certLabel' does not exist on type 'ScanState'.
#   out: src/routes/radar.tsx: error TS2339: Property 'certLabel' does not exist on type 'ScanState'.
#
# WHY (the failure this removes): .github/typecheck-baseline.txt records
# origin/main's PRE-EXISTING prod-config type errors, and the CI delta gate
# compares the current error set against it. While the raw `(line,col)` took
# part in the comparison, an edit that merely shifted code up or down rewrote
# the recorded position of an UNCHANGED pre-existing error → a false delta →
# red CI → a manual baseline-line edit (it happened in #392, #393 and #394).
# Fingerprinting by file + error code + message (no position) makes a pure line
# shift a 0-delta no-op, while:
#   * a genuinely NEW error still shows up as an added line (gate FAILS), and
#   * a removed/fixed error still shows up as a removed line (gate FAILS —
#     a deliberate baseline-file update is required). No silent pass.
#
# Position forms handled:
#   1. tsc's default CI form:  <file>(<line>,<col>): error TSxxxx: <message>
#   2. tsc's --pretty form:    <file>:<line>:<col> - error TSxxxx: <message>
# Both collapse to form 1's output (`<file>: error TSxxxx: <message>`).
# Anything else — e.g. a whole-program error with no position — is passed
# through UNCHANGED, never silently dropped, so it still participates in the
# delta comparison.
#
# Extension-agnostic on purpose: the file token is matched generically (any
# leading run of non-space characters, optionally a quoted path when the file
# name contains spaces), so .ts/.tsx/.mts/.d.ts/.css.ts/... all fingerprint
# without a hardcoded extension list. Quotes are kept in the output (only the
# position is stripped) so a quoted path still compares exactly.
#
# Dependency-free: POSIX tools only (bash + sed -E; GNU sed on the CI runner,
# BSD sed locally — both accept these expressions). Exit status is 0 unless sed
# itself fails; it never fails just because stdin was empty.
#
# Usage:
#   grep -E 'error TS[0-9]+' current.txt | scripts/typecheck-fingerprint.sh
#   scripts/typecheck-fingerprint.sh < .github/typecheck-baseline.txt
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

sed -E \
  -e 's/^("[^"]*"|[^ (]+)\([0-9]+,[0-9]+\)(: error TS[0-9]+:)/\1\2/' \
  -e 's/^("[^"]*"|[^ (:]+):[0-9]+:[0-9]+ - (error TS[0-9]+:)/\1: \2/'
