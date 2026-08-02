import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ensureDemoSession } from "~/lib/demo";

export const Route = createFileRoute("/demo")({ component: DemoPage });

function DemoPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  useEffect(() => {
    ensureDemoSession({}).then(() => navigate({ to: "/dashboard", replace: true })).catch((err) => setError(err instanceof Error ? err.message : "Unable to start demo"));
  }, [navigate]);
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6"><div className="text-center text-white"><div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400 text-2xl">✦</div><h1 className="text-2xl font-bold">Preparing your Contrax demo…</h1><p className="mt-2 text-slate-300">Loading sample opportunities and your AI workspace.</p>{error && <p className="mt-5 text-red-300">{error}</p>}</div></main>;
}
