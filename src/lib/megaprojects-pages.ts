/**
 * Server-side data for the megaproject pages (owner 2026-11-08: server-rendered and
 * indexable). The list is read on the server, so each page arrives with its facts in
 * the HTML instead of loading them in the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { STATE_CODE_TO_NAME } from "~/lib/location-state";
import { megaStateFromSlug, megaprojectsIn, sortMegaprojects, type Megaproject } from "~/lib/megaprojects";

async function allMegaprojects(): Promise<Megaproject[]> {
  const mod = await import("../../public/data/megaprojects.json");
  return sortMegaprojects((mod.default ?? mod) as unknown as Megaproject[]);
}

export const getMegaprojectList = createServerFn({ method: "GET" }).handler(async (): Promise<Megaproject[]> => allMegaprojects());

export interface MegaprojectPageData {
  project: Megaproject | null;
  /** Other projects in the same state, biggest first. */
  sameState: Megaproject[];
}

export const getMegaprojectPage = createServerFn({ method: "GET" })
  .validator((d: unknown) => String((d as { slug?: unknown })?.slug ?? "").toLowerCase().slice(0, 120))
  .handler(async ({ data: slug }): Promise<MegaprojectPageData> => {
    const all = await allMegaprojects();
    const project = all.find((p) => p.slug === slug) ?? null;
    const sameState = project ? megaprojectsIn(all, project.state).filter((p) => p.slug !== project.slug) : [];
    return { project, sameState };
  });

export interface MegaprojectStateData {
  stateCode: string | null;
  projects: Megaproject[];
}

export const getMegaprojectState = createServerFn({ method: "GET" })
  .validator((d: unknown) => String((d as { state?: unknown })?.state ?? "").toLowerCase().slice(0, 60))
  .handler(async ({ data: slug }): Promise<MegaprojectStateData> => {
    const stateCode = megaStateFromSlug(slug, STATE_CODE_TO_NAME);
    if (!stateCode) return { stateCode: null, projects: [] };
    return { stateCode, projects: megaprojectsIn(await allMegaprojects(), stateCode) };
  });

/** Every indexable megaproject page, for the sitemap: the list, each state with a project, each project. */
export async function megaprojectSitemapPaths(): Promise<string[]> {
  const { megaStateHref, megaprojectHref } = await import("~/lib/megaprojects");
  const all = await allMegaprojects();
  const states = [...new Set(all.map((p) => p.state))]
    .map((c) => megaStateHref(c, STATE_CODE_TO_NAME))
    .filter((h): h is string => !!h);
  return ["/megaprojects", ...states, ...all.map(megaprojectHref)];
}
