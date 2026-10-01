/**
 * Unit tests for the line-number-free typecheck fingerprint gate (backlog 33fa250b).
 *
 * These prove the three behaviours the gate must have, using the REAL checked-in
 * scripts (scripts/typecheck-fingerprint.sh + scripts/typecheck-baseline-gate.sh)
 * and the REAL committed baseline (.github/typecheck-baseline.txt) — not a
 * reimplementation:
 *
 *   (b) a harmless LINE-NUMBER SHIFT produces ZERO delta → gate PASSES;
 *   (c) a genuinely NEW error produces an added line → gate FAILS;
 *       a REMOVED/fixed error produces a removed line → gate FAILS (deliberate
 *       baseline update required — no silent pass, no silent clean claim).
 *
 * The gate script only needs a synthetic "current tsc output" file for these
 * cases (--current), so no vite build / routeTree.gen.ts is required here.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const REPO_ROOT = resolve(dirname(import.meta.dir), ".");
const NORMALIZER = join(REPO_ROOT, "scripts/typecheck-fingerprint.sh");
const GATE = join(REPO_ROOT, "scripts/typecheck-baseline-gate.sh");
const BASELINE = join(REPO_ROOT, ".github/typecheck-baseline.txt");

// ── helpers ──────────────────────────────────────────────────────────────────

/** Run the canonical normalizer over `text` (stdin) and return its stdout. */
function fingerprint(text: string): string {
  return execFileSync("bash", [NORMALIZER], { input: text, encoding: "utf8" });
}

/** Fingerprint + sort -u, exactly like the gate does. */
function fingerprintSet(text: string): string[] {
  return fingerprint(text)
    .split("\n")
    .filter((l) => l !== "")
    .sort();
}

interface GateResult {
  status: number;
  stdout: string;
}

/** Run the real gate against a synthetic "current" file + a baseline file. */
function runGate(currentText: string, baselineFile: string): GateResult {
  const dir = mkdtempSync(join(tmpdir(), "tc-gate-"));
  const currentPath = join(dir, "current.txt");
  writeFileSync(currentPath, currentText);
  try {
    const stdout = execFileSync(
      "bash",
      [GATE, "--current", currentPath, "--baseline", baselineFile],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? "" };
  }
}

/** Write a synthetic baseline fixture and return its path. */
function writeBaseline(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "tc-base-"));
  const p = join(dir, "baseline.txt");
  writeFileSync(p, lines.join("\n") + "\n");
  return p;
}

const RAW = {
  radar901:
    "src/routes/radar.tsx(901,25): error TS2339: Property 'certLabel' does not exist on type 'ScanState'.",
  radar975:
    "src/routes/radar.tsx(975,25): error TS2339: Property 'certLabel' does not exist on type 'ScanState'.",
  learnings:
    "src/routes/learnings.tsx(89,27): error TS2554: Expected 1 arguments, but got 0.",
};

const FP = {
  radar:
    "src/routes/radar.tsx: error TS2339: Property 'certLabel' does not exist on type 'ScanState'.",
  learnings:
    "src/routes/learnings.tsx: error TS2554: Expected 1 arguments, but got 0.",
};

// ── 1. the normalizer itself ─────────────────────────────────────────────────

describe("typecheck-fingerprint.sh", () => {
  test("strips (line,col) and keeps file + error code + message", () => {
    expect(fingerprint(RAW.radar975 + "\n")).toBe(FP.radar + "\n");
  });

  test("a pure line shift normalizes to the SAME fingerprint (901 vs 975)", () => {
    expect(fingerprint(RAW.radar901 + "\n")).toBe(fingerprint(RAW.radar975 + "\n"));
  });

  test("already-fingerprinted lines are idempotent", () => {
    expect(fingerprint(FP.radar + "\n")).toBe(FP.radar + "\n");
  });

  test("tsc --pretty form (file:line:col - error) is also stripped", () => {
    expect(
      fingerprint(
        "src/routes/learnings.tsx:89:27 - error TS2554: Expected 1 arguments, but got 0.\n",
      ),
    ).toBe(FP.learnings + "\n");
  });

  test("lines with no position (or no error code) pass through unchanged — never dropped", () => {
    const passthrough = [
      "error TS5058: The specified path does not exist: 'tsconfig.missing.json'.",
      "src/routes/./weird file.tsx(1,2): error TS2339: x", // unquoted space: no match, untouched
    ];
    const out = fingerprint(passthrough.join("\n") + "\n");
    expect(out).toBe(passthrough[0] + "\n" + passthrough[1] + "\n");
  });

  test("empty input is not an error", () => {
    expect(fingerprint("")).toBe("");
  });

  test("the position inside a MESSAGE is never touched (anchor + file/code shape)", () => {
    const line =
      "src/lib/x.ts(10,3): error TS2345: Argument of type 'A(1,2)' is not assignable.";
    expect(fingerprint(line + "\n")).toBe(
      "src/lib/x.ts: error TS2345: Argument of type 'A(1,2)' is not assignable.\n",
    );
  });
});

// ── 2. the committed baseline really is fingerprintable ──────────────────────

describe("committed baseline (.github/typecheck-baseline.txt)", () => {
  const raw = readFileSync(BASELINE, "utf8");
  const rawLines = raw.split("\n").filter((l) => l.trim() !== "");

  test("every committed line is single-line, positioned, and fingerprintable", () => {
    // If a line does not match this shape the normalizer cannot fingerprint it
    // (multi-line message / odd format) — fail loudly here instead of letting
    // the CI gate drift.
    const shape = /^(?:"[^"]*"|[^ (]+)\([0-9]+,[0-9]+\): error TS[0-9]+: .+$/;
    const unfingerprintable = rawLines.filter((l) => !shape.test(l));
    expect(unfingerprintable).toEqual([]);
  });

  test("fingerprinting preserves every baseline line (no loss, no false collapse)", () => {
    const set = fingerprintSet(raw);
    expect(set).toHaveLength(rawLines.length);
    // spot-check the item that used to need a manual edit in #394
    expect(set).toContain(FP.radar);
  });

  test("the normalized baseline is a fixed point (running the normalizer twice changes nothing)", () => {
    const once = fingerprint(raw);
    expect(fingerprint(once)).toBe(once);
  });
});

// ── 3. (b) a line-number shift is a 0-delta PASS against the REAL baseline ───

describe("gate — line-number shift (proof b)", () => {
  test("every real baseline error shifted by +1000 lines → PASS, 0 delta", () => {
    const raw = readFileSync(BASELINE, "utf8");
    const shifted = raw
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => l.replace(/\((\d+),(\d+)\)/, (_m, ln) => `(${Number(ln) + 1000},1)`))
      .join("\n");

    // sanity: the shifted text is genuinely different from the baseline
    expect(shifted).not.toBe(readFileSync(BASELINE, "utf8").trim());

    const res = runGate(shifted + "\n", BASELINE);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("delta vs committed baseline: 0");
    expect(res.stdout).not.toContain("^\n"); // no diff hunks
  });

  test("adding blank/comment lines above an existing error → PASS, 0 delta", () => {
    const fixture = [RAW.radar901, RAW.learnings].join("\n") + "\n";
    const baseline = writeBaseline([RAW.radar901, RAW.learnings]);

    // same two errors, each pushed down by 74 lines (blank lines added above)
    const shifted = [
      "src/routes/radar.tsx(975,25): error TS2339: Property 'certLabel' does not exist on type 'ScanState'.",
      "src/routes/learnings.tsx(163,27): error TS2554: Expected 1 arguments, but got 0.",
    ].join("\n");

    expect(shifted).not.toBe(fixture);
    const res = runGate(shifted + "\n", baseline);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("current fingerprints: 2");
    expect(res.stdout).toContain("delta vs committed baseline: 0");
  });
});

// ── 4. (c) a new / removed error still FAILS ─────────────────────────────────

describe("gate — genuinely new or removed errors (proof c)", () => {
  const baselineLines = [RAW.radar901, RAW.learnings];

  test("one new error → +1 added line → FAIL", () => {
    const baseline = writeBaseline(baselineLines);
    const current = [
      RAW.radar975,
      "src/routes/learnings.tsx(163,27): error TS2554: Expected 1 arguments, but got 0.",
      "src/lib/new-file.ts(4,7): error TS6133: 'unused' is declared but its value is never read.",
    ].join("\n");

    const res = runGate(current + "\n", baseline);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("src/lib/new-file.ts: error TS6133:");
    expect(res.stdout).toMatch(/^\+\s*src\/lib\/new-file\.ts: error TS6133:/m);
    expect(res.stdout).toContain("::error::Typecheck fingerprint delta");
  });

  test("one removed/fixed error → removed line → FAIL (deliberate update required)", () => {
    const baseline = writeBaseline(baselineLines);
    const current = RAW.radar975 + "\n"; // learnings error fixed

    const res = runGate(current, baseline);
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/^-\s*src\/routes\/learnings\.tsx: error TS2554:/m);
  });

  test("an identical error set at identical positions still passes (no behaviour change)", () => {
    const baseline = writeBaseline(baselineLines);
    const res = runGate(baselineLines.join("\n") + "\n", baseline);
    expect(res.status).toBe(0);
  });

  test("a changed MESSAGE for the same file+code is a real delta → FAIL", () => {
    const baseline = writeBaseline([RAW.radar901]);
    const current =
      "src/routes/radar.tsx(901,25): error TS2339: Property 'otherThing' does not exist on type 'ScanState'.\n";
    expect(runGate(current, baseline).status).toBe(1);
  });
});
