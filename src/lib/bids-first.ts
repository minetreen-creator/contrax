/**
 * Real trade bids open in one state, by trade (owner 2026-11-07/08). One source
 * for three places: the Radar landing panel, the Contrax app's "Bids near me"
 * and the pricing page's sample 6 AM email. Counts follow a Radar search's own
 * rules, so a tab count equals the search it links to.
 */
import { createServerFn } from "@tanstack/react-start";
import { STATE_NAMES } from "~/lib/contract-map";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { matchGeographyBucket } from "~/lib/location-state";
import { radarRowPasses } from "~/lib/radar-candidates";
import { stateFromGeoHeaders } from "~/lib/radar-geo";
import { collapseScanRows, loadNoticeDedupeKeys, stateHintPatterns } from "~/lib/radar-scan-query";
import { expandTrade, isStrongTradeMatch } from "~/lib/trade-registry";

/**
 * Bids first (owner 2026-11-07, "Yes build it"): 82% of Radar visitors left
 * before searching, so the first screen shows live open bids for the visitor's
 * state right away, with tabs for the four trades people search most. State
 * comes from Vercel's IP geolocation (or the picker); real rows only, with the
 * same open / low-content / award guards as every opportunity surface. Does
 * not touch the Radar preview allowance.
 */
export const BIDS_FIRST_TABS = [
  { id: "construction", label: "Construction", trade: "construction" },
  { id: "landscaping", label: "Landscaping", trade: "landscaping" },
  { id: "janitorial", label: "Janitorial", trade: "janitorial" },
  { id: "security", label: "Security guards", trade: "security guard" },
] as const;
export type BidsFirstTab = (typeof BIDS_FIRST_TABS)[number]["id"];
export type BidsFirstBid = { id: number; title: string; agency: string; location: string | null; due_date: string | null; posted: string | null };
export type BidsFirstData = { state: string; total: number; counts: Record<BidsFirstTab, number>; bids: Record<BidsFirstTab, BidsFirstBid[]> };
const BIDS_FIRST_PER_TAB = 6;
/** Per-instance cache: the landing panel is the same for everyone in a state for a few minutes. */
const bidsFirstCache = new Map<string, { at: number; data: BidsFirstData | null }>();
const BIDS_FIRST_TTL_MS = 10 * 60_000;

export const getBidsFirst = createServerFn({ method: "GET" })
  .validator((d: unknown) => {
    const s = String((d as { state?: unknown } | undefined)?.state ?? "").toUpperCase();
    return /^[A-Z]{2}$/.test(s) ? s : "";
  })
  .handler(async ({ data }): Promise<BidsFirstData | null> => {
    try {
      let state = data;
      if (!state) {
        const { getRequest } = await import("@tanstack/react-start/server");
        const h = getRequest().headers;
        state = stateFromGeoHeaders(h.get("x-vercel-ip-country"), h.get("x-vercel-ip-country-region"));
      }
      return await loadBidsFirst(state);
    } catch (err) {
      console.error("[radar] bids-first failed:", err);
      return null;
    }
  });

/**
 * The bids-first rows for one state; null when the state is unknown or has no
 * open bids. Counts follow a Radar search's own rules (owner 2026-11-08: the
 * panel said 111 Florida construction bids while the search said 25), so a tab
 * count equals the "found" count of the search it links to: the same in-state
 * candidates (location/agency mentions the state), Radar's strong-match test,
 * small-business set-aside rule and location checks (radarRowPasses), the local
 * bucket (matchGeographyBucket) and the same duplicate collapse. The list then
 * shows only bids that are still worth opening (2+ days left, no award notices,
 * no parts orders). A live search per tab took up to 20 s, so this runs over the
 * state's open bids in one query, cached per state for 10 minutes.
 */
export async function loadBidsFirst(state: string, now: number = Date.now()): Promise<BidsFirstData | null> {
  if (!state || !/^[A-Z]{2}$/.test(state) || !STATE_NAMES[state]) return null;
  const hit = bidsFirstCache.get(state);
  if (hit && now - hit.at < BIDS_FIRST_TTL_MS) return hit.data;
  const hint = stateHintPatterns(state);
  if (!hint) return null;
  const { sql } = await import("~/db");
  const { AWARD_EXCLUSION_SQL } = await import("~/lib/source-class");
  const s = sql();
  // Same open + low-content rule and the same in-state hint as Radar's state pass.
  const rows = (await s`
    SELECT id, title, agency, location, set_aside, source, naics_code, due_date, created_at,
           (${s.unsafe(AWARD_EXCLUSION_SQL)}) AS listable
    FROM bids
    WHERE due_date > NOW() AND ${s.unsafe(LOW_CONTENT_SQL)}
      AND (LOWER(COALESCE(location,'')) LIKE ${hint.name}
           OR LOWER(COALESCE(agency,'')) LIKE ${hint.name}
           OR COALESCE(location,'') ~* ${hint.token}
           OR COALESCE(agency,'') ~* ${hint.token})
    ORDER BY created_at DESC
  `) as Record<string, any>[];
  const local = rows.filter((r) => matchGeographyBucket(state, r.location, r.agency) === "local");
  const strongByTab = new Map<BidsFirstTab, Record<string, any>[]>();
  for (const t of BIDS_FIRST_TABS) {
    const expansion = expandTrade(t.trade);
    strongByTab.set(t.id, local.filter((r) => isStrongTradeMatch(String(r.title ?? ""), null, null, r.naics_code, expansion)));
  }
  // For the strong rows only: the description (radarRowPasses reads it: a place
  // named there can contradict the state) and a flag per tab for the search's
  // own SQL filters, its keyword predicate and the small-business set-aside
  // fragment. A row the search's query would never fetch is never counted here.
  const { tradeKeywordPred } = await import("~/lib/trade-registry");
  const { sbCertFragment } = await import("~/lib/cert-matching");
  const certFrag = sbCertFragment(sql);
  const ids = [...new Set([...strongByTab.values()].flat().map((r) => Number(r.id)))];
  const flags = BIDS_FIRST_TABS.map((t) => s`(TRUE ${certFrag} ${tradeKeywordPred(sql, expandTrade(t.trade))}) AS ${s.unsafe(`q_${t.id}`)}`);
  const flagList = flags.reduce((acc, f, i) => (i === 0 ? f : s`${acc}, ${f}`));
  const extra = ids.length ? ((await s`SELECT id, description, ${flagList} FROM bids WHERE id = ANY(${ids})`) as Record<string, any>[]) : [];
  const extraById = new Map(extra.map((d) => [Number(d.id), d]));
  const out: BidsFirstData = {
    state,
    total: local.length,
    counts: { construction: 0, landscaping: 0, janitorial: 0, security: 0 },
    bids: { construction: [], landscaping: [], janitorial: [], security: [] },
  };
  const day = 86_400_000;
  for (const t of BIDS_FIRST_TABS) {
    type Row = { id: number; title: string | null; agency: string | null; location: string | null; source: string | null; due_date: string | null; created_at: string | null; listable: boolean; description: string | null };
    const passing: Row[] = (strongByTab.get(t.id) ?? [])
      .filter((r) => extraById.get(Number(r.id))?.[`q_${t.id}`] === true)
      .map((r) => ({ ...r, id: Number(r.id), description: extraById.get(Number(r.id))?.description ?? null }) as Row)
      .filter((r) => radarRowPasses(r, "sb", state));
    const collapsed = await collapseScanRows(passing, (rowIds) => loadNoticeDedupeKeys(sql, rowIds));
    out.counts[t.id] = collapsed.rows.length;
    for (const r of collapsed.rows) {
      if (out.bids[t.id].length >= BIDS_FIRST_PER_TAB) break;
      const title = String(r.title ?? "");
      const due = r.due_date ? new Date(r.due_date).getTime() : 0;
      if (!r.listable || due < now + 2 * day || title.length < 15 || /intent to (sole[ -]source|award)|sole[ -]source/i.test(title)) continue;
      out.bids[t.id].push({ id: Number(r.id), title, agency: String(r.agency ?? ""), location: r.location ?? null, due_date: r.due_date ? new Date(r.due_date).toISOString() : null, posted: r.created_at ? new Date(r.created_at).toISOString() : null });
    }
  }
  const data = out.total > 0 ? out : null;
  bidsFirstCache.set(state, { at: now, data });
  return data;
}
