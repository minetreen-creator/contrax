import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";
import { MEMBER_BIDDING_REMIND_DAYS } from "~/lib/member-bid-activity";
import { trackEvent } from "~/lib/track";

/**
 * /bidding?b=<bid>&u=<member>&s=<signature> — where "I'm bidding this" in the paid morning email
 * lands (owner 2026-11-26, src/lib/member-notice-link.server.ts). One button; nothing is saved
 * until it is pressed.
 */
type Data = { ok: true; bidId: number; userId: number; sig: string; title: string; due: string | null; open: boolean } | { ok: false };

const getBidding = createServerFn({ method: "GET" })
  .validator((d: unknown) => {
    const o = (d ?? {}) as Record<string, unknown>;
    return { b: Number(o.b), u: Number(o.u), s: String(o.s ?? "").slice(0, 64) };
  })
  .handler(async ({ data }): Promise<Data> => {
    try {
      const { verifyMemberBidding } = await import("~/lib/member-notice-link.server");
      if (!verifyMemberBidding(data.u, data.b, data.s)) return { ok: false };
      const { loadBiddingBid } = await import("~/lib/member-bidding.server");
      const bid = await loadBiddingBid(data.b);
      if (!bid) return { ok: false };
      return { ok: true, bidId: bid.id, userId: data.u, sig: data.s, title: bid.title, due: bid.due, open: bid.open };
    } catch (e) {
      console.error("[bidding] load failed:", (e as Error).message);
      return { ok: false };
    }
  });

export const Route = createFileRoute("/bidding")({
  validateSearch: (s: Record<string, unknown>) => ({ b: Number(s.b) || 0, u: Number(s.u) || 0, s: typeof s.s === "string" ? s.s : "" }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getBidding({ data: deps }),
  head: () => ({ meta: [{ title: "I'm bidding this | Contrax" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: BiddingPage,
});

function BiddingPage() {
  const d = Route.useLoaderData();
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState("");
  useEffect(() => {
    trackEvent("bidding_page_view", d.ok ? "valid" : "invalid");
  }, [d.ok]);

  const due = d.ok && d.due ? new Date(d.due).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" }) : "";
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <SiteHeader />
      <div className="mx-auto max-w-xl px-4 py-12">
        {!d.ok ? (
          <>
            <h1 className="text-2xl font-bold">This link didn't open</h1>
            <p className="mt-3 text-slate-600">It may be incomplete. You can mark any saved bid as Preparing from your pipeline.</p>
            <a href="/pipeline" className="mt-5 inline-block font-semibold text-blue-700">Open my pipeline →</a>
          </>
        ) : state === "done" ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
            <h1 className="text-2xl font-bold">Got it. Good luck.</h1>
            <p className="mt-3 text-slate-700">
              It is in your pipeline as Preparing.{due ? ` We'll email you ${MEMBER_BIDDING_REMIND_DAYS} days before it is due on ${due}.` : ""}
            </p>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 font-semibold">
              <a href={`/bid/${d.bidId}`} className="text-blue-700">Open the bid →</a>
              <a href="/pipeline" className="text-blue-700">See my pipeline →</a>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Bidding this one?</p>
            <h1 className="mt-2 text-2xl font-bold">{d.title}</h1>
            {due ? <p className="mt-2 text-slate-600">{d.open ? `Due ${due}` : `Closed ${due}`}</p> : null}
            <p className="mt-4 text-slate-700">
              One tap puts it in your pipeline as Preparing{d.open && due ? ` and sets a reminder ${MEMBER_BIDDING_REMIND_DAYS} days before it is due` : ""}.
            </p>
            <button
              type="button"
              disabled={state === "saving"}
              onClick={async () => {
                setError("");
                setState("saving");
                trackEvent("bidding_confirm_click", String(d.bidId));
                try {
                  const res = await fetch("/api/member/bidding", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ b: d.bidId, u: d.userId, s: d.sig }),
                  });
                  const out = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
                  if (!res.ok || !out?.success) throw new Error(out?.error || "Something went wrong. Please try again.");
                  setState("done");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
                  setState("idle");
                }
              }}
              className="mt-5 w-full rounded-lg bg-emerald-600 px-4 py-3 text-base font-bold text-white hover:bg-emerald-700 disabled:opacity-60 sm:w-auto"
            >
              {state === "saving" ? "Saving…" : "Yes, I'm bidding this"}
            </button>
            {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
            <p className="mt-4 text-sm text-slate-500">
              <a href={`/bid/${d.bidId}`} className="font-semibold text-blue-700">Just open the bid →</a>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
