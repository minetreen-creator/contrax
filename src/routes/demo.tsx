import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ensureDemoSession } from "~/lib/demo";

export const Route = createFileRoute("/demo")({
  component: DemoPage,
  head: () => ({
    title: "Contrax Demo — Try AI-Powered Government Contract Bidding",
    meta: [
      { name: "description", content: "Explore Contrax with a pre-loaded demo account. See real government bids, AI win-probability scores, proposal drafts, and your full contracting dashboard — no signup required." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://contrax.company/demo" },
      { property: "og:title", content: "Contrax Demo — Try AI-Powered Government Contract Bidding" },
      { property: "og:description", content: "Explore Contrax with a pre-loaded demo account. See real government bids, AI scores, and proposal drafts — no signup required." },
    ],
    links: [{ rel: "canonical", href: "https://contrax.company/demo" }],
  }),
});

function DemoPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  useEffect(() => {
    ensureDemoSession({}).then(() => navigate({ to: "/dashboard", replace: true })).catch((err) => setError(err instanceof Error ? err.message : "Unable to start demo"));
  }, [navigate]);
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6"><div className="text-center text-white"><div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400 text-2xl">✦</div><h1 className="text-2xl font-bold">Preparing your Contrax demo…</h1><p className="mt-2 text-slate-300">Loading sample opportunities and your AI workspace.</p>{error && <p className="mt-5 text-red-300">{error}</p>}</div></main>;
}
