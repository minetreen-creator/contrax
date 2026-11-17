/**
 * Find bids — CLI entrypoint (`bun run find-bids`), run by hand from .github/workflows/find-bids.yml
 * (owner 2026-11-16: he pastes a contractor's Facebook post and the reply names real open bids in
 * that trade and state). Prints open bids in one state whose title matches any of the given words:
 * id, title, agency, location, due date, source. READ-ONLY: it changes nothing and sends nothing.
 */
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { stateHintPatterns } from "~/lib/radar-scan-query";
import { findBidsPattern } from "~/lib/find-bids";

async function main() {
  const state = (process.env.STATE ?? "").trim().toUpperCase();
  const hint = stateHintPatterns(state);
  const pattern = findBidsPattern(process.env.WORDS ?? "");
  if (!hint || !pattern) throw new Error("Give a two-letter STATE and at least one word of three letters or more in WORDS.");
  const place = (process.env.PLACE ?? "").trim().toLowerCase();
  const s = sql();
  const rows = (await s`
    SELECT id, title, agency, location, due_date, source
    FROM bids
    WHERE due_date > NOW() AND ${s.unsafe(LOW_CONTENT_SQL)}
      AND title ~* ${pattern}
      AND (LOWER(COALESCE(location,'')) LIKE ${hint.name} OR LOWER(COALESCE(agency,'')) LIKE ${hint.name}
           OR COALESCE(location,'') ~* ${hint.token} OR COALESCE(agency,'') ~* ${hint.token})
    ORDER BY due_date ASC
    LIMIT 400
  `) as { id: number; title: string; agency: string; location: string | null; due_date: string; source: string }[];
  const near = place ? rows.filter((r) => `${r.location ?? ""} ${r.agency} ${r.title}`.toLowerCase().includes(place)) : [];
  console.log(`FOUND ${rows.length} open in ${state} for /${pattern}/${place ? `; ${near.length} mention "${place}"` : ""}`);
  for (const r of near) console.log(`NEAR ${r.id} | ${r.title.slice(0, 110)} | ${r.agency.slice(0, 60)} | ${r.location ?? ""} | due ${String(r.due_date).slice(0, 10)} | ${r.source}`);
  for (const r of rows.slice(0, 80)) console.log(`BID ${r.id} | ${r.title.slice(0, 110)} | ${r.agency.slice(0, 60)} | ${r.location ?? ""} | due ${String(r.due_date).slice(0, 10)} | ${r.source}`);
}

if (import.meta.main) {
  main().then(() => process.exit(0)).catch((e) => { console.error("💥 Find bids crashed:", e); process.exit(1); });
}
