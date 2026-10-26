import { sql } from "../db";
import { BLOCKED_IPS } from "./request-ip";

/**
 * Site-wide IP block (owner 2026-10-26: "block that last IP address too").
 * The owner console's Block button (track-visitor API) writes `blocked_ips`;
 * vercel-entry.ts refuses every function request from a listed IP with a 403.
 *
 * Exact match only, like BLOCKED_IPS in request-ip.ts (those stay blocked
 * too). The list is cached per function instance for 60 seconds so the
 * check costs one query a minute, not one per request. Any database error
 * fails open: a broken blocklist must never take the site down.
 */
const TTL_MS = 60_000;
let cache: { ips: Set<string>; at: number } | null = null;

export async function ensureBlockedIpsTable(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS blocked_ips (
    ip TEXT PRIMARY KEY,
    blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    visitor_id TEXT,
    note TEXT
  )`;
}

async function blockedSet(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ips;
  const ips = new Set(BLOCKED_IPS);
  try {
    if (process.env.DATABASE_URL) {
      await ensureBlockedIpsTable();
      const rows = (await sql()`SELECT ip FROM blocked_ips`) as { ip: string }[];
      for (const r of rows) ips.add(r.ip);
    }
  } catch (e) {
    console.error("[ip-block] blocklist unavailable, allowing traffic:", e);
  }
  cache = { ips, at: Date.now() };
  return ips;
}

/** Every blocked IP right now (cached like isIpBlocked). */
export async function blockedIps(): Promise<Set<string>> {
  return blockedSet();
}

/** True when this exact IP is blocked. An empty IP is never blocked. */
export async function isIpBlocked(ip: string | null | undefined): Promise<boolean> {
  const v = String(ip ?? "").trim();
  if (!v) return false;
  return (await blockedSet()).has(v);
}

/** Drop the cache so a block or unblock takes effect on this instance now. */
export function clearIpBlockCache(): void {
  cache = null;
}
