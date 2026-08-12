#!/usr/bin/env node
/**
 * check-routes.mjs — pre-merge syntax gate for TanStack route files.
 *
 * Parses every route file (src/routes/**\/*.tsx, plus src/routes.ts if it
 * exists) with @babel/parser using the JSX + TypeScript plugins. Any file
 * that fails to parse (invalid JSX structure, missing closing tag, stray
 * syntax, etc.) is reported by name and the script exits non-zero.
 *
 * This catches the failure mode that broke the Vercel production build twice
 * (most recently PR #104 / commit 730ff5c): a component's return() containing
 * two root-level JSX elements without a fragment. The @tanstack/router-generator
 * rejects that file during `vite build` ("SyntaxError: Unexpected token,
 * expected ','"), but nothing in the pre-merge path parsed route files until
 * this check existed. @babel/parser produces the same error message the
 * router-generator does, since both use the Babel parser family.
 *
 * Pure syntax checking — requires NO env vars (no DATABASE_URL, no Stripe,
 * nothing). Intentionally fast: a full parse of every route file should take
 * well under a second.
 *
 * Usage:
 *   bun run check:routes      (or: node scripts/check-routes.mjs)
 */
import { parse } from "@babel/parser";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const routesDir = join(repoRoot, "src", "routes");

/** Recursively collect all *.tsx files under `dir`. */
function collectTsx(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectTsx(full, out);
    } else if (entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
}

const files = [];
if (existsSync(routesDir)) {
  collectTsx(routesDir, files);
}
// TanStack can also generate a route tree at src/routes.ts — include it when
// present so a broken generator output can't slip through either.
const routesTs = join(repoRoot, "src", "routes.ts");
if (existsSync(routesTs)) {
  files.push(routesTs);
}
files.sort();

if (files.length === 0) {
  console.error(
    `❌ check-routes: no route files found under ${relative(repoRoot, routesDir)} — refusing to pass with zero files checked.`
  );
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const rel = relative(repoRoot, file);
  try {
    parse(readFileSync(file, "utf8"), {
      sourceType: "module",
      plugins: [
        ["typescript", { isTSX: true }], // .tsx: disallow <T>expr assertions, like tsc
        "jsx",
      ],
    });
  } catch (err) {
    failed++;
    const loc = err.loc ? `:${err.loc.line}:${err.loc.column + 1}` : "";
    console.error(`✗ ${rel}${loc}`);
    console.error(`  ${String(err.message).split("\n")[0]}`);
    if (err.codeFrame) {
      console.error(err.codeFrame.trimEnd());
    }
  }
}

if (failed > 0) {
  console.error(
    `\n❌ Route syntax check failed: ${failed}/${files.length} route file(s) contain invalid JSX/TSX syntax.`
  );
  console.error(
    "   Fix the reported files (e.g. wrap multiple root-level JSX elements in a fragment <>...</>) and re-run."
  );
  process.exit(1);
}

console.log(`✅ Route syntax check passed: ${files.length} route file(s) parsed OK.`);
