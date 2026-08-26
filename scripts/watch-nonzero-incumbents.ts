/**
 * Non-zero incumbent watch — Contract Radar demo hunt (owner-approved, 2026-08-26).
 *
 * Scans currently-OPEN set-aside bids in the production `bids` table and runs the
 * REAL incumbent lookup (`getFPDSIntel` from ~/lib/fpds — the exact same code path
 * the Contract Radar free matches use) against each one. Records every bid whose
 * incumbent lookup returns a STRICTLY NON-ZERO prior award (total_obligated > 0)
 * to /home/team/shared/radar-qa/nonzero-incumbent-watch.md with a timestamped
 * entry: bid id + title, NAICS, agency, set-aside, state (if the bid has one),
 * winner name, award amount, and the likely radar repro combo.
 *
 * Purpose: capture a live demo of the /radar free-match "PREVIOUS WINNER & AWARD
 * PRICE" block rendering a real named winner with a real dollar figure (PR #235's
 * non-zero preference is live in searchFPDSIncumbent). The one known real-winner
 * bid (Chicago Noon Meals → CHEFS FOR ALL SEASONS INC) genuinely awards $0, so a
 * non-zero demo must come from a bid that actually has prior award data — this
 * watch finds it. New solicitations sync every 4h; re-run after each sync.
 *
 * Truthfulness constraints:
 *   - Only REAL lookup results are recorded. If getFPDSIntel returns null or a
 *     $0/absent amount, the bid is SKIPPED (never fabricated, never recorded).
 *   - Deliberately does NOT bypass or manipulate the fpds_lookups cache: lookups
 *     flow through getFPDSIntel's normal ~30-day cached-lookup path (cached rows
 *     created after PR #235 already carry the non-zero preference). No cache rows
 *     are deleted or updated out-of-band.
 *   - No product behavior is changed; this is a standalone diagnostic script.
 *   - No GitHub Actions wiring yet — that is a follow-up decision after results.
 *
 * Usage:
 *   DATABASE_URL=... bun run scripts/watch-nonzero-incumbents.ts          # default batch 150
 *   BATCH=50  bun run scripts/watch-nonzero-incumbents.ts                 # bounded batch (most-recently-synced first)
 *   WATCH_FILE=/tmp/watch.md BATCH=10 bun run scripts/watch-nonzero-incumbents.ts  # custom watch file (testing)
 *
 * Rate-limit safety: bids are processed SEQUENTIALLY with a 250ms politeness
 * delay between calls; getFPDSIntel itself additionally throttles USAspending to
 * >=1s between HTTP requests (see src/lib/fpds.ts request()). Batch is bounded
 * (default 150) and ordered by created_at DESC (most recently synced first), so
 * later runs over fresh 4h syncs are small.
 */
import { mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { getFPDSIntel } from "../src/lib/fpds";
import { LOW_CONTENT_SQL } from "../src/lib/low-content";
import { STATE_LOCATION_REGEX } from "../src/lib/open-bids";

const DEFAULT_WATCH_FILE = "/home/team/shared/radar-qa/nonzero-incumbent-watch.md";
const WATCH_FILE = process.env.WATCH_FILE || DEFAULT_WATCH_FILE;
const BATCH = Math.max(1, Math.min(500, Number(process.env.BATCH ?? 150) || 150));
const POLITENESS_MS = 250;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set — point it at the production Neon DB.");
  process.exit(1);
}
const db = neon(DATABASE_URL);

/** Radar certifications the UI offers (mirrors RADAR_CERTS in src/routes/radar.tsx). */
const CERT_LABEL: Record<string, string> = {
  sdvosb: "SDVOSB",
  "8a": "8(a)",
  wosb: "WOSB",
  hubzone: "HUBZone",
  sb: "Small Business",
};

/** Map a bid's literal set_aside label to the radar cert that matches it. */
function certForSetAside(setAside: string | null): string {
  const s = String(setAside ?? "").toUpperCase();
  if (s.includes("8(A)") || s.includes("8AN")) return "8a";
  if (s.includes("SDVOSB")) return "sdvosb";
  if (s.includes("WOSB") || s.includes("EDWOSB")) return "wosb";
  if (s.includes("HUBZONE")) return "hubzone";
  return "sb"; // Small Business — the superset cert scan that returns every set-aside row
}

/** Extract the 2-letter state from a bid location, or null (nationwide/unknown). */
function stateOf(location: string | null): string | null {
  if (!location) return null;
  const m = String(location).match(STATE_LOCATION_REGEX);
  return m ? m[1].toUpperCase() : null;
}

const money = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function main() {
  const startedAt = Date.now();
  const nowIso = new Date().toISOString();
  mkdirSync(dirname(WATCH_FILE), { recursive: true });

  // 1. Bids already recorded in the watch file (dedupe across runs).
  const existing = (() => {
    try {
      return readFileSync(WATCH_FILE, "utf8");
    } catch {
      return "";
    }
  })();
  const recordedIds = new Set<number>(
    [...existing.matchAll(/\bbid\s+(\d+)\b/gi)].map((m) => Number(m[1])),
  );

  // 2. Open set-aside bids — same population predicates the radar scans
  //    (due_date > NOW(), set_aside present, LOW_CONTENT_SQL; the set-aside
  //    predicate is the radar's "Small Business" superset fragment:
  //    `AND set_aside IS NOT NULL` — see radar.tsx certFrag). Most recently
  //    synced first (bids has no sync timestamp; created_at DESC ≈ newest sync).
  const rows = await db`
    SELECT id, title, agency, location, set_aside, naics_code, source_url, due_date, created_at
    FROM bids
    WHERE due_date > NOW()
      AND set_aside IS NOT NULL AND btrim(set_aside) <> ''
      AND ${db.unsafe(LOW_CONTENT_SQL)}
    ORDER BY created_at DESC, id DESC
    LIMIT ${BATCH}
  `;

  console.log(
    `[watch] ${nowIso} — ${rows.length} open set-aside bids selected (batch limit ${BATCH})`,
  );

  const cacheCountBefore = (await db`SELECT count(*) AS c FROM fpds_lookups`)[0].c as number;
  const candidates: Array<Record<string, string>> = [];
  let skippedNoData = 0;
  let skippedZero = 0;
  let cached = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const r: any = rows[i];
    const id = Number(r.id);
    if (recordedIds.has(id)) {
      cached++; // already recorded in a prior run — no need to re-evaluate
      continue;
    }
    const naics = r.naics_code ? String(r.naics_code) : "";
    const agency = r.agency ? String(r.agency) : "";
    const title = r.title ? String(r.title) : "";
    const setAside = r.set_aside ? String(r.set_aside) : "";
    const state = stateOf(r.location ? String(r.location) : null);

    let inc: Awaited<ReturnType<typeof getFPDSIntel>> = null;
    try {
      // Real incumbent lookup — the exact call radar.tsx makes for free matches.
      inc = await getFPDSIntel(naics, agency, title);
    } catch (e: any) {
      errors++;
      console.error(`[watch] bid ${id} lookup threw: ${e?.message ?? e}`);
      inc = null;
    }

    // Politeness delay between per-bid incumbent lookups (USAspending is also
    // throttled >=1s/call inside getFPDSIntel).
    await new Promise((res) => setTimeout(res, POLITENESS_MS));

    if (!inc || !inc.incumbent_name) {
      skippedNoData++;
      continue;
    }
    const amount = Number(inc.total_obligated ?? 0);
    if (!(amount > 0)) {
      skippedZero++; // honest $0 / absent — not a non-zero candidate
      continue;
    }

    const cert = certForSetAside(setAside);
    const certLabel = CERT_LABEL[cert];
    const winName = String(inc.incumbent_name).replace(/\s+/g, " ").trim();
    const entry = [
      `## ${nowIso} — bid ${id} (non-zero incumbent)`,
      `- **Bid:** ${title.replace(/\s+/g, " ").trim()} (bid ${id})`,
      `- **NAICS:** ${naics || "(none)"} · **Agency:** ${agency || "(none)"} · **Set-aside:** ${setAside || "(none)"}`,
      `- **State:** ${state ?? "nationwide/unknown"} · **Due:** ${String(r.due_date ?? "unknown").slice(0, 10)}`,
      `- **Winner:** ${winName} · **Prior award amount:** ${money(amount)}`,
      `- **Radar repro:** /radar → trade = ${naics || "(blank)"}, state = ${state ?? "(blank — nationwide)"}, cert = ${certLabel}, size = Any size`,
      `- **Source:** ${r.source_url || "(no source_url)"}`,
      "",
    ].join("\n");
    appendFileSync(WATCH_FILE, entry + "\n");
    candidates.push({
      id: String(id),
      title: title.replace(/\s+/g, " ").trim(),
      naics,
      agency,
      setAside,
      state: state ?? "nationwide",
      winner: winName,
      amount: money(amount),
      combo: `trade=${naics || "(blank)"} · state=${state ?? "(blank)"} · cert=${certLabel} · size=Any`,
    });
    console.log(
      `[watch] ★ CANDIDATE bid ${id}: ${title} → ${winName} ${money(amount)} (${certLabel}, ${state ?? "nationwide"})`,
    );
  }

  const cacheCountAfter = (await db`SELECT count(*) AS c FROM fpds_lookups`)[0].c as number;
  const elapsedMs = Date.now() - startedAt;
  const totalOpen = (await db`
    SELECT count(*) AS c FROM bids
    WHERE due_date > NOW() AND set_aside IS NOT NULL AND btrim(set_aside) <> ''
  `)[0].c as number;

  // Run log line (append-only history; also records honest empty runs).
  const logLine = [
    `| ${nowIso} | ${rows.length} | ${candidates.length} | ${skippedNoData} | ${skippedZero} | ${errors} | ${Math.max(0, cacheCountAfter - cacheCountBefore)} | ${(elapsedMs / 1000).toFixed(0)}s |`,
  ].join("");
  appendFileSync(
    WATCH_FILE,
    `\n${existing.length === 0 ? "## Run log\n| run (UTC) | scanned | candidates | no-incumbent | zero-amount | errors | new cache rows | elapsed |\n|---|---|---|---|---|---|---|---|\n" : ""}${logLine}\n`,
  );

  console.log("─".repeat(72));
  console.log(`[watch] SUMMARY`);
  console.log(`[watch]   open set-aside bids in DB (due > NOW): ${totalOpen}`);
  console.log(`[watch]   scanned this run:                   ${rows.length}`);
  console.log(`[watch]   already-recorded (skipped):         ${cached}`);
  console.log(`[watch]   no incumbent data:                  ${skippedNoData}`);
  console.log(`[watch]   zero-amount incumbent (honest $0):   ${skippedZero}`);
  console.log(`[watch]   lookup errors:                      ${errors}`);
  console.log(`[watch]   CANDIDATES (non-zero incumbent):    ${candidates.length}`);
  for (const c of candidates) {
    console.log(`[watch]     ★ bid ${c.id} — ${c.title} — ${c.winner} ${c.amount}`);
    console.log(`[watch]       combo: ${c.combo}`);
  }
  console.log(`[watch]   elapsed: ${(elapsedMs / 1000).toFixed(1)}s · watch file: ${WATCH_FILE}`);
  console.log(`[watch]   fpds_lookups rows: ${cacheCountBefore} → ${cacheCountAfter} (+${Math.max(0, cacheCountAfter - cacheCountBefore)}) (created via the normal cached-lookup path only)`);
}

main().catch((e) => {
  console.error("[watch] fatal:", e);
  process.exit(1);
});