/**
 * NaicsTypeahead — the ONE shared, searchable multi-select NAICS picker.
 *
 * Used by BOTH the onboarding "NAICS code or trade" step and the profile /
 * settings editor so the two surfaces never diverge. The user types plain
 * language ("HVAC", "roofing", "management consulting", "leadership training")
 * and picks from friendly titles — the 6-digit code is the machine value, the
 * title is what they actually read and choose. No one has to remember a code.
 *
 * Suggestions come from the single source of truth `NAICS_NAMES`, enriched with
 * the curated keywords from `NAICS_INFER_MAP` (the same keyword set the NAICS
 * inference tagger uses), so friendly language maps to real codes.
 *
 * When the input is focused and the term is empty, a curated "Popular trades"
 * grid (`POPULAR_TRADES`) is shown instead so a mobile user can tap a tile and
 * go without knowing a code or what to type. Once they type, the popular grid
 * gives way to the live ranked search results.
 *
 * The component is CONTROLLED: `value` is the set of selected (active) codes
 * (strict 6-digit strings) and `onChange` fires with the new array when the
 * user adds/removes one. Parent surfaces decide persistence (onboarding saves
 * every selected code as active; the settings editor additionally tracks
 * on/off toggles for a larger saved bank — see settings.tsx).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { NAICS_NAMES } from "~/lib/naics-names";
import { NAICS_INFER_MAP } from "~/lib/naics-infer";

export interface NaicsOption {
  code: string;
  title: string;
}

/** Friendly NAICS title for a code (the "other" 6-digit codes show a bare label). */
export function naicsTitle(code: string): string {
  return NAICS_NAMES[code] ?? `NAICS ${code}`;
}

/**
 * Curated "Popular trades" shown the moment the input is focused (term empty),
 * so a mobile user can tap a tile and go — no need to know their NAICS code or
 * what to type. Owner approved a curated basis (we have no usage data to rank
 * by). Every `code` is a real 6-digit NAICS code backed by `NAICS_NAMES`, so a
 * tap produces the exact same selected code as the type-ahead search would.
 * `label` is a short, tappable-friendly name; the picked chip shows the full
 * official title via `naicsTitle`.
 */
export interface PopularTrade {
  code: string;
  label: string;
}

export const POPULAR_TRADES: PopularTrade[] = [
  { code: "236220", label: "Commercial Construction" }, // Commercial Building Construction
  { code: "238220", label: "HVAC & Plumbing" }, // Plumbing, Heating, and Air-Conditioning Contractors
  { code: "238210", label: "Electrical Contractors" },
  { code: "238160", label: "Roofing Contractors" },
  { code: "541511", label: "IT / Computer Services" }, // Custom Computer Programming Services
  { code: "541610", label: "Management Consulting" }, // Management Consulting Services
  { code: "561720", label: "Janitorial / Cleaning" }, // Janitorial Services
  { code: "561730", label: "Landscaping / Grounds" }, // Landscaping Services
  { code: "484121", label: "Freight Trucking" }, // General Freight Trucking, Long-Distance, Truckload
  { code: "561612", label: "Security Services" }, // Security Guards and Patrol Services
  { code: "561210", label: "Facilities Support" }, // Facilities Support Services
];

/**
 * Search NAICS_NAMES by plain-language keywords. Matches on:
 *   - the official title (the exact phrase or any of its words), AND/OR
 *   - the curated high-value keywords for that code (HVAC, roofing, janitorial…)
 *   - an exact 6-digit code gives an immediate exact hit
 * Returns up to `limit` options ranked by signal strength.
 */
export function searchNaics(query: string, limit = 8): NaicsOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  // Exact 6-digit code → exact hit.
  if (/^\d{6}$/.test(q) && NAICS_NAMES[q]) {
    return [{ code: q, title: NAICS_NAMES[q] }];
  }

  const tokens = q.split(/\s+/).filter((t) => t.length > 0);

  type Scored = { code: string; title: string; score: number };
  const scored: Scored[] = [];

  for (const [code, entry] of Object.entries(NAICS_INFER_MAP)) {
    if (!NAICS_NAMES[code]) continue;
    const title = entry.title.toLowerCase();
    let score = 0;

    // The typed phrase appears verbatim in the official title (strongest).
    if (title.includes(q)) score += 8;
    // Individual query tokens appear in the title.
    for (const t of tokens) if (t.length >= 2 && title.includes(t)) score += 3;
    // Curated keyword hits, in either direction (e.g. "HVAC" ↔ HVAC).
    for (const kw of entry.keywords) {
      const k = kw.toLowerCase();
      if (k.length < 2) continue;
      if (k.includes(q) || q.includes(k)) score += 5;
      else for (const t of tokens) if (t.length >= 2 && (k.includes(t) || t.includes(k))) score += 2;
    }

    if (score > 0) scored.push({ code, title: NAICS_NAMES[code], score });
  }

  scored.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  return scored.slice(0, limit).map(({ code, title }) => ({ code, title }));
}

interface NaicsTypeaheadProps {
  /** Currently selected (active) 6-digit codes. */
  value: string[];
  /** Called with the new active-code array on add/remove. */
  onChange: (codes: string[]) => void;
  /** Maximum number of SELECTED codes the typeahead will accept (default 10). */
  max?: number;
  inputId?: string;
  placeholder?: string;
  helpText?: string;
  /** Fires with the raw typed text on every change (for keyword-phrase fallback). */
  onTermChange?: (term: string) => void;
}

export function NaicsTypeahead({
  value,
  onChange,
  max = 10,
  inputId,
  placeholder = "Search your trade or service…",
  helpText,
  onTermChange,
}: NaicsTypeaheadProps) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = useMemo(() => searchNaics(term, 8), [term]);

  const add = (code: string) => {
    if (value.includes(code)) return;
    if (value.length >= max) return;
    onChange([...value, code]);
    // Clear the term + keep the dropdown open so the user can immediately
    // chain another pick (popular tiles) or start typing the next trade.
    setTerm("");
    setOpen(true);
    inputRef.current?.focus();
  };
  const remove = (code: string) => onChange(value.filter((c) => c !== code));

  const close = () => {
    setOpen(false);
    // Blur so the mobile keyboard dismisses and the user keeps their place in
    // the surrounding form (selections are already via `value`/onChange).
    inputRef.current?.blur();
  };

  // Close the dropdown when clicking outside the widget.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const atMax = value.length >= max;
  const termEmpty = term.trim().length === 0;

  return (
    <div ref={rootRef} className="relative">
      {/* Selected chips */}
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((code) => (
            <span
              key={code}
              className="inline-flex max-w-full items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 py-1 pl-2 pr-0.5 sm:pr-1"
            >
              <span className="font-mono text-xs font-bold text-blue-700">{code}</span>
              <span className="max-w-[10rem] truncate text-xs font-medium text-slate-700 sm:max-w-[20rem]">
                {naicsTitle(code)}
              </span>
              <button
                type="button"
                onClick={() => remove(code)}
                aria-label={`Remove ${code}`}
                className="relative -m-2 p-3.5 -mr-1.5 text-slate-400 transition hover:bg-blue-100 hover:text-slate-700"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={term}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="naics-dropdown"
        aria-label={value.length === 0 ? placeholder : "Add another trade or service"}
        placeholder={value.length === 0 ? placeholder : "Add another trade or service…"}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
          onTermChange?.(e.target.value);
        }}
        onFocus={() => setOpen(true)}
        className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
      {helpText && <p className="mt-1.5 text-xs text-slate-400">{helpText}</p>}
      {value.length > 0 && (
        <p className="mt-1.5 text-xs text-slate-400">
          {value.length}/{max} selected — add more, or remove a chip above.
        </p>
      )}

      {open && (
        <div
          id="naics-dropdown"
          className="absolute z-20 mt-1 w-full max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white shadow-xl"
        >
          {/* Header: contextual label + explicit Done (mobile-friendly dismiss) */}
          <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-slate-100 bg-white px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {termEmpty ? "Popular trades" : "Results"}
            </span>
            <button
              type="button"
              onClick={close}
              className="rounded-md px-2.5 py-1.5 text-sm font-medium text-blue-600 transition hover:bg-blue-50"
            >
              Done
            </button>
          </div>

          {termEmpty ? (
            <div className="p-2">
              <p className="px-2 pb-1.5 pt-0.5 text-xs text-slate-400">
                Tap a trade to add it — or type to search any service.
              </p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {POPULAR_TRADES.map((t) => {
                  const chosen = value.includes(t.code);
                  const disabled = !chosen && atMax;
                  return (
                    <button
                      key={t.code}
                      type="button"
                      disabled={disabled}
                      onClick={() => add(t.code)}
                      className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {chosen && (
                          <svg className="h-4 w-4 shrink-0 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        <span className="truncate text-sm font-medium text-slate-800">{t.label}</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs text-slate-400">{t.code}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <ul className="py-1">
              {suggestions.length === 0 && (
                <li className="px-4 py-3 text-sm text-slate-400">
                  No trades match “{term}”. Try something like “HVAC”, “roofing”, or “management consulting”.
                </li>
              )}
              {suggestions.map((s) => {
                const chosen = value.includes(s.code);
                const disabled = !chosen && atMax;
                return (
                  <li key={s.code}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => add(s.code)}
                      className="flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {chosen && (
                          <svg className="h-4 w-4 shrink-0 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        <span className="truncate text-sm font-medium text-slate-800">{s.title}</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs text-slate-400">{s.code}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
