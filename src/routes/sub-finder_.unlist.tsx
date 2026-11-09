import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";

/** /sub-finder/unlist — the one-click link in every Sub Finder quote request: stop being listed. */
const unlist = createServerFn({ method: "GET" })
  .validator((d: unknown) => {
    const o = (d ?? {}) as { p?: unknown; t?: unknown };
    return { p: Number(o.p), t: String(o.t ?? "") };
  })
  .handler(async ({ data }) => {
    if (!Number.isInteger(data.p) || data.p <= 0 || !data.t) return { ok: false };
    try {
      const { unlistByToken } = await import("~/lib/sub-finder.server");
      return { ok: await unlistByToken(data.p, data.t) };
    } catch {
      return { ok: false };
    }
  });

export const Route = createFileRoute("/sub-finder_/unlist")({
  validateSearch: (s: Record<string, unknown>) => ({ p: s.p, t: s.t }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => unlist({ data: deps }),
  component: () => {
    const { ok } = Route.useLoaderData();
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-xl px-4 py-12">
          <h1 className="text-2xl font-bold text-slate-900">{ok ? "You're no longer listed for primes" : "That link didn't work"}</h1>
          <p className="mt-2 text-slate-700">
            {ok
              ? "You won't get more quote requests through Contrax. You can list your business again any time on the Sub Finder page."
              : "It may be incomplete. You can turn the listing off yourself on the Sub Finder page when signed in."}
          </p>
          <a href="/sub-finder" className="mt-4 inline-block font-semibold text-blue-700">Go to Sub Finder →</a>
        </main>
      </>
    );
  },
  head: () => ({ meta: [{ title: "Sub Finder listing | Contrax" }, { name: "robots", content: "noindex" }] }),
});
