import { createHash } from "node:crypto";
import { sql } from "~/db";
import { getRequestContext } from "~/lib/request-context";
import { newWatermarkToken } from "~/lib/bid-watermark";

/** See src/lib/bid-watermark.ts. The IP is kept only as an md5 hash. */
let ready = false;
async function ensureTable(): Promise<void> {
  if (ready) return;
  await sql()`CREATE TABLE IF NOT EXISTS bid_watermarks (
    token TEXT PRIMARY KEY,
    bid_id INTEGER NOT NULL,
    ip_md5 TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  ready = true;
}

/** Record a token for this render of a bid page. Fail-open: null means no watermark. */
export async function recordBidWatermark(bidId: number): Promise<string | null> {
  try {
    await ensureTable();
    const ip = getRequestContext().ip;
    const ipMd5 = ip ? createHash("md5").update(ip).digest("hex") : null;
    const token = newWatermarkToken();
    await sql()`INSERT INTO bid_watermarks (token, bid_id, ip_md5) VALUES (${token}, ${bidId}, ${ipMd5}) ON CONFLICT (token) DO NOTHING`;
    return token;
  } catch (e) {
    console.error("[bid-watermark] not recorded:", (e as Error).message);
    return null;
  }
}

/** Owner lookup: who was served each token (bid, time, and that visit's country and browser). */
export async function lookupBidWatermarks(tokens: string[]): Promise<
  { token: string; bid_id: number | null; bid_title: string | null; served_at: string | null; country: string | null; user_agent: string | null; views_that_hour: number }[]
> {
  if (!tokens.length) return [];
  await ensureTable();
  const out = [];
  for (const token of tokens.slice(0, 20)) {
    const [w] = (await sql()`
      SELECT w.bid_id, w.created_at, w.ip_md5, b.title FROM bid_watermarks w LEFT JOIN bids b ON b.id = w.bid_id WHERE w.token = ${token}`) as {
      bid_id: number; created_at: string | Date; ip_md5: string | null; title: string | null;
    }[];
    if (!w) {
      out.push({ token, bid_id: null, bid_title: null, served_at: null, country: null, user_agent: null, views_that_hour: 0 });
      continue;
    }
    const at = new Date(w.created_at);
    const [pv] = (w.ip_md5
      ? await sql()`
        SELECT v.country, pv.user_agent FROM page_views pv LEFT JOIN visitors v ON v.visitor_id = pv.visitor_id
        WHERE md5(pv.ip) = ${w.ip_md5} AND pv.created_at BETWEEN ${new Date(at.getTime() - 120_000)} AND ${new Date(at.getTime() + 120_000)}
        ORDER BY abs(extract(epoch from pv.created_at - ${at})) LIMIT 1`
      : []) as { country: string | null; user_agent: string | null }[];
    const [n] = (w.ip_md5
      ? await sql()`SELECT COUNT(*)::int AS n FROM bid_watermarks WHERE ip_md5 = ${w.ip_md5} AND created_at BETWEEN ${new Date(at.getTime() - 1_800_000)} AND ${new Date(at.getTime() + 1_800_000)}`
      : [{ n: 0 }]) as { n: number }[];
    out.push({
      token,
      bid_id: Number(w.bid_id),
      bid_title: w.title ? String(w.title) : null,
      served_at: at.toISOString(),
      country: pv?.country ?? null,
      user_agent: pv?.user_agent ?? null,
      views_that_hour: Number(n?.n ?? 0),
    });
  }
  return out;
}
