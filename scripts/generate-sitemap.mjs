#!/usr/bin/env node
/**
 * generate-sitemap.mjs — build-time sitemap generator for the FAR/DFARS clause
 * library (first demand channel, owner green-lit 2026-08-16).
 *
 * public/sitemap.xml used to be a hand-maintained static file (79 URLs, zero
 * clause URLs) — invisible to crawlers. This script turns it into a generated
 * artifact that preserves the existing static entries VERBATIM and appends one
 * <url> per REAL clause_number from the `far_clauses` table, plus the new
 * /clauses index page. No clause number is ever fabricated: the source of
 * truth is the database.
 *
 * FAIL-OPEN contract (never breaks a deploy):
 *   - If DATABASE_URL is missing or the query fails, the existing sitemap.xml
 *     is left untouched (the last-known good file, committed to the repo)
 *     and the script exits 0 with a warning. If no sitemap exists at all, a
 *     minimal fallback (homepage + /clauses + /pricing + /learn) is written.
 *
 * Wired into build-vercel.sh BEFORE `bun run build`, so Vite copies the fresh
 * public/sitemap.xml into dist/client → .vercel/output/static. robots.txt
 * already points crawlers at https://www.contrax.company/sitemap.xml.
 *
 * Usage:
 *   bun scripts/generate-sitemap.mjs        (DATABASE_URL optional; fails open)
 */
import { neon } from "@neondatabase/serverless";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const SITEMAP_PATH = join(root, "public", "sitemap.xml");
const PROD_URL = "https://www.contrax.company";
const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

const escapeXml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/**
 * SEO landing pages (scope: /home/team/shared/seo-landing-pages-scope.md).
 * The set-aside hubs + index + /contracts-by-industry are always-valid pages
 * (they render honestly even with zero open bids), so they are emitted
 * statically. The per-state region pages are emitted from a live DB count
 * below (only states that actually have open bids), mirroring how clause URLs
 * are generated — never a fabricated/hardcoded combos list.
 */
const SEO_LANDING_PATHS = [
  "/set-aside-contracts",
  "/8a-contracts",
  "/sdvosb-contracts",
  "/wosb-contracts",
  "/hubzone-contracts",
  "/small-business-contracts",
  "/contracts-by-industry",
];
/** Full state name -> region URL slug ("New Jersey" -> "new-jersey"). */
const STATE_SLUGS = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california",
  CO: "colorado", CT: "connecticut", DE: "delaware", FL: "florida", GA: "georgia",
  HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas",
  KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland", MA: "massachusetts",
  MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana",
  NE: "nebraska", NV: "nevada", NH: "new-hampshire", NJ: "new-jersey", NM: "new-mexico",
  NY: "new-york", NC: "north-carolina", ND: "north-dakota", OH: "ohio", OK: "oklahoma",
  OR: "oregon", PA: "pennsylvania", RI: "rhode-island", SC: "south-carolina",
  SD: "south-dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont",
  VA: "virginia", WA: "washington", WV: "west-virginia", WI: "wisconsin",
  WY: "wyoming", DC: "district-of-columbia",
};
/** Resolve a bid's location string to a 2-letter US state code, or null. */
function deriveStateCode(location) {
  const loc = String(location ?? "").trim();
  if (!loc) return null;
  const tokens = loc.split(/[\s,()/]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i].toUpperCase();
    if (/^[A-Z]{2}$/.test(t) && STATE_SLUGS[t]) return t;
  }
  const lower = loc.toLowerCase();
  for (const [code, slug] of Object.entries(STATE_SLUGS)) {
    const name = slug.replace(/-/g, " ");
    const re = new RegExp(`\\b${name.replace(" ", "\\s+")}\\b`);
    if (re.test(lower)) return code;
  }
  return null;
}

/** Pull the existing <url>...</url> blocks, dropping any clause URLs (they are
 * regenerated fresh from the DB below — keeps re-runs idempotent). */
function readStaticUrlBlocks() {
  if (!existsSync(SITEMAP_PATH)) return [];
  const xml = readFileSync(SITEMAP_PATH, "utf8");
  const blocks = [];
  const re = /<url>([\s\S]*?)<\/url>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[0];
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1] ?? "";
    // Both the per-clause URLs and the /clauses index URL are generated —
    // drop them from the preserved set so re-runs stay idempotent. Likewise
    // the SEO landing pages (set-aside hubs, /contracts-by-industry and every
    // /contracts-in/* region page) are regenerated fresh below, so drop them
    // too — otherwise a re-run would duplicate each one.
    if (
      loc.includes("/clauses/") ||
      loc === `${PROD_URL}/clauses` ||
      loc.includes("/contracts-in/") ||
      SEO_LANDING_PATHS.some((p) => loc === `${PROD_URL}${p}`)
    ) continue;
    blocks.push(block);
  }
  return blocks;
}

/** Minimal fallback when there is no previous sitemap AND the DB is down. */
function writeFallback(reason) {
  const blocks = [
    `<url>\n    <loc>${PROD_URL}/</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
    `<url>\n    <loc>${PROD_URL}/clauses</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`,
    `<url>\n    <loc>${PROD_URL}/pricing</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.9</priority>\n  </url>`,
    `<url>\n    <loc>${PROD_URL}/learn</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>`,
  ];
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...blocks.map((b) => `  ${b}`),
    "</urlset>",
    "",
  ].join("\n");
  writeFileSync(SITEMAP_PATH, xml);
  console.warn(
    `[generate-sitemap] ${reason} — wrote minimal fallback (${blocks.length} URLs) to ${SITEMAP_PATH}`,
  );
}

async function main() {
  const staticBlocks = readStaticUrlBlocks();

  if (!process.env.DATABASE_URL) {
    if (staticBlocks.length > 0) {
      console.warn(
        `[generate-sitemap] DATABASE_URL not set — keeping existing sitemap.xml (${staticBlocks.length} static URLs, clause URLs untouched)`,
      );
      return; // fail open: leave the committed last-known file in place
    }
    writeFallback("DATABASE_URL not set and no existing sitemap");
    return;
  }

  let clauseNumbers;
  let partNumbers = [];
  let regionSlugs = [];
  try {
    const db = neon(process.env.DATABASE_URL);
    const rows = await db`SELECT clause_number FROM far_clauses ORDER BY clause_number`;
    clauseNumbers = rows.map((r) => r.clause_number).filter(Boolean);
    // Part landing pages (/clauses/52, /clauses/252, …) — DB-driven distinct
    // part list, never hardcoded. Shares the same try/catch so a DB failure
    // keeps the fail-open contract (last-known sitemap preserved).
    // GROUP BY (not DISTINCT): Postgres rejects ORDER BY part::int under DISTINCT
    // (ORDER BY expressions must appear in the select list). GROUP BY permits
    // ordering by an expression of the grouped column.
    const partRows = await db`SELECT part FROM far_clauses WHERE part IS NOT NULL GROUP BY part ORDER BY part::int`;
    partNumbers = partRows.map((r) => String(r.part)).filter(Boolean);
  } catch (err) {
    console.warn(
      `[generate-sitemap] far_clauses query failed (${err?.message ?? err}) — keeping existing sitemap.xml`,
    );
    if (staticBlocks.length === 0) writeFallback("far_clauses query failed and no existing sitemap");
    return; // fail open: keep last-known sitemap, never break the deploy
  }
  // Region landing pages (/contracts-in/{state}) — live per-state count over
  // open bids, mirroring the clause generation so only real combos appear.
  // Isolated try/catch: a region failure must NOT drop the clause URLs, so we
  // fall back to emitting the static set-aside-hub set only (regionSlugs = []).
  try {
    const db = neon(process.env.DATABASE_URL);
    const regionRows = await db`SELECT location FROM bids WHERE (due_date IS NULL OR due_date::date >= NOW()::date)`;
    const seen = new Set();
    for (const r of regionRows) {
      const code = deriveStateCode(r.location);
      if (code && !seen.has(code)) seen.add(code);
    }
    regionSlugs = Array.from(seen).sort();
  } catch (err) {
    console.warn(
      `[generate-sitemap] region query failed (${err?.message ?? err}) — emitting set-aside hubs only`,
    );
  }

  const partBlocks = partNumbers.map(
    (p) =>
      `  <url>\n    <loc>${PROD_URL}/clauses/${escapeXml(p)}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`,
  );
  const clauseBlocks = clauseNumbers.map(
    (n) =>
      `  <url>\n    <loc>${PROD_URL}/clauses/${escapeXml(n)}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.5</priority>\n  </url>`,
  );
  const indexBlock = `  <url>\n    <loc>${PROD_URL}/clauses</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`;

  // SEO landing pages: set-aside hubs + index + /contracts-by-industry, plus
  // the live region pages. All are always-valid pages; the region set is
  // DB-driven above so only states with real open bids appear.
  const landBlocks = SEO_LANDING_PATHS.map(
    (p) =>
      `  <url>\n    <loc>${PROD_URL}${escapeXml(p)}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`,
  );
  const regionBlocks = regionSlugs
    .filter((code) => STATE_SLUGS[code])
    .map(
      (code) =>
        `  <url>\n    <loc>${PROD_URL}/contracts-in/${STATE_SLUGS[code]}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`,
    );

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...staticBlocks.map((b) => `  ${b}`),
    indexBlock,
    ...landBlocks,
    ...regionBlocks,
    ...partBlocks,
    ...clauseBlocks,
    "</urlset>",
    "",
  ].join("\n");
  writeFileSync(SITEMAP_PATH, xml);
  console.log(
    `[generate-sitemap] wrote ${SITEMAP_PATH}: ${staticBlocks.length} static + 1 clauses index + ${landBlocks.length} landing + ${regionBlocks.length} region + ${partBlocks.length} part + ${clauseBlocks.length} clause URLs = ${staticBlocks.length + 1 + landBlocks.length + regionBlocks.length + partBlocks.length + clauseBlocks.length} total`,
  );
}

main().catch((err) => {
  // Absolute last-resort guard — still fail open.
  console.warn(`[generate-sitemap] unexpected error (${err?.message ?? err}) — leaving existing sitemap.xml`);
  if (!existsSync(SITEMAP_PATH)) writeFallback("unexpected error and no existing sitemap");
});
