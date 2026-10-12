/**
 * City/county (/bids-in/{state}/{place}) and agency (/agency/{slug}) landing
 * pages. Every count and bid is a live query of open rows from the buyer's own
 * source (src/lib/local-agencies.ts) — the same open / not-low-content / not-an-
 * award / one-row-per-notice filters as the state pages. A database failure
 * returns honest zeros instead of a 500.
 */
import { createServerFn } from "@tanstack/react-start";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { noticeKeySql } from "~/lib/notice-dedupe";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { applyHeadStart } from "~/lib/head-start";
import { BidCard, type SeoBid } from "~/lib/seo-landing";
import {
  AGENCY_BY_SLUG,
  LOCAL_PLACES,
  RESOLVED_AGENCIES,
  agencyForRow,
  agencyHref,
  agencyScope,
  findPlace,
  placeHref,
  type LocalAgency,
  type LocalPlace,
  type ResolvedAgency,
} from "~/lib/local-agencies";

const BID_COLS = "id, title, agency, description, due_date, estimated_value, naics_code, location, set_aside, source_url, source, created_at";

function mapBid(r: any): SeoBid {
  return applyHeadStart({
    id: Number(r.id),
    title: String(r.title ?? ""),
    agency: r.agency ? String(r.agency) : null,
    description: r.description ? String(r.description) : null,
    due_date: r.due_date ? String(r.due_date) : null,
    estimated_value: r.estimated_value ? String(r.estimated_value) : null,
    naics_code: r.naics_code ? String(r.naics_code) : null,
    location: r.location ? String(r.location) : null,
    set_aside: r.set_aside ? String(r.set_aside) : null,
    source_url: r.source_url ? String(r.source_url) : null,
    source: r.source ? String(r.source) : null,
    created_at: r.created_at ?? null,
  }, false);
}

/** WHERE clause scoping rows to the given agencies (whole sources + exact buyer pairs). */
function scopeWhere(sql: any, agencies: readonly LocalAgency[]) {
  const { sources, pairSources, pairAgencies } = agencyScope(agencies);
  return sql()`(
    source = ANY(${sources})
    OR (source, agency) IN (SELECT s, a FROM unnest(${pairSources}::text[], ${pairAgencies}::text[]) AS t(s, a))
  )`;
}

/** Open-bid count per agency slug. */
export async function openCountsByAgency(agencies: readonly LocalAgency[]): Promise<Record<string, number>> {
  if (agencies.length === 0) return {};
  const { sql } = await import("~/db");
  const rows = (await sql()`
    SELECT source, agency, COUNT(*)::int AS n FROM (
      SELECT DISTINCT ON (${sql().unsafe(noticeKeySql("bids"))}) source, agency
      FROM bids
      WHERE due_date > NOW() AND ${scopeWhere(sql, agencies)}
        AND ${sql().unsafe(LOW_CONTENT_SQL)}
        AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
      ORDER BY ${sql().unsafe(noticeKeySql("bids"))}, created_at DESC NULLS LAST
    ) d
    GROUP BY source, agency
  `) as { source: string; agency: string | null; n: number }[];
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const a = agencyForRow(agencies, r.source, r.agency);
    if (a) counts[a.slug] = (counts[a.slug] ?? 0) + Number(r.n);
  }
  return counts;
}

/** Open bids from the given agencies, soonest deadline first. */
async function openBids(agencies: readonly LocalAgency[], limit: number): Promise<SeoBid[]> {
  const { sql } = await import("~/db");
  const rows = await sql()`
    SELECT ${sql().unsafe(BID_COLS)} FROM (
      SELECT DISTINCT ON (${sql().unsafe(noticeKeySql("bids"))}) ${sql().unsafe(BID_COLS)}
      FROM bids
      WHERE due_date > NOW() AND ${scopeWhere(sql, agencies)}
        AND ${sql().unsafe(LOW_CONTENT_SQL)}
        AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
      ORDER BY ${sql().unsafe(noticeKeySql("bids"))}, created_at DESC NULLS LAST
    ) t
    ORDER BY t.due_date ASC NULLS LAST
    LIMIT ${limit}
  `;
  return (rows as any[]).map(mapBid);
}

/** Bids closing within 7 days, out of an already-sorted list. */
export function closingWithinWeek(bids: SeoBid[], now = Date.now()): number {
  const week = now + 7 * 24 * 60 * 60 * 1000;
  return bids.filter((b) => {
    const t = b.due_date ? new Date(b.due_date).getTime() : NaN;
    return !Number.isNaN(t) && t > now && t <= week;
  }).length;
}

export interface AgencyCount {
  slug: string;
  name: string;
  count: number;
}

export interface PlaceData {
  place: Omit<LocalPlace, "agencies"> | null;
  agencies: AgencyCount[];
  count: number;
  bids: SeoBid[];
  generatedAt: string;
}

export const getPlaceData = createServerFn({ method: "GET" })
  .validator((d: unknown) => ({
    state: String((d as any)?.state ?? "").toLowerCase(),
    place: String((d as any)?.place ?? "").toLowerCase(),
  }))
  .handler(async ({ data }): Promise<PlaceData> => {
    const place = findPlace(data.state, data.place);
    if (!place) return { place: null, agencies: [], count: 0, bids: [], generatedAt: new Date().toISOString() };
    let counts: Record<string, number> = {};
    let bids: SeoBid[] = [];
    try {
      counts = await openCountsByAgency(place.agencies);
      bids = await openBids(place.agencies, 30);
    } catch (e) {
      console.error("[local-landing] place query failed:", e);
      counts = {};
      bids = [];
    }
    const { agencies, ...rest } = place;
    return {
      place: rest,
      agencies: agencies.map((a) => ({ slug: a.slug, name: a.name, count: counts[a.slug] ?? 0 })),
      count: Object.values(counts).reduce((s, n) => s + n, 0),
      bids,
      generatedAt: new Date().toISOString(),
    };
  });

export interface AgencyData {
  agency: Omit<ResolvedAgency, "source" | "agencyName"> | null;
  count: number;
  bids: SeoBid[];
  /** Other agencies we read in the same place. */
  siblings: { slug: string; name: string }[];
  generatedAt: string;
}

export const getAgencyData = createServerFn({ method: "GET" })
  .validator((d: unknown) => String((d as any)?.slug ?? "").toLowerCase())
  .handler(async ({ data }): Promise<AgencyData> => {
    const agency = AGENCY_BY_SLUG[data];
    if (!agency) return { agency: null, count: 0, bids: [], siblings: [], generatedAt: new Date().toISOString() };
    let count = 0;
    let bids: SeoBid[] = [];
    try {
      count = (await openCountsByAgency([agency]))[agency.slug] ?? 0;
      bids = await openBids([agency], 50);
    } catch (e) {
      console.error("[local-landing] agency query failed:", e);
      count = 0;
      bids = [];
    }
    const { source: _source, agencyName: _agencyName, ...rest } = agency;
    const siblings = RESOLVED_AGENCIES.filter(
      (a) => a.slug !== agency.slug && a.stateSlug === agency.stateSlug && a.placeSlug === agency.placeSlug,
    ).map((a) => ({ slug: a.slug, name: a.name }));
    return { agency: rest, count, bids, siblings, generatedAt: new Date().toISOString() };
  });

export interface LocalIndexPlace {
  name: string;
  href: string;
  stateCode: string;
  stateName: string;
  count: number;
  agencies: (AgencyCount & { href: string })[];
}

/** Every place with its live open count (zero-count places included, marked). */
export const getLocalIndex = createServerFn({ method: "GET" }).handler(async (): Promise<LocalIndexPlace[]> => {
  let counts: Record<string, number> = {};
  try {
    counts = await openCountsByAgency(RESOLVED_AGENCIES);
  } catch (e) {
    console.error("[local-landing] index query failed:", e);
  }
  return LOCAL_PLACES.map((p) => {
    const agencies = p.agencies.map((a) => ({ slug: a.slug, name: a.name, href: agencyHref(a), count: counts[a.slug] ?? 0 }));
    return {
      name: p.name,
      href: placeHref(p),
      stateCode: p.stateCode,
      stateName: p.stateName,
      count: agencies.reduce((s, a) => s + a.count, 0),
      agencies,
    };
  });
});

// ── Views ────────────────────────────────────────────────────────────────────

const chipCls =
  "rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-100 hover:text-slate-900";

function EmptyState({ who }: { who: string }) {
  return (
    <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <h2 className="text-xl font-bold text-slate-900">No open solicitations from {who} right now</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">
        We check for new bids every 4 hours on weekdays. Contract Radar can alert you when the next one posts.
      </p>
      <a href="/radar" className="mt-5 inline-block rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800">
        Search open bids in Radar
      </a>
    </section>
  );
}

function BidList({ count, bids, who }: { count: number; bids: SeoBid[]; who: string }) {
  const soon = closingWithinWeek(bids);
  return (
    <section>
      <h2 className="text-2xl font-bold text-slate-900">
        {count.toLocaleString("en-US")} open solicitation{count === 1 ? "" : "s"} from {who}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Soonest deadline first{count > bids.length ? ` · showing ${bids.length}` : ""}
        {soon > 0 ? ` · ${soon} closing in the next 7 days` : ""}. Each links to its official notice.
      </p>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2">
        {bids.map((b) => (
          <BidCard key={b.id} b={b} />
        ))}
      </ul>
    </section>
  );
}

export function PlaceView({ data }: { data: PlaceData }) {
  if (!data.place) return <EmptyState who="this place" />;
  const p = data.place;
  return (
    <>
      <section className="mb-8">
        <h2 className="text-lg font-bold text-slate-900">Buyers we read in {p.name}</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {data.agencies.map((a) => (
            <li key={a.slug}>
              <a href={agencyHref(a)} className={chipCls}>
                {a.name} <span className="text-slate-500">· {a.count} open</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
      {data.count === 0 ? <EmptyState who={p.name} /> : <BidList count={data.count} bids={data.bids} who={p.name} />}
      <p className="mt-8 text-sm">
        <a href={`/contracts-in/${p.stateSlug}`} className="font-semibold text-blue-600 hover:text-blue-800">
          All government contracts in {p.stateName} →
        </a>
        <span className="mx-3 text-slate-300">·</span>
        <a href="/local-bids" className="font-semibold text-blue-600 hover:text-blue-800">
          Other cities and counties →
        </a>
      </p>
    </>
  );
}

export function AgencyView({ data }: { data: AgencyData }) {
  if (!data.agency) return <EmptyState who="this agency" />;
  const a = data.agency;
  return (
    <>
      {data.count === 0 ? <EmptyState who={a.name} /> : <BidList count={data.count} bids={data.bids} who={a.name} />}
      {data.siblings.length > 0 && (
        <section className="mt-10">
          <h3 className="text-lg font-bold text-slate-900">Other buyers in {a.place}</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {data.siblings.map((s) => (
              <a key={s.slug} href={agencyHref(s)} className={chipCls}>
                {s.name}
              </a>
            ))}
          </div>
        </section>
      )}
      <p className="mt-8 text-sm">
        <a href={placeHref({ stateSlug: a.stateSlug, slug: a.placeSlug })} className="font-semibold text-blue-600 hover:text-blue-800">
          All bids in {a.place}, {a.stateName} →
        </a>
        <span className="mx-3 text-slate-300">·</span>
        <a href={`/contracts-in/${a.stateSlug}`} className="font-semibold text-blue-600 hover:text-blue-800">
          All government contracts in {a.stateName} →
        </a>
      </p>
    </>
  );
}

export function LocalIndexView({ places }: { places: LocalIndexPlace[] }) {
  const byState = new Map<string, LocalIndexPlace[]>();
  for (const p of places) {
    const list = byState.get(p.stateName) ?? [];
    list.push(p);
    byState.set(p.stateName, list);
  }
  return (
    <div className="space-y-8">
      {[...byState.entries()].map(([state, list]) => (
        <section key={state}>
          <h2 className="text-xl font-bold text-slate-900">{state}</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {list.map((p) => (
              <li key={p.href} className="rounded-2xl border border-slate-200 bg-white p-4">
                <a href={p.href} className="text-base font-semibold text-blue-700 hover:text-blue-900">
                  {p.name} <span className="text-sm font-normal text-slate-500">· {p.count} open</span>
                </a>
                <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {p.agencies.map((a) => (
                    <li key={a.slug}>
                      <a href={a.href} className="text-slate-600 hover:text-slate-900 hover:underline">
                        {a.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** "Cities and counties in {state}" chips for the state page; nothing when we read none there. */
export function StatePlaceLinks({ stateCode, stateName }: { stateCode: string; stateName: string }) {
  const places = LOCAL_PLACES.filter((p) => p.stateCode === stateCode);
  if (places.length === 0) return null;
  return (
    <section className="mt-10">
      <h3 className="text-lg font-bold text-slate-900">City and county bids in {stateName}</h3>
      <div className="mt-4 flex flex-wrap gap-2">
        {places.map((p) => (
          <a key={p.slug} href={placeHref(p)} className={chipCls}>
            {p.name}
          </a>
        ))}
      </div>
    </section>
  );
}
