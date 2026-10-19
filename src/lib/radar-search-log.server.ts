/**
 * Radar search log (owner 2026-10-19: "add saving trade and state on
 * searches"). One row per completed Radar scan, from the homepage finder or
 * /radar, so we can see which trade + state searches come back empty (Denver
 * trucking account: 3 of 5 searches showed nothing, and nothing recorded what
 * was typed).
 *
 * Stores only the search itself (trade, state, cert, size) and the result
 * counts, keyed to the visitor id and account id we already track. Fail-open:
 * a logging failure never breaks the scan.
 */
import { sql } from "~/db";

export interface RadarSearchLogEntry {
  visitorId: string | null;
  userId: number | null;
  trade: string;
  state: string;
  cert: string;
  sizePref: string;
  matched: number;
  shown: number;
  related: number;
}

/** Trimmed, length-capped values for the row; null ids stay null. */
export function radarSearchLogRow(e: RadarSearchLogEntry) {
  return {
    visitor_id: e.visitorId ? e.visitorId.slice(0, 64) : null,
    user_id: e.userId ?? null,
    trade: e.trade.trim().slice(0, 120),
    state: e.state.trim().slice(0, 2).toUpperCase(),
    cert: e.cert.slice(0, 24),
    size_pref: e.sizePref.slice(0, 24),
    matched: Math.max(0, Math.trunc(e.matched)),
    shown: Math.max(0, Math.trunc(e.shown)),
    related: Math.max(0, Math.trunc(e.related)),
  };
}

let tableReady = false;
async function ensureRadarSearchLogTable(): Promise<boolean> {
  if (tableReady) return true;
  try {
    await sql()`CREATE TABLE IF NOT EXISTS radar_search_log (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      visitor_id TEXT,
      user_id INTEGER,
      trade TEXT NOT NULL,
      state TEXT NOT NULL,
      cert TEXT NOT NULL,
      size_pref TEXT NOT NULL,
      matched INTEGER NOT NULL,
      shown INTEGER NOT NULL,
      related INTEGER NOT NULL
    )`;
    await sql()`CREATE INDEX IF NOT EXISTS radar_search_log_created_idx ON radar_search_log (created_at)`;
    tableReady = true;
    return true;
  } catch (err) {
    console.error("[radar-search-log] table ensure failed (fail-open):", err);
    return false;
  }
}

export async function recordRadarSearch(entry: RadarSearchLogEntry): Promise<void> {
  try {
    if (!entry.trade.trim()) return;
    if (!(await ensureRadarSearchLogTable())) return;
    const r = radarSearchLogRow(entry);
    await sql()`INSERT INTO radar_search_log
      (visitor_id, user_id, trade, state, cert, size_pref, matched, shown, related)
      VALUES (${r.visitor_id}, ${r.user_id}, ${r.trade}, ${r.state}, ${r.cert}, ${r.size_pref}, ${r.matched}, ${r.shown}, ${r.related})`;
  } catch (err) {
    console.error("[radar-search-log] insert failed (non-fatal):", err);
  }
}
