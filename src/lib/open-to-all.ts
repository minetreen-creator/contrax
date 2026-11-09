/**
 * "Open to all businesses (no set-aside)" (owner 2026-11-09, "yes build it"): open federal bids
 * that name no set-aside. The small-business rule keeps them out of Radar's default matches and
 * every small-business count; they are listed apart, under their own label, so the counts stay
 * the same everywhere (owner 2026-11-08, "one count everywhere").
 */
import { createServerFn } from "@tanstack/react-start";

export interface OpenToAllBid {
  id: number;
  title: string;
  agency: string | null;
  place: string | null;
  due_date: string | null;
  /** Performed in the searched state (false: nationwide, no single state on the notice). */
  local: boolean;
}

export interface OpenToAllData {
  trade: string;
  state: string;
  localCount: number;
  nationwideCount: number;
  bids: OpenToAllBid[];
}

/** Most bids sent to the page; the section shows a few and expands to the rest. */
export const OPEN_TO_ALL_MAX = 25;
export const OPEN_TO_ALL_FIRST = 4;

export function cleanOpenToAllInput(d: unknown): { trade: string; state: string } {
  const o = (d ?? {}) as { trade?: unknown; state?: unknown };
  const trade = String(o.trade ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const st = String(o.state ?? "").trim().toUpperCase();
  return { trade, state: /^[A-Z]{2}$/.test(st) ? st : "" };
}

function iso(v: unknown): string | null {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function toBid(r: any, local: boolean): OpenToAllBid | null {
  const id = Number(r?.id);
  const title = String(r?.title ?? "").trim();
  if (!Number.isFinite(id) || !title) return null;
  return {
    id,
    title: title.slice(0, 200),
    agency: r.agency ? String(r.agency).slice(0, 120) : null,
    place: r.location ? String(r.location).slice(0, 80) : null,
    due_date: iso(r.due_date),
    local,
  };
}

/** The state's own bids first, then nationwide ones, each soonest due first (PURE). */
export function toOpenToAllData(trade: string, state: string, split: { local: any[]; nationwide: any[] }): OpenToAllData {
  const bids = [...split.local.map((r) => toBid(r, true)), ...split.nationwide.map((r) => toBid(r, false))]
    .filter((b): b is OpenToAllBid => b !== null)
    .slice(0, OPEN_TO_ALL_MAX);
  return { trade, state, localCount: split.local.length, nationwideCount: split.nationwide.length, bids };
}

export const getOpenToAllBids = createServerFn({ method: "GET" })
  .validator(cleanOpenToAllInput)
  .handler(async ({ data }): Promise<OpenToAllData> => {
    const { loadOpenToAll } = await import("~/lib/open-to-all.server");
    return loadOpenToAll(data.trade, data.state);
  });
