import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { normalizeZip } from "~/lib/town/town";
import { trackEvent } from "~/lib/track";

/** ZIP box for "What's Your Town Buying?" (owner 2026-10-23). */
export function TownZipForm({ initial = "", size = "lg" }: { initial?: string; size?: "lg" | "sm" }) {
  const navigate = useNavigate();
  const [zip, setZip] = useState(initial);
  const [error, setError] = useState("");
  const big = size === "lg";
  return (
    <form
      className="mx-auto flex w-full max-w-md flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        const z = normalizeZip(zip);
        if (!z) {
          setError("Enter a 5-digit US ZIP code.");
          return;
        }
        setError("");
        trackEvent("town_zip_search", z);
        navigate({ to: "/town/$zip", params: { zip: z } });
      }}
    >
      <input
        value={zip}
        onChange={(e) => setZip(e.target.value)}
        inputMode="numeric"
        autoComplete="postal-code"
        maxLength={10}
        placeholder="Your ZIP code"
        aria-label="ZIP code"
        className={`flex-1 rounded-xl border border-slate-300 bg-white px-4 text-slate-900 ${big ? "py-4 text-xl" : "py-2.5 text-base"}`}
      />
      <button type="submit" className={`rounded-xl bg-amber-400 font-bold text-slate-900 hover:bg-amber-300 ${big ? "px-6 py-4 text-lg" : "px-4 py-2.5"}`}>
        Show me 👀
      </button>
      {error && <p className="w-full text-sm font-semibold text-red-300 sm:basis-full">{error}</p>}
    </form>
  );
}
