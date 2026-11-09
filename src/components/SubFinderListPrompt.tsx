/**
 * "Let primes find you" (owner 2026-11-09, Sub Finder growth item 1): a one-tap card on the
 * dashboard and the roadmap for signed-in members who have a business profile and are not listed
 * for primes yet. Members only, opt-in, and it can be dismissed. Nothing is sent to anyone.
 */
import { useEffect, useState } from "react";
import { createServerFn } from "@tanstack/react-start";
import { trackEvent } from "~/lib/track";

const getListingState = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { getCurrentUser } = await import("~/lib/auth");
    const user = await getCurrentUser();
    if (!user) return { show: false };
    const { myListing } = await import("~/lib/sub-finder.server");
    const l = await myListing(user.id);
    return { show: l.hasProfile && !l.listed };
  } catch {
    return { show: false };
  }
});

const listMe = createServerFn({ method: "POST" }).handler(async () => {
  const { getCurrentUser } = await import("~/lib/auth");
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const { setListed } = await import("~/lib/sub-finder.server");
  return { ok: await setListed(user.id, true) };
});

const DISMISS_KEY = "contrax_sub_finder_prompt_dismissed";

export function SubFinderListPrompt({ placement }: { placement: "dashboard" | "roadmap" }) {
  const [state, setState] = useState<"hidden" | "ask" | "saving" | "listed">("hidden");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      /* storage blocked: still ask */
    }
    let live = true;
    getListingState()
      .then((r) => {
        if (live && r.show) {
          setState("ask");
          trackEvent("sub_finder_prompt_shown", placement);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [placement]);

  if (state === "hidden") return null;
  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* fine */
    }
    setState("hidden");
  };
  const list = async () => {
    setState("saving");
    const r = await listMe().catch(() => ({ ok: false }));
    if (!r.ok) return setState("ask");
    setState("listed");
    trackEvent("sub_finder_prompt_listed", placement);
  };

  return (
    <div className="my-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm">
      {state === "listed" ? (
        <p className="text-indigo-950">
          <strong>You're listed.</strong> Primes using Sub Finder can now send you quote requests by email, and every request has a link to stop.{" "}
          <a href="/sub-finder#listing" className="font-semibold text-indigo-700">Manage your listing →</a>
        </p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-indigo-950">
            <strong>Let primes find you.</strong> Prime contractors use Sub Finder to find local subs for government jobs. List your business and they can send you quote
            requests. You can stop any time.
          </p>
          <div className="flex shrink-0 items-center gap-3">
            <button type="button" onClick={() => void list()} disabled={state === "saving"} className="rounded-lg bg-indigo-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
              {state === "saving" ? "Listing…" : "List my business"}
            </button>
            <button type="button" onClick={dismiss} className="text-xs text-indigo-700 underline">
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
