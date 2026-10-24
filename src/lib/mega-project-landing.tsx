/**
 * /mega-projects pages: the curated project facts (src/lib/mega-projects.ts) plus
 * a live list of open public bids from the buyers around each site, using the
 * same open-bid queries as the city/county pages. A database failure shows
 * honest zeros, never a 500.
 */
import { createServerFn } from "@tanstack/react-start";
import { formatCompactMoney, type SeoBid } from "~/lib/seo-landing";
import { agencyHref } from "~/lib/local-agencies";
import { BidList, EmptyState, openBids, openCountsByAgency, type AgencyCount } from "~/lib/local-landing";
import {
  MEGA_PROJECTS,
  MEGA_PROJECT_BY_SLUG,
  STATUS_LABEL,
  megaProjectHref,
  nearbyAgencies,
  type MegaProject,
} from "~/lib/mega-projects";

export interface MegaProjectData {
  project: MegaProject | null;
  agencies: AgencyCount[];
  count: number;
  bids: SeoBid[];
  generatedAt: string;
}

export const getMegaProjectData = createServerFn({ method: "GET" })
  .validator((d: unknown) => String((d as any)?.slug ?? "").toLowerCase())
  .handler(async ({ data }): Promise<MegaProjectData> => {
    const project = MEGA_PROJECT_BY_SLUG[data] ?? null;
    if (!project) return { project: null, agencies: [], count: 0, bids: [], generatedAt: new Date().toISOString() };
    const near = nearbyAgencies(project);
    let counts: Record<string, number> = {};
    let bids: SeoBid[] = [];
    try {
      counts = await openCountsByAgency(near);
      bids = await openBids(near, 30);
    } catch (e) {
      console.error("[mega-projects] nearby query failed:", e);
      counts = {};
      bids = [];
    }
    return {
      project,
      agencies: near.map((a) => ({ slug: a.slug, name: a.name, count: counts[a.slug] ?? 0 })),
      count: Object.values(counts).reduce((s, n) => s + n, 0),
      bids,
      generatedAt: new Date().toISOString(),
    };
  });

// ── Views ────────────────────────────────────────────────────────────────────

const chipCls =
  "rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-100 hover:text-slate-900";

function fmtDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-base font-bold text-slate-900">{value}</dd>
    </div>
  );
}

export function MegaProjectView({ data }: { data: MegaProjectData }) {
  const p = data.project;
  if (!p) return <EmptyState who="this project" />;
  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-3">
        <Fact label="Owner" value={p.owner} />
        <Fact label="Investment" value={formatCompactMoney(p.investment)} />
        <Fact label="Status" value={STATUS_LABEL[p.status]} />
        <Fact label="Groundbreaking" value={p.groundbreaking ? fmtDate(p.groundbreaking) : "Not yet"} />
        <Fact label="Expected to open" value={p.expectedOpen ?? "Not announced"} />
        <Fact
          label="Jobs"
          value={[
            p.constructionJobs ? `${p.constructionJobs.toLocaleString("en-US")} construction` : null,
            p.permanentJobs ? `${p.permanentJobs.toLocaleString("en-US")} permanent` : null,
          ].filter(Boolean).join(" · ") || "Not announced"}
        />
      </dl>

      <section className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5">
        <h2 className="text-lg font-bold text-slate-900">General contractor</h2>
        <p className="mt-1 text-sm text-slate-700">
          {p.generalContractor ?? (
            <>
              <strong>Not yet publicly named.</strong> This is a private project, so its trade work is bought by the general contractor or construction
              manager, not posted as a public bid. We'll update this page when the firm is announced.
            </>
          )}
        </p>
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-xl font-bold text-slate-900">How to get work on it</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
            {p.howToGetIn.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </section>
        <section>
          <h2 className="text-xl font-bold text-slate-900">Trades a build like this needs</h2>
          <p className="mt-1 text-xs text-slate-500">Typical for this kind of facility, not a published bid list.</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {p.trades.map((t) => (
              <li key={t} className="rounded-full bg-slate-200 px-3 py-1 text-sm text-slate-800">
                {t}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="mt-10">
        <h2 className="text-xl font-bold text-slate-900">Public buyers around the site</h2>
        <p className="mt-1 text-sm text-slate-600">
          The county roads, water, sewer and school work a project this size brings does post publicly. These are the buyers we read nearby.
        </p>
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
      <div className="mt-8">
        {data.count === 0 ? (
          <EmptyState who="the buyers around this site" />
        ) : (
          <BidList count={data.count} bids={data.bids} who="buyers around the site" />
        )}
      </div>

      <section className="mt-10 text-sm text-slate-600">
        <h3 className="font-bold text-slate-900">Sources</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {p.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} rel="noopener" className="text-blue-600 hover:text-blue-800">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Project facts last checked {fmtDate(p.verifiedOn)}.</p>
      </section>
      <p className="mt-8 text-sm">
        <a href="/mega-projects" className="font-semibold text-blue-600 hover:text-blue-800">
          All mega-projects →
        </a>
      </p>
    </>
  );
}

export function MegaProjectIndexView() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {MEGA_PROJECTS.map((p) => (
        <li key={p.slug} className="rounded-2xl border border-slate-200 bg-white p-5">
          <a href={megaProjectHref(p)} className="text-lg font-bold text-blue-700 hover:text-blue-900">
            {p.name}
          </a>
          <p className="mt-1 text-sm text-slate-500">
            {p.owner} · {formatCompactMoney(p.investment)} · {p.place}, {p.stateCode} · {STATUS_LABEL[p.status]}
          </p>
          <p className="mt-2 text-sm text-slate-700">{p.summary}</p>
        </li>
      ))}
    </ul>
  );
}
